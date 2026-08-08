// ============================================================
// レポートのタグ軸 (機能088 のタグを、レポート 112 / 128 につなぐ)
//
// ---- なぜ「サブカテゴリ」ではなくタグなのか ----
// 旅行・デート・出張の支出は **カテゴリをまたぐ**(旅行中の食費も交通費も
// 宿泊費も、ぜんぶ「旅行」)。カテゴリの下にぶら下げる形にすると、
// カテゴリの数だけ「旅行用の食費」「旅行用の交通費」を作ることになって破綻する。
// 横断の軸は tags 列(機能088)としてすでに入力・履歴にあるので、
// レポート側は **それを束ね直すだけ** にした。列も画面の入力も増やさない。
//
// ---- 新しい計算式を作らない ----
// 金額はすべて report.ts の totalOwn / rankByKeys / rankByCategory を通す。
// このファイルがやるのは「どの取引をどのまとまりに入れるか」を決めることだけ。
// 同じ数字が2通りの式から出ると、どちらが正しいのか分からなくなるため。
//
// ---- 合計が総額と一致しないこと ----
// 1件に複数のタグが付きうるので、タグ別の合計を足しても期間の総額にはならない。
// 黙って出すと「計算が合っていない」と見えるので、二重に数えた分(overlap)を
// 集計の側で必ず出し、画面はそれを言葉で断る。
// 一方 日常/非日常 の切り分けは **どちらか一方にしか入らない分け方** なので、
// 足せば必ず総額に一致する。用途がぶつからないよう、両者を別の関数にしてある。
// ============================================================

import type { Transaction } from './types'
import { tagsOf } from './types'
import type { DateRange, RankItem } from './report'
import {
  filterByRange,
  ownExpenses,
  rangeDays,
  rankByCategory,
  rankByKeys,
  totalOwn,
} from './report'
import { collectTags, hasAnyTag } from './tags'

/** タグが1つも付いていない支出をまとめる見出し */
export const NO_TAG_LABEL = 'タグなし'

/**
 * 「タグなし」の束ねキー。空文字にできるのは、normalizeTag が空のタグを
 * 作らせない(必ず null になる)ため — 実在のタグと衝突しない。
 * カテゴリ・お店の集計が未設定を '' で束ねているのとも揃う。
 */
export const NO_TAG_KEY = ''

export interface TagRankItem extends RankItem {
  /** 実際のタグ名。「タグなし」の行は null */
  tag: string | null
}

function toTagItem(item: RankItem): TagRankItem {
  return { ...item, tag: item.key === NO_TAG_KEY ? null : item.key }
}

/** その取引を数えるタグのキー。1つも付いていなければ「タグなし」に入れる */
function tagKeysOf(t: Transaction): string[] {
  const tags = tagsOf(t)
  return tags.length > 0 ? tags : [NO_TAG_KEY]
}

// ---------- タグ別の集計 ----------

export interface TagBreakdown {
  /** タグ別の合計(多い順)。末尾ではなく金額順の中に「タグなし」も混ざる */
  items: TagRankItem[]
  /** 期間の総支出。既存の totalOwn とまったく同じ数字 */
  total: number
  /** items を足した数。複数タグの分だけ total より大きくなる */
  itemsTotal: number
  /** 二重に数えられた金額(itemsTotal − total)。0 なら重なりなし */
  overlap: number
  /** 2つ以上タグが付いている支出の件数(重なりの理由を件数でも言えるように) */
  multiTagCount: number
}

/**
 * 期間内のタグ別集計。(純粋関数)
 * 1件に複数タグが付いていれば、そのすべてに満額で数える
 * (「旅行の食費」を旅行にも食費にも数えるのと同じ考え方。按分すると
 *  「旅行でいくら使ったか」が答えられなくなる)。
 */
