// ============================================================
// 履歴の絞り込みと並べ替え (機能145 / 150)
//
// 純粋関数だけを置く。UI(HistoryTab)は「状態を持って、ここに渡す」だけにする。
// 検索・並べ替えは記録が増えるほど効いてくる機能なので、
// 日本語入力(ひらがな/カタカナ/全角半角)の揺れをここで吸収する。
// ============================================================

import type { Transaction } from './types'
import { ownAmount, tagsOf } from './types'
import { monthKeyOffset } from './format'
import { matchesAnyTag } from './tags'

// ---------- 検索文字列の正規化 (機能145) ----------

/**
 * 検索の突き合わせ用に文字列を正規化する。(純粋関数)
 *
 * - NFKC で全角英数・半角カナを統一する(「ｾﾌﾞﾝ」「ＳＥＶＥＮ」を同じ形に寄せる)
 * - 小文字化して英字の大小を無視する
 * - ひらがな → カタカナ に寄せる(「すたば」で「スタバ」を引けるようにする)
 * - 長音・ダッシュ類を「ー」に統一する(「コーヒー」と「コ−ヒ‐」を同じに)
 * - 空白をすべて落とす(「セブン イレブン」でも引けるようにする)
 *
 * 「打った文字が少しでも違うと出てこない」のが検索を捨てさせる一番の原因なので、
 * 取りこぼしを減らす側に倒している。
 */
export function normalizeSearchText(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[‐-―−-]/g, 'ー')
    .replace(/\s+/g, '')
}

/**
 * 検索語を空白区切りの語(AND条件)に分解する。(純粋関数)
 * 空白は正規化で消えてしまうので、分解してから正規化する。
 */
export function searchTokens(query: string): string[] {
  return query
    .split(/[\s　]+/)
    .map(normalizeSearchText)
    .filter((t) => t !== '')
}

/** 1件の取引の検索対象文字列。店名・メモ・カテゴリ名・タグを横断する。(純粋関数) */
export function transactionHaystack(
  t: Transaction,
  labelOf: (id: string | null) => string
): string {
  const parts: string[] = [t.store ?? '', t.memo ?? '']
  if (t.type === 'partner_deposit') {
    // 預かりはカテゴリを持たないので、種別の呼び名で引けるようにする
    parts.push('彼女から預かり')
  } else if (t.type === 'partner_refund') {
    parts.push('彼女に返金')
  } else if (t.type === 'partner_adjust') {
    parts.push('残高の調整')
  } else {
    parts.push(labelOf(t.category))
  }
  // タグ (機能088)。「#デート」でも「デート」でも引けるように # 付きで積む。
  // タグを持たない記録では何も足さないので、既存の検索結果は1件も変わらない
  for (const tag of tagsOf(t)) parts.push(`#${tag}`)
  return normalizeSearchText(parts.join(' '))
}

/** すべての語を含むか(AND検索)。(純粋関数) */
export function matchesTokens(
  t: Transaction,
  tokens: readonly string[],
  labelOf: (id: string | null) => string
): boolean {
  if (tokens.length === 0) return true
  const hay = transactionHaystack(t, labelOf)
  return tokens.every((tok) => hay.includes(tok))
}

// ---------- 並べ替え (機能150) ----------

export type HistorySort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'

export const SORT_OPTIONS: readonly { value: HistorySort; label: string }[] = [
  { value: 'date_desc', label: '日付が新しい順' },
  { value: 'date_asc', label: '日付が古い順' },
  { value: 'amount_desc', label: '金額が高い順' },
  { value: 'amount_asc', label: '金額が低い順' },
]

/**
 * 並べ替えに使う金額。(純粋関数)
 *
 * 支出は「自分の実質支出」(彼女の負担分を除いた額 = ownAmount)を使う。
 * 理由: 一覧・カレンダー・レポートがすべてこの額で表示されているので、
 * 並べ替えだけ支払い総額にすると「表示より小さい額の行が上に来る」ことになり、
 * 高い順に並べて無駄遣いを探す(機能150の目的)ときに嘘になる。
 * 預かりは ownAmount が 0 になってしまうため、表示どおり預かり額そのものを使う。
 */
export function sortAmount(t: Transaction): number {
  return t.type === 'expense' ? ownAmount(t) : t.amount
}

/**
 * 並べ替える。(純粋関数。入力配列は変更しない)
 *
 * 同着のときの順番を必ず決めきる(日付 → 作成時刻 → id)。
 * 入力の並び順に結果が左右されると、絞り込みを変えるたびに行が入れ替わって
 * 「さっき見ていた行」を見失うため。
 */
export function sortTransactions(
  txs: readonly Transaction[],
  sort: HistorySort
): Transaction[] {
  const byNewest = (a: Transaction, b: Transaction) =>
    b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)

  return [...txs].sort((a, b) => {
    switch (sort) {
      case 'date_desc':
        return byNewest(a, b)
      case 'date_asc':
        return (
          a.date.localeCompare(b.date) ||
          a.created_at.localeCompare(b.created_at) ||
          a.id.localeCompare(b.id)
        )
      case 'amount_desc':
        return sortAmount(b) - sortAmount(a) || byNewest(a, b)
      case 'amount_asc':
        return sortAmount(a) - sortAmount(b) || byNewest(a, b)
    }
  })
}

// ---------- 期間・カテゴリの絞り込み ----------

export type HistoryPeriod = 'month' | 'last3' | 'year' | 'all'

