// ============================================================
// 履歴の絞り込みと並べ替え (機能145 / 150)
//
// 純粋関数だけを置く。UI(HistoryTab)は「状態を持って、ここに渡す」だけにする。
// 検索・並べ替えは記録が増えるほど効いてくる機能なので、
// 日本語入力(ひらがな/カタカナ/全角半角)の揺れをここで吸収する。
// ============================================================

import type { Transaction } from './types'
import { ownAmount, storeKey, tagsOf } from './types'
import { monthEndISO, shiftMonth } from './calendar'
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

/**
 * 期間の指定。'custom'(指定)のときだけ from / to の日付を使う。
 *
 * 期間の軸は **これ1本だけ** にしてある。period とは別枠で日付を持たせて
 * 「両方あるときは日付が勝つ」形にすると、「いまどちらが効いているのか」の判断が
 * 絞り込み・説明文・保存名・一致比較(sameFilter)の4箇所に増える。
 * 'custom' を5つめの選択肢にしておけば、判断は「period が何か」だけで済む。
 */
export type HistoryPeriod = 'month' | 'last3' | 'year' | 'all' | 'custom'

export const PERIOD_OPTIONS: readonly { value: HistoryPeriod; label: string }[] = [
  { value: 'all', label: 'すべて' },
  { value: 'month', label: 'この月' },
  { value: 'last3', label: '直近3ヶ月' },
  { value: 'year', label: 'この年' },
  { value: 'custom', label: '指定' },
]

/** 開いた端(片側だけ指定したとき)に使う番兵。日付は文字列比較なので両端に置ける */
const MIN_DATE = '0000-01-01'
const MAX_DATE = '9999-12-31'

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
  /**
   * お店(店名)の絞り込み。空 / 未指定 = すべて。
   *
   * 突き合わせは **完全一致**(types.ts の storeKey = 前後の空白を落とした店名)。
   * 検索(query)のような表記ゆれの吸収は **わざと通していない**。
   * レポートのお店別集計 (report.ts の rankByStore) が同じキーで束ねており、
   * こちらだけ緩めると「レポートで 6件と出ている行を押したのに、
   * 飛んだ先の履歴は 7件」という食い違いが起きるため。
   * 揺れごと拾いたいときはフリーワード検索が既にその役目を持っている。
   *
   * tags と同じく任意 (?) にしてあるのは、この項目より前に localStorage へ
   * 保存された条件 (savedFilters) を読み直したときに壊れないようにするため。
   */
  stores?: string[]
  /**
   * 指定期間の開始日 / 終了日 ('YYYY-MM-DD')。空 / 未指定 = その端は開いたまま。
   *
   * **period が 'custom' のときだけ効く**(period が期間の唯一の軸)。
   * 他の期間を選んでいる間も値は消さずに持ち続ける — チップを行き来しても
   * 入れた日付が消えないほうが直せる。効かない間は sameFilter も無視するので、
   * 「見えないところに残った日付のせいで別の条件だと判定される」ことはない。
   *
   * 片方だけの指定も **そのまま効かせる**(「その日以降」「その日まで」)。
   * 両方揃うまで効かせない作りにすると、開始日を入れた時点では画面が何も
   * 変わらず「押しても何も起きない」状態になる。旅行の絞り込みは
   * 開始 → 終了 の順に入れるので、途中の状態が必ず発生する。
   * 「先月の引っ越し以降ぜんぶ」のような片側だけの用途もそのまま使える。
   *
   * 両端は **含む**(report.ts の inRange と同じ)。
   * tags / stores と同じ任意項目なので、これより前に保存された条件も読める。
   */
  from?: string
  to?: string
}

/** 絞り込みに指定されたタグ。未指定は空配列。(純粋関数) */
export function filterTags(filter: HistoryFilter): string[] {
  return filter.tags ?? []
}

/** 絞り込みに指定されたお店。未指定は空配列。(純粋関数) */
export function filterStores(filter: HistoryFilter): string[] {
  return filter.stores ?? []
}

/**
 * 指定期間の日付。(純粋関数)
 *
 * period が 'custom' のときだけ日付を返す(それ以外は両端とも空)。
 * 期間の軸を1本にしている以上、日付を読む側が毎回 period を見るのではなく、
 * **この関数を通れば必ず「いま効いている日付」になる** 形にしておく。
 *
 * 開始 > 終了 のときは **入れ替える**(report.ts の normalizeRange と同じ作法)。
 * 黙って0件にすると「絞ったのに何も出ない」だけが残り、原因が画面から分からない。
 * 入れ替えたことは画面(HistoryFilterBar の注意書き)と説明文の両方に出る。
 */