export function tagBreakdown(txs: readonly Transaction[], r: DateRange): TagBreakdown {
  const items = rankByKeys(txs, r, tagKeysOf, (key) =>
    key === NO_TAG_KEY ? NO_TAG_LABEL : key
  ).map(toTagItem)

  const total = totalOwn(txs, r)
  const itemsTotal = items.reduce((s, i) => s + i.total, 0)
  const multiTagCount = ownExpenses(txs, r).filter((t) => tagsOf(t).length >= 2).length

  return {
    items,
    total,
    itemsTotal,
    // 端数ではなく「重なった分」なので、負にはならない(念のため下限を 0 にする)
    overlap: Math.max(itemsTotal - total, 0),
    multiTagCount,
  }
}

/** そのタグが付いた取引だけを取り出す。(純粋関数) */
export function withTag(txs: readonly Transaction[], tag: string): Transaction[] {
  return txs.filter((t) => tagsOf(t).includes(tag))
}

/** 渡したタグが**すべて**付いた取引だけを取り出す。(純粋関数。AND 条件) */
export function withTags(txs: readonly Transaction[], tags: readonly string[]): Transaction[] {
  return txs.filter((t) => {
    const own = tagsOf(t)
    return tags.every((tag) => own.includes(tag))
  })
}

/** タグが1つも付いていない取引だけを取り出す。(純粋関数) */
export function withoutTags(txs: readonly Transaction[]): Transaction[] {
  return txs.filter((t) => tagsOf(t).length === 0)
}

/**
 * 選んだタグ(または「タグなし」)の中のカテゴリ内訳。(純粋関数)
 * 「今回の旅行の内訳は宿泊◯円・食費◯円」を出すためのもの。
 * 集計そのものは既存の rankByCategory に任せ、ここは絞り込むだけ。
 */
export function tagCategoryBreakdown(
  txs: readonly Transaction[],
  r: DateRange,
  tag: string | null,
  labelOf: (id: string | null) => string
): RankItem[] {
  return rankByCategory(tag === null ? withoutTags(txs) : withTag(txs, tag), r, labelOf)
}

// ---------- 日常 / 非日常 ----------

export interface EverydaySplit {
  /** 集計した期間 */
  range: DateRange
  /** 特別タグがどれも付いていない支出(=普段の暮らし) */
  everyday: number
  /** 特別タグのどれかが付いた支出 */
  special: number
  /** everyday + special。既存の totalOwn と必ず一致する */
  total: number
  everydayCount: number
  specialCount: number
  /** 期間の日数 */
  days: number
  /** 普段の支出の1日あたり(旅行を除くと1日いくらか) */
  everydayPerDay: number
  /**
   * 特別タグごとの内訳(多い順)。1件に特別タグが2つ付いていれば
   * 両方に数えるので、こちらの合計は special と一致しないことがある。
   */
  byTag: TagRankItem[]
}

/**
 * 期間の支出を「普段」と「特別(旅行・デート・出張など)」に分ける。(純粋関数)
 *
 * どのタグを特別とみなすかは呼び出し側から渡す。決め打ちにしないのは、
 * 何を「日常ではない」と感じるかが人によって違う(帰省・推し活・冠婚葬祭…)ため。
 * specialTags が空なら **全部が普段** になる — 何も選んでいない人に
 * 「特別 ¥0」ではなく普段の総額が出るほうが、意味のある初期状態になる。
 */
export function everydaySplit(
  txs: readonly Transaction[],
  r: DateRange,
  specialTags: readonly string[]
): EverydaySplit {
  const specialTxs = txs.filter((t) => hasAnyTag(t, specialTags))
  const everydayTxs = txs.filter((t) => !hasAnyTag(t, specialTags))

  const everyday = totalOwn(everydayTxs, r)
  const special = totalOwn(specialTxs, r)
  const days = rangeDays(r)

  return {
    range: r,
    everyday,
    special,
    // totalOwn(txs, r) と同じ値。2つに分けた足し算がそのまま総額になることを
    // 型の上でも保証したいので、あえて足して返す
    total: everyday + special,
    everydayCount: ownExpenses(everydayTxs, r).length,
    specialCount: ownExpenses(specialTxs, r).length,
    days,
    everydayPerDay: Math.round(everyday / days),
    byTag: rankByKeys(
      specialTxs,
      r,
      (t) => tagsOf(t).filter((tag) => specialTags.includes(tag)),
      (key) => key
    ).map(toTagItem),
  }
}

