// ============================================================
// 1件を複数カテゴリに分割 (機能096)
//
// ---- データの持ち方と、彼女の負担分の扱い(ここが一番大事) ----
// 分割は「1行にカテゴリの内訳を JSON で持つ」のではなく、
// **カテゴリごとに独立した transactions の行を作り、split_group で束ねる**。
// そして **彼女の負担分は、分割した各行がそれぞれ持つ**。
//
// 理由:
//   1. レポートの集計 (report.ts) は「1行 = 1カテゴリ、実質支出 = amount −
//      partner_amount」という前提でできている。行を分ければ集計側を1行も
//      変えずに、食費と日用品が正しく別々に積み上がる。内訳を1行に畳むと、
//      カテゴリ別の金額を出すために集計側の書き換えが必要になる。
//   2. 預かり残高も「行ごとの partner_amount の合計」で出している。
//      全体に1つだけ負担分を持たせると、「どのカテゴリのいくらを彼女が
//      負担したのか」が決まらず、按分の丸めで残高が1円ずれる余地が生まれる。
//      行ごとに持てば、残高は分割前とまったく同じ足し算のままになる。
//   3. 履歴・検索・コメント・共有ページも、すべて「行」を単位にできている。
//
// 代償は「1回の買い物が履歴で複数行に見えること」だが、これは split_group で
// 束ねて表示すれば済む。残高と集計の正しさのほうを優先した。
//
// 分割と「支払った人」(機能018)の併用はしない。1回の会計をカテゴリでも
// 支払者でも割ると入力が重くなりすぎるうえ、支払額の按分に丸めが入って
// 残高がずれるため。分割は「自分が全額払った会計」を分けるものにしている。
// ============================================================

import { yenPlain } from './format'
import type { TransactionInput } from '../hooks/useTransactions'
import type { Transaction } from './types'

/** 分割の内訳1つ分(画面から渡ってくる下書き) */
export interface SplitPart {
  category: string | null
  amount: number
  /** この内訳のうち彼女の負担分 */
  partnerAmount: number
}

/** 分割の最小・最大の件数。多すぎるとスマホで入力しきれない */
export const MIN_SPLIT_PARTS = 2
export const MAX_SPLIT_PARTS = 6

export interface SplitValidation {
  ok: boolean
  /** 保存できない理由(画面にそのまま出す)。ok のときは null */
  message: string | null
  /** 支払い総額に対して、まだ振り分けられていない額(マイナスなら振りすぎ) */
  remaining: number
}

/** 内訳の合計。(純粋関数) */
export function splitTotal(parts: readonly SplitPart[]): number {
  return parts.reduce((sum, p) => sum + (Number.isFinite(p.amount) ? p.amount : 0), 0)
}

/**
 * 分割の内容が保存できる状態か。(純粋関数)
 * 「合計が支払い総額とぴったり一致すること」を必ず要求する。
 * ここを緩めると、預かり残高と支出の合計が静かにずれる。
 */
export function validateSplit(parts: readonly SplitPart[], total: number): SplitValidation {
  const remaining = total - splitTotal(parts)
  if (parts.length < MIN_SPLIT_PARTS) {
    return { ok: false, message: '内訳は2件以上にしてください', remaining }
  }
  if (parts.length > MAX_SPLIT_PARTS) {
    return { ok: false, message: `内訳は${MAX_SPLIT_PARTS}件までです`, remaining }
  }
  if (!Number.isInteger(total) || total <= 0) {
    return { ok: false, message: '支払い金額を入力してください', remaining }
  }
  for (const p of parts) {
    if (!Number.isInteger(p.amount) || p.amount <= 0) {
      return { ok: false, message: '内訳の金額をすべて入力してください', remaining }
    }
    if (p.category === null) {
      return { ok: false, message: '内訳のカテゴリをすべて選んでください', remaining }
    }
    if (
      !Number.isInteger(p.partnerAmount) ||
      p.partnerAmount < 0 ||
      p.partnerAmount > p.amount
    ) {
      return { ok: false, message: '彼女の負担分は、その内訳の金額までにしてください', remaining }
    }
  }
  if (remaining !== 0) {
    return {
      ok: false,
      message:
        // 金額は ¥ 付きで書く。目隠し (機能169) がオンのとき、
        // 画面側が maskAmountsIn でこの数字も伏せられるようにするため
        // (この関数は純粋なままにしたいので、伏せるのは表示の直前でやる)
        remaining > 0
          ? `あと ${yenPlain(remaining)} 振り分けてください`
          : `${yenPlain(Math.abs(remaining))} 振り分けすぎです`,
      remaining,
    }
  }
  return { ok: true, message: null, remaining: 0 }
}

/**
 * 分割した内訳を、そのまま保存できる複数の記録にする。(純粋関数)
 *
 * 日付・お店・メモ・タグ・気分は元の1件のものを全部の行に写す
 * (履歴でどの行を開いても「何の買い物だったか」が分かるように)。
 * 支払った人の指定(partner_paid)は分割では使わないので必ず 0 にする。
 */