export const PERIOD_OPTIONS: readonly { value: HistoryPeriod; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'month', label: 'この月' },
  { value: 'last3', label: '直近3ヶ月' },
  { value: 'year', label: 'この年' },
]

/** カテゴリ未設定(預かりなど)を表す絞り込みキー。実在のカテゴリIDと衝突しない値にする */
export const NO_CATEGORY_KEY = '__none__'

export interface HistoryFilter {
  query: string
  sort: HistorySort
  period: HistoryPeriod
  /** 空配列 = すべてのカテゴリ */
  categories: string[]
  /**
   * タグの絞り込み (機能088)。空 / 未指定 = すべて。
   * 任意にしてあるのは、この項目より前に localStorage へ保存された条件
   * (savedFilters)を読み直したときに壊れないようにするため。
   */
  tags?: string[]
}

/** 絞り込みに指定されたタグ。未指定は空配列。(純粋関数) */
export function filterTags(filter: HistoryFilter): string[] {
  return filter.tags ?? []
}

/**
 * 既定の絞り込み。期間は「すべて」にしてある。
 * 検索の目的は「あの支出いつだっけ」を解決することなので、
 * 打った言葉が表示中の月に無いだけで「見つかりません」と言われては役に立たない。
 * 期間は絞りたいときに明示的に選ぶ。
 * (絞っていないときは検索結果ではなくカレンダー + その日の明細が出るので、
 *  この既定値が普段の見え方を変えることはない)
 */
export const DEFAULT_FILTER: HistoryFilter = {
  query: '',
  sort: 'date_desc',
  period: 'all',
  categories: [],
  tags: [],
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const day = new Date(y, m, 0).getDate()
  return `${month}-${String(day).padStart(2, '0')}`
}

/**
 * 期間の指定を日付の範囲に直す。(純粋関数)
 * 基準は「今日」ではなく画面で表示中の月。カレンダーで遡った月のまま
 * 「直近3ヶ月」を選んだときに、その月を末尾とした3ヶ月になるほうが迷わない。
 */
export function periodRange(
  period: HistoryPeriod,
  month: string
): { from: string; to: string } | null {
  switch (period) {
    case 'all':
      return null
    case 'month':
      return { from: `${month}-01`, to: lastDayOfMonth(month) }
    case 'last3':
      return { from: `${monthKeyOffset(month, -2)}-01`, to: lastDayOfMonth(month) }
    case 'year': {
      const year = month.slice(0, 4)
      return { from: `${year}-01-01`, to: `${year}-12-31` }
    }
  }
}

export interface FilterContext {
  /** 表示中の月 ('YYYY-MM')。期間の基準に使う */
  month: string
  labelOf: (id: string | null) => string
}

/** 絞り込み + 並べ替えをまとめて適用する。(純粋関数) */
export function filterTransactions(
  txs: readonly Transaction[],
  filter: HistoryFilter,
  ctx: FilterContext
): Transaction[] {
  const range = periodRange(filter.period, ctx.month)
  const tokens = searchTokens(filter.query)
  const cats = filter.categories
  const tags = filterTags(filter)
  const hit = txs.filter((t) => {
    if (range && (t.date < range.from || t.date > range.to)) return false
    if (cats.length > 0 && !cats.includes(t.category ?? NO_CATEGORY_KEY)) return false
    // タグ (機能088)。選んだタグのどれかが付いていれば通す(カテゴリと同じ OR)
    if (!matchesAnyTag(t, tags)) return false
    return matchesTokens(t, tokens, ctx.labelOf)
  })
  return sortTransactions(hit, filter.sort)
}

/** 同じ絞り込みか(保存済み条件と今の状態の突き合わせ用)。(純粋関数) */
export function sameFilter(a: HistoryFilter, b: HistoryFilter): boolean {
  // タグ (機能088) は後から足した任意の項目なので、未指定は空配列として比べる
  const at = filterTags(a)
  const bt = filterTags(b)
  return (
    a.query.trim() === b.query.trim() &&
    a.sort === b.sort &&
    a.period === b.period &&
    a.categories.length === b.categories.length &&
    [...a.categories].sort().join('\u0000') === [...b.categories].sort().join('\u0000') &&
    at.length === bt.length &&
    [...at].sort().join('\u0000') === [...bt].sort().join('\u0000')
  )
}

/**
 * 既定の見え方(カレンダー + その日の明細)から外れているか。(純粋関数)
 * true のときだけ検索結果の一覧に切り替える。
 */
export function isFilterActive(filter: HistoryFilter): boolean {
  return !sameFilter(filter, DEFAULT_FILTER)
}

/** 保存名の初期値や、いま何で絞っているかの説明文。(純粋関数) */
export function describeFilter(filter: HistoryFilter, labelOf: (id: string | null) => string): string {
  const parts: string[] = []
  const q = filter.query.trim()
  if (q !== '') parts.push(`「${q}」`)
  if (filter.categories.length > 0) {
    parts.push(
      filter.categories
        .map((c) => (c === NO_CATEGORY_KEY ? '未分類' : labelOf(c)))
        .join('・')
    )
  }
  const tags = filterTags(filter)
  if (tags.length > 0) parts.push(tags.map((t) => `#${t}`).join('・'))
  parts.push(PERIOD_OPTIONS.find((p) => p.value === filter.period)?.label ?? '')
  if (filter.sort !== DEFAULT_FILTER.sort) {
    parts.push(SORT_OPTIONS.find((s) => s.value === filter.sort)?.label ?? '')
  }
  return parts.filter((p) => p !== '').join(' / ')
}