// ---------- 出来事(期間をまたぐ集計) ----------

/**
 * これ以上あいだが空いたら「別の回」とみなす日数。
 *
 * 旅行は月をまたぐので、月で切ると1回の旅行が2つに割れてしまう。かといって
 * そのタグの最初から最後まで(min〜max)を1つにすると、「デート」のように
 * 何度も付くタグが1年まるごと1回の出来事になってしまう。
 * 記録が空いた日数で切るのがいちばん素直で、7日にしたのは
 * 旅行や出張の中日(移動だけで何も買わない日)を割らない程度に長く、
 * 別の月の旅行どうしを繋げてしまわない程度に短いため。
 */
export const EVENT_GAP_DAYS = 7

export interface TagEvent {
  tag: string
  /** その回の最初の記録から最後の記録まで */
  range: DateRange
  /** range の日数(両端を含む) */
  days: number
  total: number
  count: number
  categories: RankItem[]
}

/** 'YYYY-MM-DD' の差(日) */
function daysBetween(from: string, to: string): number {
  return rangeDays({ start: from, end: to }) - 1
}

/**
 * そのタグが付いた記録を「回」ごとに束ねる。(純粋関数)
 *
 * 期間の指定を受け取らないのが肝で、**月をまたぐ旅行をそのまま1回として**
 * 出せるようにするため。日付順に並べ、gapDays より長く空いたところで切る。
 * 新しい回が先(= 直近の旅行がいちばん上)。
 *
 * gapDays に Infinity を渡せば、最初から最後までをまとめた1つになる。
 */
export function tagEvents(
  txs: readonly Transaction[],
  tag: string,
  labelOf: (id: string | null) => string,
  gapDays: number = EVENT_GAP_DAYS
): TagEvent[] {
  return eventsOf(withTag(txs, tag), tag, labelOf, gapDays)
}

/**
 * すでに絞り込んだ取引を「回」ごとに束ねる。(純粋関数)
 * tagEvents(1つのタグ)と、共起タグで2つに絞った場合(selectionEvents)で
 * **まったく同じ切り方**を使うために切り出してある。切り方が2つあると、
 * 「#旅行」で見た回と「#旅行 × #2026和歌山」で見た回の境目がずれる。
 */
function eventsOf(
  tagged: readonly Transaction[],
  tag: string,
  labelOf: (id: string | null) => string,
  gapDays: number
): TagEvent[] {
  // 日付だけで束ねる。金額が0の行(彼女が全額出した分)も「その日そこにいた」印
  // として境目の判断には使う — 抜くと1回の旅行が割れてしまうため
  const dates = [...new Set(tagged.map((t) => t.date))].sort()
  if (dates.length === 0) return []

  const runs: DateRange[] = []
  let start = dates[0]
  let prev = dates[0]
  for (const d of dates.slice(1)) {
    if (daysBetween(prev, d) > gapDays) {
      runs.push({ start, end: prev })
      start = d
    }
    prev = d
  }
  runs.push({ start, end: prev })

  return runs
    .map((range) => ({
      tag,
      range,
      days: rangeDays(range),
      // 金額は既存の集計をそのまま使う。この期間にはこのタグの記録しか無い
      total: totalOwn(tagged, range),
      count: ownExpenses(tagged, range).length,
      categories: rankByCategory(tagged, range, labelOf),
    }))
    .reverse() // 直近の回を先頭に
}

/**
 * そのタグが付いた記録の最初から最後まで、をまとめた1つ。(純粋関数)
 * 「デート全体でいくら使ったか」を出すのに使う。1件も無ければ null。
 */
export function tagSpan(
  txs: readonly Transaction[],
  tag: string,
  labelOf: (id: string | null) => string
): TagEvent | null {
  return tagEvents(txs, tag, labelOf, Number.POSITIVE_INFINITY)[0] ?? null
}