export function filterDates(filter: HistoryFilter): { from: string; to: string } {
  if (filter.period !== 'custom') return { from: '', to: '' }
  const from = filter.from ?? ''
  const to = filter.to ?? ''
  if (from !== '' && to !== '' && from > to) return { from: to, to: from }
  return { from, to }
}

/** 開始 > 終了 のまま入っているか(画面の注意書き用)。(純粋関数) */
export function datesReversed(filter: HistoryFilter): boolean {
  if (filter.period !== 'custom') return false
  const from = filter.from ?? ''
  const to = filter.to ?? ''
  return from !== '' && to !== '' && from > to
}

/**
 * 指定期間が実際に効いているか(= 日付が1つ以上入っているか)。(純粋関数)
 * 履歴タブの月送りの見出しを出すかどうかの判断にも使う。
 */
export function customRangeActive(filter: HistoryFilter): boolean {
  const { from, to } = filterDates(filter)
  return from !== '' || to !== ''
}

/**
 * 実際に効いている期間。(純粋関数)
 *
 * 「指定」を選んだだけで日付をまだ入れていない状態は、絞り込みとしては
 * 何もしていないのと同じなので 'all' として扱う。こうしないと
 * 「指定」を押した瞬間に isFilterActive が立ち、カレンダーが消えて
 * **全件の一覧(先頭200件)** に切り替わってしまう — 日付を入れる前に
 * 画面が作り変わるのは、押した人が頼んでいない変化。
 */
export function effectivePeriod(filter: HistoryFilter): HistoryPeriod {
  if (filter.period === 'custom' && !customRangeActive(filter)) return 'all'
  return filter.period
}

