// ============================================================
// 預かり残高を動かす操作の「意味」 (機能012)
//
// 預かる・返す・調整は、どれも **預かり残高を動かす1つの操作** で、
// 違うのは向きと言い回しだけ。以前は「預かり」だけが彼女タブのカードにあり、
// 「返す・調整」はシートの中に隠れていて、同じことをする入口が2つあった。
// 画面を1枚のカードに統合するにあたり、
//
//   選んだ種類 → 保存される type / amount の符号 / 残高への影響
//
// という判定だけをここに純粋関数として置く。React にも Supabase にも
// 依存しないので、UI の形が変わっても組み合わせをテストで固定できる。
//
// 種別の対応(types.ts の設計をそのまま踏襲):
//   預かる(受け取る) → partner_deposit (残高 +)
//   返す             → partner_refund  (残高 −)
//   調整             → partner_adjust  (残高 ±。amount が符号つき)
//
// 「現金で受け取る」に専用の種類を作っていないのは、残高への効果も意味も
// 預かりとまったく同じだから(types.ts の TransactionType のコメント参照)。
// シートでは「受け取る」を別のチップにしていたが、保存される中身は
// 預かりと1バイトも違わなかったので、カードでは1つにまとめている。
// ============================================================

import type { TransactionType } from './types'
import { partnerImpact } from './partnerBalance'

/** カードで選べる操作の種類 */
export type SettlementMode = 'deposit' | 'refund' | 'adjust'

/** 預かり残高だけを動かす種別(= 支出ではないもの) */
export type SettlementTxType = Exclude<TransactionType, 'expense'>

/** 調整の向き。符号は数字に打たせず、必ずこの2択のボタンで選ばせる */
export type AdjustDirection = 1 | -1

export interface SettlementModeDef {
  id: SettlementMode
  /** 切り替えチップの文字 */
  label: string
  /** カードの見出し */
  heading: string
  /** 見出しの下に出す補足の1行 */
  hint: string
  /** 保存ボタンの文言 */
  submitLabel: string
  /** この種類で保存される取引種別 */
  txType: SettlementTxType
}

/**
 * 既定は「預かる」。いちばん使う操作で、マイグレーション未実行の環境でも
 * 唯一使える操作なので、切り替えが出ないときも自然にこの状態になる。
 */
export const SETTLEMENT_MODES: readonly SettlementModeDef[] = [
  {
    id: 'deposit',
    label: '預かる',
    heading: '預かりを記録',
    hint: '彼女から預かったお金を記録します(現金で受け取ったときも同じ扱いです)',
    submitLabel: '預かりを記録',
    txType: 'partner_deposit',
  },
  {
    id: 'refund',
    label: '返す',
    heading: '返金を記録',
    hint: '余った預かり金を彼女に返したときに記録します',
    submitLabel: '返金を記録',
    txType: 'partner_refund',
  },
  {
    id: 'adjust',
    label: '調整',
    heading: '残高を調整',
    hint: '数え間違いなどのズレを直します。理由も一緒に残ります',
    submitLabel: '調整を記録',
    txType: 'partner_adjust',
  },
]

export const DEFAULT_SETTLEMENT_MODE: SettlementMode = 'deposit'

/** 種類の定義を引く。(純粋関数。知らない値は既定の「預かる」に倒す) */
export function settlementMode(id: SettlementMode): SettlementModeDef {
  return SETTLEMENT_MODES.find((m) => m.id === id) ?? SETTLEMENT_MODES[0]
}

export interface SettlementDraft {
  mode: SettlementMode
  /** 画面に打たれた金額。常に絶対値(符号は打たせない) */
  amount: number
  /** 調整のときだけ使う向き。他の種類では無視される */
  direction: AdjustDirection
}

/** 保存する1件のうち、種類によって変わる部分 */
export interface SettlementRecord {
  type: SettlementTxType
  /** 保存する金額。調整のときだけ符号つきになる */
  amount: number
}

/**
 * 選んだ種類から、保存する種別と金額を決める。(純粋関数)
 *
 * 調整だけ符号つきなのは、残高への影響がそのまま amount になる設計
 * (partnerBalance.partnerImpact 参照)。返す・預かるは向きが種別で決まるので、
 * amount は必ず正の数にする — ここで符号を持たせると二重に効いてしまう。
 */
export function settlementRecord(draft: SettlementDraft): SettlementRecord {
  const magnitude = Math.abs(draft.amount)
  const def = settlementMode(draft.mode)
  return {
    type: def.txType,
    amount: draft.mode === 'adjust' ? draft.direction * magnitude : magnitude,
  }
}

/**
 * 保存される1件が預かり残高に与える影響額(符号つき)。(純粋関数)
 *
 * 「操作の種類」ではなく「保存される形」から求めるのが要点。
 * 残高の計算は partnerBalance.partnerImpact に一本化してあるので、
 * ここでも自前で足し引きしない。こうしておけば、押す前に見せる見込みと
 * 保存後に履歴を足し上げた残高が、定義上ずれようがない。
 */
export function settlementImpact(record: SettlementRecord): number {
  return partnerImpact({ ...record, partner_amount: 0 })
}

/** 種類と金額から、そのまま影響額を出す近道。(純粋関数) */
export function draftImpact(draft: SettlementDraft): number {
  return settlementImpact(settlementRecord(draft))
}

export interface SettlementInputDraft extends SettlementDraft {
  date: string
  memo: string
}

/**
 * 保存する1件をまるごと組み立てる。(純粋関数)
 *
 * category / store / partner_amount は、どの種類でも必ずこの値。
 * 支出ではないので分類も店名も持たず、彼女の負担分という概念も無い。
 * (hooks/useTransactions の TransactionInput に構造的に代入できる形。
 *  lib から hooks に依存させないため、型は import せず自前で持つ)
 */
export function settlementInput(draft: SettlementInputDraft): {
  date: string
  type: TransactionType
  amount: number
  category: null
  memo: string
  store: string
  partner_amount: number
} {
  const record = settlementRecord(draft)
  return {
    date: draft.date,
    type: record.type,
    amount: record.amount,
    category: null,
    memo: draft.memo.trim(),
    store: '',
    partner_amount: 0,
  }
}