// ============================================================
// 共起タグのドリルダウン(「#旅行」の中の「#2026和歌山」)
//
// ---- なぜ階層タグ(親子関係)にしなかったか ----
// 「旅行タグの下に 2026和歌山 をぶら下げたい」という要望に対して、
// tags 列に親子を持たせる案は **採らなかった**。理由は3つ:
//
//   1. **入力が増える。** 入力は「カテゴリ → 金額」の最短5タップまで詰めてある。
//      階層を宣言する形にすると、記録のたびに「親を選ぶ → 子を選ぶ」が挟まる。
//      いまの形なら、旅行モードを1回押すときに行き先を1度打つだけで済む。
//   2. **データの形が変わる。** タグは transactions.tags(text[])の文字列配列で、
//      親子を持たせるには別テーブルか命名規則(「旅行/2026和歌山」など)が要る。
//      するとタグを読むところ **すべて**(履歴の絞り込み・検索・CSV・共有・
//      レポート)に階層の概念が漏れる。マイグレーション未実行の環境が現に
//      想定されている以上、tags 列の形を変える判断は割に合わない。
//   3. **2階層で止まる保証がない。** 次は「1日目」「往路」が欲しくなる。
//      階層は一度作ると深さの上限を決める根拠が無くなる。
//
// 代わりに **「いま選んでいるタグと一緒に付いているタグ」** を出す。
// `旅行` と `2026和歌山` をフラットに2つ付けるだけで、レポートが勝手に
// 内側を見せる。宣言が要らないので `デート × 2026誕生日`、`出張 × 大阪` にも
// 同じ仕組みがそのまま効く。掘れるのは **1段だけ**(親 → 内側)で止める —
// 何段でも掘れるようにすると、上の 3. と同じ問題を画面側で作ることになる。
// ============================================================

/**
 * トップのタグ一覧に出さない「内側のタグ」を決める。(純粋関数)
 *
 * 判定はただ1つ: **そのタグが付いた記録が、1件残らず「そのタグより広いタグ」と
 * 一緒に付いているか。** いつも誰かの内側にしか現れないタグは、単独では
 * 意味を持たない行き先タグとみなして、トップの一覧から外す。
 *
 * 「広い」は次の順で決める:
 *   1. **特別タグ(reportTagSettings の 旅行・デート・出張…)は決して内側にしない。**
 *      同じ数だけ付いていても、どちらが親かを決められる唯一の手がかりがこれ。
 *      1回目の旅行では `旅行` と `2026和歌山` が同じ35件になり、件数だけでは
 *      親子が決まらない ——「特別な支出」として利用者が自分で選んでいるタグを
 *      親とみなすのがいちばん素直で、**新しい宣言を1つも増やさない**。
 *   2. それ以外は **件数が多い方が親**(旅行は何度も、行き先は1回)。
 *      同数のときはどちらも隠さない(strictly greater で比べている) —
 *      僅差で一覧からタグが出たり消えたりする方が、二重計上が少し見えるより困る。
 *
 * 数えるのは**全期間**で、選んでいる月ではない。タグが親か子かは記録全体の
 * 性質であって、見ている月によって入れ替わってよいものではないため
 * (月を送るたびに一覧からタグが消えると、壊れているように見える)。
 *
 * 1件でも単独で出てくるタグ(= 旅行タグを付け忘れた回があるとき)は
 * 隠さない。どの親からも辿れないタグを隠すと、その金額が一覧から消えてしまう。
 */