/** 'YYYY-MM-DD' → '2026/9/10' */
function slashDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${y}/${Number(m)}/${Number(d)}`
}

/**
 * 指定期間の言い方。効いていなければ空文字。(純粋関数)
 *
 * 保存名 (suggestFilterName) は20文字しか入らないので、
 * 同じ年なら年を繰り返さない('2026/9/10〜9/12' = 14文字)。
 * 開始 > 終了 のときは **入れ替えたあとの範囲** を言う(実際に絞る範囲と揃える)。
 */
export function describeRange(filter: HistoryFilter): string {
  const { from, to } = filterDates(filter)
  if (from === '' && to === '') return ''
  if (from === '') return `${slashDate(to)}まで`
  if (to === '') return `${slashDate(from)}以降`
  const tail = from.slice(0, 4) === to.slice(0, 4) ? slashDate(to).slice(5) : slashDate(to)
  return `${slashDate(from)}〜${tail}`
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
  stores: [],
  from: '',
  to: '',
}

/**
 * 保存された値(localStorage の JSON など)から絞り込み条件を読む。(純粋関数)
 *
 * 既定値をベースに、**知っているキーだけ**を上書きする形にしてある。
 * 1項目ずつ手で写す形にしていたときは、HistoryFilter に項目が増えるたびに
 * 写し忘れの穴が開いた(実際 tags(機能088)が写されておらず、
 * 保存した条件を読み直すとタグだけ消えていた。タグだけで絞った条件は
 * 既定値と同じ内容になり、「呼び出しても何も絞られないのに、
 * 何も絞っていない画面でその条件が選択中に見える」壊れ方をしていた)。
 *
 * 読み手を FILTER_READERS の表にしてあるので、HistoryFilter に項目を足すと
 * 表に穴が空き、**型エラーで気付ける**(実行時に静かに消えることがない)。
 * 読めない値・知らないキーは既定値のままにする。
 */
type FilterReaders = {
  [K in keyof Required<HistoryFilter>]: (raw: unknown) => Required<HistoryFilter>[K] | undefined
}

function stringArray(raw: unknown): string[] | undefined {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : undefined
}

/** 'YYYY-MM-DD' か空文字だけを受け付ける(形の違う値は既定の空に落とす) */
function isoDate(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  if (raw === '') return ''
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined
}

const FILTER_READERS: FilterReaders = {
  query: (raw) => (typeof raw === 'string' ? raw : undefined),
  // 知らない並び順・期間は既定に落とす(選べない値が入ると並べ替えが効かなくなる)
  sort: (raw) => SORT_OPTIONS.find((o) => o.value === raw)?.value,
  period: (raw) => PERIOD_OPTIONS.find((o) => o.value === raw)?.value,
  categories: stringArray,
  tags: stringArray,
  stores: stringArray,
  from: isoDate,
  to: isoDate,
}

export function parseHistoryFilter(raw: unknown): HistoryFilter {
  const out: HistoryFilter = { ...DEFAULT_FILTER }
  if (typeof raw !== 'object' || raw === null) return out
  const src = raw as Record<string, unknown>
  for (const key of Object.keys(FILTER_READERS) as (keyof FilterReaders)[]) {
    const value = FILTER_READERS[key](src[key])
    if (value !== undefined) Object.assign(out, { [key]: value })
  }
  return out
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
    case 'custom':
      // 指定期間は月ではなく条件が持っている日付で決まる。
      // 期間として使うときは必ず filterRange を通すこと(こちらは日付を知らない)
      return null
    case 'month':
      return { from: `${month}-01`, to: monthEndISO(month) }
    case 'last3':
      return { from: `${shiftMonth(month, -2)}-01`, to: monthEndISO(month) }
    case 'year': {
      const year = month.slice(0, 4)
      return { from: `${year}-01-01`, to: `${year}-12-31` }
    }
  }
}

/**
 * 条件が実際に絞る日付の範囲。(純粋関数)
 * 'custom' は月に依らず、条件が持っている日付で決まる。
 * 片側だけの指定は、もう一方の端を開けたまま(番兵)にする。
 */
export function filterRange(
  filter: HistoryFilter,
  month: string
): { from: string; to: string } | null {
  if (filter.period !== 'custom') return periodRange(filter.period, month)
  const { from, to } = filterDates(filter)
  if (from === '' && to === '') return null
  return { from: from === '' ? MIN_DATE : from, to: to === '' ? MAX_DATE : to }
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
  const range = filterRange(filter, ctx.month)
  const tokens = searchTokens(filter.query)
  const cats = filter.categories
  const tags = filterTags(filter)
  // お店は完全一致で突き合わせる(レポートのお店別と同じキー = storeKey)
  const stores = filterStores(filter).map((s) => s.trim())
  const hit = txs.filter((t) => {
    // 両端を含む(report.ts の inRange と同じ)
    if (range && (t.date < range.from || t.date > range.to)) return false
    if (cats.length > 0 && !cats.includes(t.category ?? NO_CATEGORY_KEY)) return false
    // お店 (機能109 の導線)。選んだ店のどれかなら通す(カテゴリと同じ OR)。
    // 店名が空の記録(預かり・返金・調整など)は、店を選んだ時点で必ず落ちる
    if (stores.length > 0 && !stores.includes(storeKey(t))) return false
    // タグ (機能088)。選んだタグのどれかが付いていれば通す(カテゴリと同じ OR)
    if (!matchesAnyTag(t, tags)) return false
    return matchesTokens(t, tokens, ctx.labelOf)
  })
  return sortTransactions(hit, filter.sort)
}

/** 並び順の違いを無視して、同じ顔ぶれか。(純粋関数) */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000')
}

/**
 * 同じ絞り込みか(保存済み条件と今の状態の突き合わせ用)。(純粋関数)
 *
 * ⚠ HistoryFilter に項目を足したら、**必ずここにも1行足すこと**。
 * 読み取り (FILTER_READERS) と違ってここは手書きなので、型は守ってくれない。
 * 書き忘れると isFilterActive が「何も絞っていない」と判定し続けるので、
 * その項目で絞っても一覧に切り替わらず(押しても何も起きない)、
 * 保存ボタンも押せず、findMatchingFilter が別の条件を「一致」と誤判定する。
 */
export function sameFilter(a: HistoryFilter, b: HistoryFilter): boolean {
  const da = filterDates(a)
  const db = filterDates(b)
  return (
    a.query.trim() === b.query.trim() &&
    a.sort === b.sort &&
    // 期間は「実際に効いている形」で比べる。日付を入れていない「指定」は
    // 何も絞っていないのと同じ(effectivePeriod)
    effectivePeriod(a) === effectivePeriod(b) &&
    // 指定期間の日付。filterDates を通しているので、
    // 「指定」以外を選んでいる間に残っている日付は比較に混ざらないし、
    // 開始と終了が逆に入っているだけの条件は同じ条件として扱う
    da.from === db.from &&
    da.to === db.to &&
    sameSet(a.categories, b.categories) &&
    // タグ・お店は後から足した任意の項目なので、未指定は空配列として比べる
    sameSet(filterTags(a), filterTags(b)) &&
    sameSet(filterStores(a), filterStores(b))
  )
}

/**
 * 既定の見え方(カレンダー + その日の明細)から外れているか。(純粋関数)
 * true のときだけ検索結果の一覧に切り替える。
 */
export function isFilterActive(filter: HistoryFilter): boolean {
  return !sameFilter(filter, DEFAULT_FILTER)
}

/**
 * 説明文の部品。(純粋関数)
 *
 * ⚠ HistoryFilter に項目を足したら、**必ずここにも1行足すこと**。
 * ここも手書きなので型は守ってくれない。書き忘れると、その項目で絞っている間
 * 画面のどこにも絞り込みの中身が出ず(何が起きたのか分からなくなる)、
 * 保存名の初期値からも抜け落ちる。
 */
function filterParts(
  filter: HistoryFilter,
  labelOf: (id: string | null) => string,
  opts: { keepDefaultPeriod: boolean }
): string[] {
  const parts: string[] = []
  const q = filter.query.trim()
  if (q !== '') parts.push(`「${q}」`)
  // 指定期間は検索語の次(お店より前)。20文字で切られる保存名で、
  // 「その1回の旅行」を指しているいちばん強い条件が真っ先に消えないようにする。
  // 期間のチップ名(「指定」)はここでは出さない — 範囲そのものが期間を語っている
  const range = describeRange(filter)
  if (range !== '') parts.push(range)
  // お店は検索語のすぐ後ろ(いちばん強い絞り込みなので、切り詰められても残る位置)
  const stores = filterStores(filter)
  if (stores.length > 0) parts.push(`お店:${stores.join('・')}`)
  if (filter.categories.length > 0) {
    parts.push(
      filter.categories
        .map((c) => (c === NO_CATEGORY_KEY ? '未分類' : labelOf(c)))
        .join('・')
    )
  }
  const tags = filterTags(filter)
  if (tags.length > 0) parts.push(tags.map((t) => `#${t}`).join('・'))
  const period = effectivePeriod(filter)
  // 指定期間は上で範囲そのものを出しているので、「指定」を重ねて出さない
  if (period !== 'custom' && (opts.keepDefaultPeriod || period !== DEFAULT_FILTER.period)) {
    parts.push(PERIOD_OPTIONS.find((p) => p.value === period)?.label ?? '')
  }
  if (filter.sort !== DEFAULT_FILTER.sort) {
    parts.push(SORT_OPTIONS.find((s) => s.value === filter.sort)?.label ?? '')
  }
  return parts.filter((p) => p !== '')
}

