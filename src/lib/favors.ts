// ============================================================
// おごり・値引き — 「実際に払った額より、本来の値段が高かった」回
//
// ---- なぜこれを記録するのか ----
// 割引券で無料になった回や、誰かにご馳走になった回は、レジで払った額が
// 本来の値段より安い(あるいは 0円)。家計簿として払った額だけを残せば数字は
// 合うが、それだと **おごってもらった事実がどこにも残らない**。
//
// 誰に・いつ・いくらぶん ご馳走になったのかは、あとから思い出そうとしても
// 出てこない。お返しをするにも、お礼を言うにも、まず残っていないと始まらない。
// 「払っていないから記録しない」は家計としては正しくても、
// **相手への向き合い方としては間違っている**。だから記録する。
// (割引券のほうは「いくら浮いたか」の記録。同じ仕組みに相乗りさせている)
//
// ---- 支出には入れない ----
// amount は「実際に自分の財布から出た額」のまま、1円も変えない。
// 浮いた分を amount に足すと、払っていないお金が支出の合計・カテゴリ別・
// 支出ペース・予算のすべてに乗ってしまう。家計簿がいちばん壊れてはいけないのは
// 「いくら使ったか」なので、浮いた分は別の列に置き、集計にも入れない。
// ownAmount(types.ts) も report.ts も、この機能を1行も知らないままで正しい。
//
// ---- 彼女の「立て替え」とは別物 ----
// 彼女が払った回 (機能018 の partner_paid) は **あとで精算するお金** で、
// 預かり残高が動く。おごりは **返さなくていい好意** なので残高を動かさない。
// 同じ「自分は払っていない」でも意味が正反対なので、列も画面も分けてある。
//
// ここは純粋関数だけ。React にも Supabase にも依存しない。
// ============================================================

import type { Transaction } from './types'
import { yenPlain } from './format'
import { inRange, type DateRange } from './report'

/**
 * 浮いた理由。
 *   treat    … 誰かにおごってもらった(相手がいる)
 *   discount … 割引券・クーポン・ポイント・キャンペーン(相手がいない)
 */
export type FavorKind = 'treat' | 'discount'

export const FAVOR_KINDS: readonly FavorKind[] = ['treat', 'discount']

/** おごってくれた人の名前の長さの上限(文字)。DB 側の制約と必ず揃えること */
export const MAX_FAVOR_FROM_LENGTH = 20

export interface Favor {
  kind: FavorKind
  /** 浮いた額(円)。1 以上 */
  amount: number
  /** おごってくれた人。値引きのときは空文字 */
  from: string
}

export interface FavorOption {
  kind: FavorKind
  label: string
  emoji: string
  /** 入力欄の見出し(何を打つ欄なのか) */
  amountLabel: string
}

// 並びは「おごり → 値引き」で固定。おごりのほうがこの機能の主役なので先に出す
export const FAVOR_OPTIONS: readonly FavorOption[] = [
  { kind: 'treat', label: 'おごってもらった', emoji: '🙏', amountLabel: 'おごってもらった額(円)' },
  { kind: 'discount', label: '割引・ポイント', emoji: '🎫', amountLabel: '安くなった額(円)' },
]

// ---------- 読み取り ----------

export function isFavorKind(value: unknown): value is FavorKind {
  return typeof value === 'string' && (FAVOR_KINDS as readonly string[]).includes(value)
}

/**
 * 浮いた額。列が無い / 未設定 / 壊れた値は 0。(純粋関数)
 * 0 は「おごりも値引きも無い」= これまでどおりの記録という意味。
 */