export function innerTagSet(
  txs: readonly Transaction[],
  specialTags: readonly string[]
): Set<string> {
  const counts = new Map<string, number>()
  for (const t of txs) {
    for (const tag of new Set(tagsOf(t))) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  const special = new Set(specialTags)
  // 「全部の記録で親がいた」ものだけを残したいので、候補から引いていく
  const inner = new Set([...counts.keys()].filter((tag) => !special.has(tag)))
  for (const t of txs) {
    const tags = [...new Set(tagsOf(t))]
    for (const tag of tags) {
      if (!inner.has(tag)) continue
      const own = counts.get(tag) ?? 0
      const hasParent = tags.some(
        (other) => other !== tag && (special.has(other) || (counts.get(other) ?? 0) > own)
      )
      if (!hasParent) inner.delete(tag)
    }
  }
  return inner
}

export interface TagOutline {
  /** トップに出すタグ(「タグなし」を含む・金額順) */
  top: TagRankItem[]
  /** トップには出さず、親を選んだときだけ出すタグ(金額順) */
  inner: TagRankItem[]
  /** 期間の総支出。既存の totalOwn とまったく同じ数字 */
  total: number
  /** top を足した数。複数タグの分だけ total より大きくなる */
  topTotal: number
  /** top のあいだで二重に数えられた金額。0 なら重なりなし */
  overlap: number
  /** top のタグが2つ以上付いている支出の件数 */
  multiTopCount: number
}

/**
 * タグ一覧を「トップに出すもの / 内側にしまうもの」に分ける。(純粋関数)
 *
 * 行き先タグをトップに並べないのは、**二重計上が目に見えて増えるから**。
 * タグ別集計は1件に複数タグが付いていれば両方に満額で数える(按分すると
 * 「旅行でいくら使ったか」が答えられなくなる)ので、`旅行` と `2026和歌山` を
 * 並べると同じ金額が必ず2度出る。既存の注記(「合計が総額より多い理由」)は
 * そのために書いてあるが、行き先タグが増えるたびに重なりが膨らむと、
 * 注記そのものが「いつも出ている読み飛ばす文」になってしまう。
 *
 * 内側のタグは消えるのではなく、親を選んだときに出る(coTagBreakdown)。
 */
export function tagOutline(
  txs: readonly Transaction[],
  r: DateRange,
  specialTags: readonly string[]
): TagOutline {
  const breakdown = tagBreakdown(txs, r)
  const inner = innerTagSet(txs, specialTags)
  const top = breakdown.items.filter((i) => i.tag === null || !inner.has(i.tag))
  const topTotal = top.reduce((s, i) => s + i.total, 0)
  const multiTopCount = ownExpenses(txs, r).filter(
    (t) => new Set(tagsOf(t).filter((tag) => !inner.has(tag))).size >= 2
  ).length

  return {
    top,
    inner: breakdown.items.filter((i) => i.tag !== null && inner.has(i.tag)),
    total: breakdown.total,
    topTotal,
    // 内側を外した分だけ、既存の overlap より必ず小さくなる(下限は 0)
    overlap: Math.max(topTotal - breakdown.total, 0),
    multiTopCount,
  }
}

export interface CoTagBreakdown {
  /** 選んでいるタグ */
  parent: string
  /** 一緒に付いているタグ(多い順)。親そのものは含まない */
  items: TagRankItem[]
  /** 親タグの期間内合計(tagBreakdown の親の行と同じ数字) */
  total: number
  /** 親タグしか付いていない支出の合計 */
  soloTotal: number
  soloCount: number
}

/**
 * そのタグと**一緒に付いている**タグの集計。(純粋関数)
 *
 * 期間を渡すのは、トップの一覧と同じ期間で数えるため。ただし押した先の
 * 「回ごと」は期間を無視する(旅行は月をまたぐ)ので、そこは selectionEvents。
 */
export function coTagBreakdown(
  txs: readonly Transaction[],
  r: DateRange,
  parent: string
): CoTagBreakdown {
  const tagged = withTag(txs, parent)
  const solo = tagged.filter((t) => tagsOf(t).length === 1)
  return {
    parent,
    items: rankByKeys(
      tagged,
      r,
      (t) => tagsOf(t).filter((tag) => tag !== parent),
      (key) => key
    ).map(toTagItem),
    total: totalOwn(tagged, r),
    soloTotal: totalOwn(solo, r),
    soloCount: ownExpenses(solo, r).length,
  }
}

/**
 * レポートで選んでいるタグ。**1段だけ**掘れる。
 * tag = null は「タグなし」を選んでいる状態(既存の挙動)。
 */
export interface TagSelection {
  tag: string | null
  /** 一緒に付いているタグのうち、さらに選んだもの。null = 掘っていない */
  co: string | null
}

/** 選択に含まれる実タグ(親 → 内側の順)。(純粋関数) */
export function selectionTags(sel: TagSelection): string[] {
  const out: string[] = []
  if (sel.tag !== null) out.push(sel.tag)
  if (sel.co !== null && sel.co !== sel.tag) out.push(sel.co)
  return out
}

/** 画面と Discord に出す呼び名。(純粋関数) */
export function selectionLabel(sel: TagSelection): string {
  const tags = selectionTags(sel)
  if (tags.length === 0) return NO_TAG_LABEL
  return tags.map((t) => `#${t}`).join(' › ')
}

/** 選択に当てはまる取引。(純粋関数。2つ選んでいれば AND) */
export function selectionTxs(txs: readonly Transaction[], sel: TagSelection): Transaction[] {
  if (sel.tag === null) return withoutTags(txs)
  return withTags(txs, selectionTags(sel))
}

/** 選択の中のカテゴリ内訳。(純粋関数) */
export function selectionCategoryBreakdown(
  txs: readonly Transaction[],
  r: DateRange,
  sel: TagSelection,
  labelOf: (id: string | null) => string
): RankItem[] {
  return rankByCategory(selectionTxs(txs, sel), r, labelOf)
}

/**
 * 選択の「回ごと」。(純粋関数)
 *
 * 行き先タグを選んでいるときも、**切り方は1つのタグのときとまったく同じ**
 * (記録が EVENT_GAP_DAYS より長く空いたら別の回)。行き先タグを付けていない
 * 過去の旅行は、この切り方でしか個別に見られないので、両方を残してある。
 */
export function selectionEvents(
  txs: readonly Transaction[],
  sel: TagSelection,
  labelOf: (id: string | null) => string,
  gapDays: number = EVENT_GAP_DAYS
): TagEvent[] {
  if (sel.tag === null) return []
  return eventsOf(selectionTxs(txs, sel), sel.co ?? sel.tag, labelOf, gapDays)
}

/** 選択の全期間をまとめた1つ。(純粋関数。1件も無ければ null) */
export function selectionSpan(
  txs: readonly Transaction[],
  sel: TagSelection,
  labelOf: (id: string | null) => string
): TagEvent | null {
  return selectionEvents(txs, sel, labelOf, Number.POSITIVE_INFINITY)[0] ?? null
}

/**
 * 期間内に実際に使われているタグ(多い順)。(純粋関数)
 * 特別タグを選ぶチップの並びに使う。collectTags(tags.ts)は件数だけを見て
 * 期間を問わないので、レポートでは「この期間に出てくる順」を別に用意する。
 */
export function tagsInRange(txs: readonly Transaction[], r: DateRange): string[] {
  return tagBreakdown(txs, r)
    .items.filter((i) => i.tag !== null)
    .map((i) => i.tag as string)
}

/**
 * 「特別なタグ」を選ぶチップの並び。(純粋関数)
 *
 * よく使うタグから順に出す(collectTags と同じ順)。そのうえで keep に渡した
 * タグは、**記録に1件も付いていなくても** 末尾に残す。理由は2つ:
 *   - 既定の 旅行/デート/出張 は、まだ一度も使っていない段階でも
 *     候補として見えている必要がある(使ってから出す作りだと、
 *     初期値を外したあとに戻せなくなる)
 *   - 選んでいるタグが履歴から消えたときに外せなくなると、金額が
 *     理由の分からないまま特別側に寄り続ける
 */
export function specialTagOptions(
  txs: readonly Transaction[],
  keep: readonly string[],
  limit = 40
): string[] {
  const out = collectTags(txs, limit).map((u) => u.tag)
  for (const tag of keep) {
    if (!out.includes(tag)) out.push(tag)
  }
  return out
}

/** 期間内に記録が1件でもあるか(カードを出すかどうかの判断に使う)。(純粋関数) */
export function hasAnyTaggedTx(txs: readonly Transaction[], r: DateRange): boolean {
  return filterByRange(txs, r).some((t) => tagsOf(t).length > 0)
}