export function buildSplitInputs(
  base: TransactionInput,
  parts: readonly SplitPart[],
  groupId: string
): TransactionInput[] {
  return parts.map((p) => ({
    ...base,
    type: 'expense' as const,
    amount: p.amount,
    category: p.category,
    partner_amount: p.partnerAmount,
    partner_paid: 0,
    split_group: groupId,
  }))
}

/**
 * 分割を開いたときに、上段で入れてあった「彼女の負担分」を内訳へ引き継ぐ。(純粋関数)
 *
 * 先頭の内訳から順に、その内訳の金額を上限として詰める(按分にすると
 * 割り切れない1円がどこかに寄り、預かり残高が静かにずれる余地を作るため)。
 * 引き継がないと、上段に入れた負担分が buildSplitInputs で内訳の値に
 * 上書きされて黙って消える。
 */
export function carryPartnerAmount(
  parts: readonly SplitPart[],
  partnerAmount: number
): SplitPart[] {
  let rest = Number.isInteger(partnerAmount) && partnerAmount > 0 ? partnerAmount : 0
  return parts.map((p) => {
    const take = Math.max(0, Math.min(rest, p.amount))
    rest -= take
    return { ...p, partnerAmount: take }
  })
}

/**
 * 分割を開いた瞬間に出す注意書き。(純粋関数)
 *
 * 分割は「自分が全額払った会計」を分けるものなので(このファイル冒頭の理由)、
 * 上段で選んだ「支払った人」は使われず、彼女の負担分も内訳の値で上書きされる。
 * 入れた値が黙って消えるのがいちばん困るので、消えた/移したことをその場に出す。
 * 金額は ¥ 付きで書く(目隠し 機能169 が画面側で伏せられるように)。
 */
export function splitCarryNotice(carriedPartnerAmount: number, payerWasPartner: boolean): string | null {
  const carried =
    carriedPartnerAmount > 0
      ? `上段の「彼女の負担分」${yenPlain(carriedPartnerAmount)} は内訳に振り分けました。内訳ごとに直せます。`
      : ''
  const payer = payerWasPartner
    ? '「支払った人」は分割では使えないため、自分が全額払った扱いで保存されます(必要なら分割をやめてから入力してください)。'
    : ''
  const text = `${carried}${payer}`
  return text === '' ? null : text
}

/** 分割された記録か。(純粋関数) */
export function isSplitPart(t: Transaction): boolean {
  return typeof t.split_group === 'string' && t.split_group !== ''
}

/** 同じ会計から分割された仲間(自分自身を含む)。(純粋関数) */
export function splitSiblings(txs: readonly Transaction[], t: Transaction): Transaction[] {
  if (!isSplitPart(t)) return [t]
  return txs.filter((x) => x.split_group === t.split_group)
}

/** 分割の何番目か(1始まり)と、その会計の内訳の件数 */
export interface SplitPosition {
  index: number
  count: number
}

/**
 * 記録の id → 「分割の何分の何番目か」の対応表を一度に作る。(純粋関数)
 *
 * 一覧の行ごとに splitSiblings を呼ぶと、行数 × 記録数の走査になって
 * 記録が増えるほど履歴が重くなる。描く前にここで1回だけまとめて作る。
 * 分割でない記録は表に載せない(呼び出し側は「無ければ出さない」だけで済む)。
 *
 * 並びは作成時刻 → id で決めきる。入力の並び順で番号が入れ替わると、
 * 同じ買い物が見るたびに「1/2」「2/2」と入れ替わってしまうため。
 */
export function splitPositions(txs: readonly Transaction[]): Map<string, SplitPosition> {
  const groups = new Map<string, Transaction[]>()
  for (const t of txs) {
    if (!isSplitPart(t)) continue
    const key = t.split_group as string
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }
  const out = new Map<string, SplitPosition>()
  for (const list of groups.values()) {
    const ordered = [...list].sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    )
    ordered.forEach((t, i) => out.set(t.id, { index: i + 1, count: ordered.length }))
  }
  return out
}

/** 履歴の行に出す「分割 1/2」。(純粋関数) */
export function splitBadgeLabel(pos: SplitPosition): string {
  return `分割 ${pos.index}/${pos.count}`
}

/**
 * 均等割りの下書きを作る。(純粋関数)
 * 割り切れない分は先頭の内訳に寄せる(合計は必ず total に一致させる)。
 */
export function evenSplit(total: number, count: number, category: string | null): SplitPart[] {
  const n = Math.max(MIN_SPLIT_PARTS, Math.min(count, MAX_SPLIT_PARTS))
  const base = Math.floor(total / n)
  const parts: SplitPart[] = []
  for (let i = 0; i < n; i++) {
    parts.push({
      category: i === 0 ? category : null,
      amount: i === 0 ? total - base * (n - 1) : base,
      partnerAmount: 0,
    })
  }
  return parts
}