export function favorAmount(t: { favor_amount?: number | null }): number {
  const v = t.favor_amount
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/**
 * この記録に付いているおごり・値引き。無ければ null。(純粋関数)
 *
 * 額と理由の **両方** が揃っているときだけ認める。片方だけの行(古いキャッシュ・
 * 画面を通さない書き込み)を「おごり」として数えてしまうと、人ごとの集計に
 * 相手のいない行が混ざる。DB 側にも同じ組み合わせの制約を入れてある。
 */
export function favorOf(t: {
  type?: string
  favor_amount?: number | null
  favor_kind?: string | null
  favor_from?: string | null
}): Favor | null {
  // 預かり・返金・調整には付かない(残高の付け替えに「おごり」は無い)
  if (t.type !== undefined && t.type !== 'expense') return null
  const amount = favorAmount(t)
  if (amount === 0) return null
  if (!isFavorKind(t.favor_kind)) return null
  const from = t.favor_kind === 'treat' ? normalizeFavorFrom(t.favor_from ?? '') : ''
  return { kind: t.favor_kind, amount, from }
}

/** おごってもらった回か。(純粋関数) */
export function isTreat(t: Transaction): boolean {
  return favorOf(t)?.kind === 'treat'
}

/**
 * 本来の値段(定価)。(純粋関数)
 * 実際に払った額 + 浮いた額。「3,200円のごちそうを 0円で食べた」の 3,200 のほう。
 */
export function listAmount(t: Transaction): number {
  return t.amount + favorAmount(t)
}

// ---------- 入力の正規化 ----------

/**
 * おごってくれた人の名前を整える。(純粋関数)
 * 前後の空白を落とし、長すぎるものは切る。空になったら空文字。
 *
 * タグ (tags.ts) と違って **中の空白は残す**。「山田 太郎」は1人の名前であって、
 * 詰めてしまうと呼び方が変わってしまう。人の名前をこちらの都合で書き換えない。
 */
export function normalizeFavorFrom(raw: string): string {
  return raw.replace(/[\s　]+/g, ' ').trim().slice(0, MAX_FAVOR_FROM_LENGTH)
}

/**
 * 画面の入力から、保存する形の Favor を作る。(純粋関数)
 * 額が 0 以下・整数でないときは null(= おごりも値引きも付けない)。
 * 値引きに相手の名前は付けない(DB の制約と同じ判断をここでもする)。
 */
export function buildFavor(
  kind: FavorKind | null,
  amountInput: number,
  fromInput: string
): Favor | null {
  if (kind === null) return null
  if (!Number.isInteger(amountInput) || amountInput <= 0) return null
  return {
    kind,
    amount: amountInput,
    from: kind === 'treat' ? normalizeFavorFrom(fromInput) : '',
  }
}

/** 保存する3列の形にする。(純粋関数。無しのときも「無し」を明示的に送る) */
export function favorColumns(favor: Favor | null): {
  favor_amount: number
  favor_kind: FavorKind | null
  favor_from: string
} {
  if (favor === null) return { favor_amount: 0, favor_kind: null, favor_from: '' }
  return { favor_amount: favor.amount, favor_kind: favor.kind, favor_from: favor.from }
}

// ---------- 表示 ----------

// 金額は ¥ 付きの素の文字列で書く。画面側が maskAmountsIn で包めば
// 目隠し (機能169) にそのまま追随する(splits.ts の言い回しと同じ作法)。

/**
 * 履歴の1行に添える短い言葉。(純粋関数)
 * 相手の名前があるときは必ず出す — 名前こそがこの記録の値打ちなので、
 * 一覧を眺めているだけで「誰にご馳走になったか」が目に入るようにする。
 */
export function favorBadgeText(favor: Favor): string {
  if (favor.kind === 'discount') return `${yenPlain(favor.amount)} 割引`
  return favor.from === ''
    ? `${yenPlain(favor.amount)} おごり`
    : `${favor.from}さんのおごり ${yenPlain(favor.amount)}`
}

/**
 * 入力中に出す確認の1行。(純粋関数)
 * 「本来いくらで、自分はいくら払うのか」を、保存する前に必ず読めるようにする。
 * 全額おごりのときは 0円 で保存されることを言葉でも書く
 * (金額欄が空のまま保存できるのはこの場合だけなので、不安にさせないため)。
 */
export function favorNoticeText(favor: Favor, paidAmount: number): string {
  const total = paidAmount + favor.amount
  const who = favor.kind === 'treat' ? (favor.from === '' ? 'おごり' : `${favor.from}さんのおごり`) : '割引'
  if (paidAmount <= 0) {
    return `本来 ${yenPlain(total)} のところ、全額 ${who} です。支出は ¥0 で記録されます`
  }
  return `本来 ${yenPlain(total)} のところ、${yenPlain(favor.amount)} が ${who}。支出は ${yenPlain(paidAmount)} で記録されます`
}

// ---------- 集計 ----------

export interface TreatFromPerson {
  /** おごってくれた人。名前を書かずに記録した回は空文字のまま1つに束ねる */
  name: string
  count: number
  total: number
  /** いちばん最近ご馳走になった日 'YYYY-MM-DD' */
  lastDate: string
}

export interface FavorSummary {
  treatCount: number
  treatTotal: number
  discountCount: number
  discountTotal: number
  /** 合計で浮いた額(おごり + 値引き) */
  total: number
  /** おごってくれた人ごとの内訳(額の多い順) */
  people: TreatFromPerson[]
}

/** 期間内の支出のうち、おごり・値引きが付いているもの。(純粋関数) */
export function favorTransactions(
  txs: readonly Transaction[],
  r: DateRange
): { tx: Transaction; favor: Favor }[] {
  const out: { tx: Transaction; favor: Favor }[] = []
  for (const t of txs) {
    if (!inRange(t.date, r)) continue
    const favor = favorOf(t)
    if (favor === null) continue
    out.push({ tx: t, favor })
  }
  return out
}

/**
 * 期間内のおごり・値引きをまとめる。(純粋関数)
 *
 * 人ごとの並びは 額 → 回数 → 名前 で必ず決まる(同額のときに並びがブレて
 * 「さっき見た人」を見失わないように。report.ts のランキングと同じ作法)。
 */
export function favorSummary(txs: readonly Transaction[], r: DateRange): FavorSummary {
  let treatCount = 0
  let treatTotal = 0
  let discountCount = 0
  let discountTotal = 0
  const acc = new Map<string, TreatFromPerson>()

  for (const { tx, favor } of favorTransactions(txs, r)) {
    if (favor.kind === 'discount') {
      discountCount += 1
      discountTotal += favor.amount
      continue
    }
    treatCount += 1
    treatTotal += favor.amount
    const person = acc.get(favor.from) ?? { name: favor.from, count: 0, total: 0, lastDate: '' }
    person.count += 1
    person.total += favor.amount
    if (tx.date > person.lastDate) person.lastDate = tx.date
    acc.set(favor.from, person)
  }

  const people = [...acc.values()].sort(
    (a, b) =>
      b.total - a.total || b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  )
  return {
    treatCount,
    treatTotal,
    discountCount,
    discountTotal,
    total: treatTotal + discountTotal,
    people,
  }
}

/**
 * 入力欄に出す「おごってくれた人」の候補。(純粋関数)
 *
 * 期間で切らず、**記録の全部** から最近ご馳走になった順に並べる。
 * 件数順にしないのは、この欄で防ぎたいのが「同じ人を毎回打ち直すこと」と
 * 「田中 / 田中さん / たなか と揺れて別人になること」だから。
 * 直前に会った人が上にあるのがいちばん役に立つ。
 */
export function treatFromOptions(txs: readonly Transaction[], limit = 8): string[] {
  const lastUsed = new Map<string, string>()
  for (const t of txs) {
    const favor = favorOf(t)
    if (favor === null || favor.kind !== 'treat' || favor.from === '') continue
    const prev = lastUsed.get(favor.from)
    if (prev === undefined || prev < t.date) lastUsed.set(favor.from, t.date)
  }
  return [...lastUsed.entries()]
    .sort((a, b) => (a[1] !== b[1] ? (a[1] < b[1] ? 1 : -1) : a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([name]) => name)
}

/**
 * 人ごとの1行。(純粋関数)
 * 「何回・いくらぶん・最後はいつ」。お礼やお返しを考えるのに要るのはこの3つ。
 */
export function personLineText(person: TreatFromPerson): string {
  const who = person.name === '' ? '名前を書いていない回' : `${person.name}さん`
  return `${who} ${person.count}回・${yenPlain(person.total)}`
}