/**
 * いま何で絞っているかの説明文。(純粋関数)
 *
 * 期間は既定(すべて)でも必ず出す。レポートのお店別から飛んできたときは
 * 全期間で絞り直すので **レポートに出ていた件数とは変わる**。
 * その理由が画面に出ていないと「黙って数字が変わった」ように見える。
 */
export function describeFilter(filter: HistoryFilter, labelOf: (id: string | null) => string): string {
  return filterParts(filter, labelOf, { keepDefaultPeriod: true }).join(' / ')
}

/** 保存名の初期値の長さ(これを超えるぶんは名前から消える) */
export const FILTER_NAME_MAX = 20

/**
 * 「この条件を保存」の名前の初期値。(純粋関数)
 *
 * 説明文をそのまま切り詰めると、後ろの条件から順に名前から消えていく。
 * お店(機能109 の導線)を足して条件が1つ増えたぶん、
 * **既定のまま何も選んでいない期間(「すべて」)は名前からは落として席を空けている**。
 * 画面の説明文からは落とさない — そちらでは期間が全期間であることが
 * 「レポートと件数が違う」ことの説明になっているため。
 *
 * 指定期間(日付範囲)を足したぶん、名前が入りきらなくなる度合いが悪化しないよう
 * 2つ手当てしてある:
 *   ・同じ年なら年を繰り返さない('2026/9/10〜9/12' = 14文字。describeRange)
 *   ・置き場所は検索語の次(お店・カテゴリ・タグより前)。
 *     切られるのは後ろからなので、旅行1回を指す日付が真っ先に消えない
 */
export function suggestFilterName(
  filter: HistoryFilter,
  labelOf: (id: string | null) => string
): string {
  return filterParts(filter, labelOf, { keepDefaultPeriod: false })
    .join(' / ')
    .slice(0, FILTER_NAME_MAX)
}
