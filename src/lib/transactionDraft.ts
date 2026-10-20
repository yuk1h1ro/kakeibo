// ============================================================
// 入力フォームの「判断」だけを抜き出したもの (純粋関数)
//
// TransactionForm は画面の状態(打ちかけの文字列・電卓の式・開いている欄)を
// 持ち、ここは「その状態から何が言えるか」だけを決める:
//   - 彼女が実際に払った額
//   - 保存できるか(できないなら、その理由)
//   - 預かり残高への影響の見込み
//
// 画面から切り離してあるのは、どれも**家計の数字に直結する判断**だから。
// 以前は保存の可否と理由を別々の式で書いていて食い違ったことがある
// (電卓で彼女の負担分をマイナスにすると、ボタンは灰色なのに理由が出なかった)。
// ここなら画面を描かずに、組み合わせを1つずつ確かめられる。
// ============================================================

import type { Transaction, TransactionType } from './types'
import { partnerPaid } from './types'
import { settlementImpact } from './partnerSettlement'

/**
 * 支払った人 (機能018)。
 * 既定は 'me'(自分が全額)で、これは機能018 より前の唯一の前提でもある。
 */
export type Payer = 'me' | 'partner' | 'both'

/** 編集シートを開いたときの「支払った人」。保存済みの額から読み戻す */
export function initialPayer(initial?: Transaction): Payer {
  if (!initial) return 'me'
  const paid = partnerPaid(initial)
  if (paid <= 0) return 'me'
  return paid >= initial.amount ? 'partner' : 'both'
}

/**
 * 彼女が実際に払った額。(純粋関数)
 * 「彼女が全額」は金額を打ち直させない(支払い総額と必ず一致させる)。
 * 支出以外(預かり・返金・調整)には「誰が払ったか」が無いので 0。
 */
export function partnerPaidAmount(
  type: TransactionType,
  payer: Payer,
  amount: number,
  partnerPaidInput: string
): number {
  if (type !== 'expense') return 0
  if (payer === 'partner') return amount
  if (payer === 'both') return Number(partnerPaidInput || 0)
  return 0
}

/** 保存の可否と残高の見込みを決めるのに要る、入力中の1件の中身 */
export interface DraftState {
  type: TransactionType
  category: string | null
  /** 支払い金額。電卓の式は評価済み。調整では向きを付ける前の絶対値 */
  amount: number
  withPartner: boolean
  /** 彼女の負担分。「二人で使った」がオフなら 0 */
  partnerAmount: number
  payer: Payer
  /** partnerPaidAmount の値 */
  partnerPaid: number
  /** おごり・値引きが付いているか(付いていれば 0円 の支出を通す) */
  hasFavor: boolean
  /** 分割の内訳を開いているか */
  splitting: boolean
  /** 分割の内訳がそろっているか(分割していなければ見ない) */
  splitOk: boolean
}

/** 「支払った人」の入力が成り立っているか。(純粋関数) */
export function isPartnerPaidValid(d: Pick<DraftState, 'type' | 'payer' | 'partnerPaid' | 'amount'>): boolean {
  return (
    d.type !== 'expense' ||
    d.payer === 'me' ||
    (Number.isInteger(d.partnerPaid) && d.partnerPaid > 0 && d.partnerPaid <= d.amount)
  )
}

/**
 * 保存ボタンが押せない理由。**保存できるかの判定はこの1本だけ** —
 * null なら保存できる。(純粋関数)
 *
 * 灰色になるだけでは、初めての人は何が足りないのか分からない。最初に
 * 引っかかった1つだけを言う。条件を足すときは、ここに理由ごと足すこと
 * (「押せるか」を別の式で書くと、また食い違う)。
 *
 * 支払い 0円 は、おごり・値引きが付いているときだけ通す。
 * 「全額おごってもらった」「割引券で無料になった」回は自分が出した額が 0円 になる。
 * 理由の無い 0円 は打ち間違いと区別が付かないので弾く
 * (DB 側の transactions_amount_check もまったく同じ判断をする)。
 */
export function saveBlockedReason(d: DraftState): string | null {
  const isExpense = d.type === 'expense'
  const zeroAllowed = isExpense && d.hasFavor
  if (!d.splitting && isExpense && d.category === null) return 'カテゴリを選んでください'
  if (d.amount < 0) return '金額がマイナスになっています(電卓の計算を見直してください)'
  if (!Number.isInteger(d.amount) || (d.amount === 0 && !zeroAllowed)) return '金額を入れてください'
  if (isExpense && d.withPartner && (!Number.isInteger(d.partnerAmount) || d.partnerAmount < 0)) {
    return '彼女の負担分がマイナスになっています(電卓の計算を見直してください)'
  }
  if (isExpense && d.withPartner && d.partnerAmount > d.amount) {
    return '彼女の負担分が支払い金額を超えています'
  }
  if (!isPartnerPaidValid(d)) {
    return d.payer === 'both' && d.partnerPaid <= 0
      ? '彼女が払った額を入れてください'
      : '彼女が払った額が支払い金額を超えています'
  }
  // 分割中は内訳が完全に揃っていることが保存の条件。
  // ここを緩めると支出の合計と預かり残高が静かにずれる
  if (d.splitting && !d.splitOk) return '分割の内訳がそろっていません(内訳の欄の下を見てください)'
  return null
}

/**
 * 入力中の1件が預かり残高に与える影響額(符号つき)。(純粋関数)
 * 残高カードの「押す前の見込み」に使う。打ちかけで数字になっていない値は 0 とみなす。
 *
 * - 預かり・返金・調整 … 影響額の決め方は partnerSettlement.ts に任せる
 *   (保存後の残高とずれないように)。調整だけは向き(adjustSign)を付ける
 * - 分割中 … 内訳の負担分の合計だけ減る(分割では「支払った人」を使わない)
 * - それ以外の支出 … 彼女が払った額 − 彼女の負担分
 */
export function draftPartnerImpact(
  d: Pick<DraftState, 'type' | 'amount' | 'partnerAmount' | 'partnerPaid' | 'splitting'> & {
    adjustSign: 1 | -1
    /** 分割中の内訳ごとの彼女の負担分 */
    splitPartnerAmounts: readonly number[]
  }
): number {
  if (d.type !== 'expense') {
    const magnitude = Number.isFinite(d.amount) && d.amount > 0 ? d.amount : 0
    return settlementImpact({
      type: d.type,
      amount: d.type === 'partner_adjust' ? d.adjustSign * magnitude : magnitude,
    })
  }
  if (d.splitting) {
    return -d.splitPartnerAmounts.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0)
  }
  const owed = Number.isFinite(d.partnerAmount) && d.partnerAmount > 0 ? d.partnerAmount : 0
  const paid = Number.isFinite(d.partnerPaid) ? d.partnerPaid : 0
  const impact = paid - owed
  return Number.isFinite(impact) ? impact : 0
}
