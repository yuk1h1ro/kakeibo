import { describe, expect, it } from 'vitest'
import type { Transaction } from './types'
import {
  DEFAULT_FILTER,
  NO_CATEGORY_KEY,
  describeFilter,
  filterStores,
  filterTransactions,
  isFilterActive,
  normalizeSearchText,
  parseHistoryFilter,
  periodRange,
  sameFilter,
  searchTokens,
  sortAmount,
  sortTransactions,
  suggestFilterName,
  transactionHaystack,
  type HistoryFilter,
} from './historyFilter'
import { rankByStore } from './report'

let seq = 0
function tx(p: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: p.id ?? `id${String(seq).padStart(3, '0')}`,
    date: '2026-08-04',
    type: 'expense',
    amount: 1000,
    category: 'food',
    memo: '',
    store: '',
    partner_amount: 0,
    created_at: '2026-08-04T03:00:00.000Z',
    ...p,
  }
}

const labelOf = (id: string | null) =>
  id === 'food' ? '食費' : id === 'eating_out' ? '外食' : id === null ? '未分類' : id

describe('normalizeSearchText', () => {
  it('全角英数・半角カナを揃える', () => {
    expect(normalizeSearchText('ＳＥＶＥＮ')).toBe('seven')
    expect(normalizeSearchText('ｾﾌﾞﾝ')).toBe('セブン')
  })

  it('ひらがなをカタカナに寄せる(「すたば」で「スタバ」を引ける)', () => {
    expect(normalizeSearchText('すたば')).toBe(normalizeSearchText('スタバ'))
  })

  it('空白を落とす', () => {
    expect(normalizeSearchText('セブン　イレブン')).toBe('セブンイレブン')
  })

  it('長音・ハイフン類を揃える', () => {
    expect(normalizeSearchText('コ-ヒ—')).toBe('コーヒー')
  })

  it('英字の大小を無視する', () => {
    expect(normalizeSearchText('Lawson')).toBe(normalizeSearchText('LAWSON'))
  })
})

describe('searchTokens', () => {
  it('空白で分けて AND 条件にする', () => {
    expect(searchTokens('セブン コーヒー')).toEqual(['セブン', 'コーヒー'])
  })

  it('空文字・空白だけなら語なし', () => {
    expect(searchTokens('   ')).toEqual([])
  })
})

describe('transactionHaystack / filterTransactions の検索', () => {
  it('店名・メモ・カテゴリ名を横断して引ける', () => {
    const t = tx({ store: 'セブンイレブン', memo: '朝ごはん', category: 'food' })
    const hay = transactionHaystack(t, labelOf)
    // 突き合わせ用に正規化された形(ひらがなはカタカナに寄る)で含まれていればよい
    expect(hay).toContain(normalizeSearchText('セブンイレブン'))
    expect(hay).toContain(normalizeSearchText('朝ごはん'))
    expect(hay).toContain(normalizeSearchText('食費'))
  })

  it('ひらがなで打っても店名(カタカナ)に当たる', () => {
    const rows = [tx({ store: 'スターバックス' }), tx({ store: 'ローソン' })]
    const got = filterTransactions(rows, { ...DEFAULT_FILTER, query: 'すたーば', period: 'all' }, {
      month: '2026-08',
      labelOf,
    })
    expect(got).toHaveLength(1)
    expect(got[0].store).toBe('スターバックス')
  })

  it('複数語はすべて含む行だけ当たる (AND)', () => {
    const rows = [
      tx({ store: 'セブンイレブン', memo: 'コーヒー' }),
      tx({ store: 'セブンイレブン', memo: 'おにぎり' }),
    ]
    const got = filterTransactions(
      rows,
      { ...DEFAULT_FILTER, query: 'セブン コーヒー', period: 'all' },
      { month: '2026-08', labelOf }
    )
    expect(got).toHaveLength(1)
    expect(got[0].memo).toBe('コーヒー')
  })

  it('カテゴリ名だけでも引ける', () => {
    const rows = [tx({ category: 'eating_out' }), tx({ category: 'food' })]
    const got = filterTransactions(rows, { ...DEFAULT_FILTER, query: '外食', period: 'all' }, {
      month: '2026-08',
      labelOf,
    })
    expect(got).toHaveLength(1)
    expect(got[0].category).toBe('eating_out')
  })
})

describe('sortAmount', () => {
  it('支出は自分の実質支出(彼女の負担分を除く)', () => {
    expect(sortAmount(tx({ amount: 3000, partner_amount: 1200 }))).toBe(1800)
  })

  it('預かりは預かり額そのもの(表示と同じ額で並ぶ)', () => {
    expect(sortAmount(tx({ type: 'partner_deposit', amount: 30000, category: null }))).toBe(30000)
  })
})

describe('sortTransactions', () => {
  const a = tx({ id: 'a', date: '2026-08-01', amount: 500, created_at: '2026-08-01T01:00:00Z' })
  const b = tx({ id: 'b', date: '2026-08-03', amount: 500, created_at: '2026-08-03T01:00:00Z' })
  const c = tx({ id: 'c', date: '2026-08-02', amount: 900, created_at: '2026-08-02T01:00:00Z' })

  it('日付の新しい順・古い順', () => {
    expect(sortTransactions([a, b, c], 'date_desc').map((t) => t.id)).toEqual(['b', 'c', 'a'])
    expect(sortTransactions([a, b, c], 'date_asc').map((t) => t.id)).toEqual(['a', 'c', 'b'])
  })

  it('金額の高い順・低い順(実質支出で)', () => {
    expect(sortTransactions([a, b, c], 'amount_desc').map((t) => t.id)).toEqual(['c', 'b', 'a'])
    // 同額(a と b)は新しい日付を先に出す — 並び順を必ず決めきる
    expect(sortTransactions([a, b, c], 'amount_asc').map((t) => t.id)).toEqual(['b', 'a', 'c'])
  })

  it('彼女の負担分を除いた額で並ぶ', () => {
    const big = tx({ id: 'big', amount: 5000, partner_amount: 4800 }) // 実質 200
    const small = tx({ id: 'small', amount: 1000, partner_amount: 0 }) // 実質 1000
    expect(sortTransactions([big, small], 'amount_desc').map((t) => t.id)).toEqual(['small', 'big'])
  })

  it('同着でも入力の並び順に左右されない(安定して同じ結果)', () => {
    const x = tx({ id: 'x', date: '2026-08-05', amount: 1000, created_at: '2026-08-05T00:00:00Z' })
    const y = tx({ id: 'y', date: '2026-08-05', amount: 1000, created_at: '2026-08-05T00:00:00Z' })
    const z = tx({ id: 'z', date: '2026-08-05', amount: 1000, created_at: '2026-08-05T00:00:00Z' })
    const first = sortTransactions([x, y, z], 'amount_desc').map((t) => t.id)
    const second = sortTransactions([z, x, y], 'amount_desc').map((t) => t.id)
    const third = sortTransactions([y, z, x], 'date_desc').map((t) => t.id)
    expect(second).toEqual(first)
    expect(third).toEqual(first)
  })

  it('元の配列を書き換えない', () => {
    const rows = [a, b, c]
    sortTransactions(rows, 'amount_desc')
    expect(rows.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('periodRange', () => {
  it('この月は表示中の月の1日〜末日', () => {
    expect(periodRange('month', '2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('直近3ヶ月は表示中の月を末尾にする(年をまたいでも正しい)', () => {
    expect(periodRange('last3', '2026-01')).toEqual({ from: '2025-11-01', to: '2026-01-31' })
  })

  it('この年は1月1日〜12月31日', () => {
    expect(periodRange('year', '2026-08')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('すべては範囲なし', () => {
    expect(periodRange('all', '2026-08')).toBeNull()
  })
})

describe('filterTransactions の期間・カテゴリ', () => {
  const rows = [
    tx({ id: 'jul', date: '2026-07-20' }),
    tx({ id: 'aug', date: '2026-08-02' }),
    tx({ id: 'dep', date: '2026-08-03', type: 'partner_deposit', category: null }),
  ]

  it('既定では期間で絞らない(全期間から探せる)', () => {
    const got = filterTransactions(rows, DEFAULT_FILTER, { month: '2026-08', labelOf })
    expect(got.map((t) => t.id).sort()).toEqual(['aug', 'dep', 'jul'])
  })

  it('「この月」を選ぶと表示中の月だけになる', () => {
    const f: HistoryFilter = { ...DEFAULT_FILTER, period: 'month' }
    expect(filterTransactions(rows, f, { month: '2026-08', labelOf }).map((t) => t.id).sort()).toEqual([
      'aug',
      'dep',
    ])
  })

  it('カテゴリで絞る(未分類も選べる)', () => {
    const f: HistoryFilter = { ...DEFAULT_FILTER, period: 'all', categories: [NO_CATEGORY_KEY] }
    expect(filterTransactions(rows, f, { month: '2026-08', labelOf }).map((t) => t.id)).toEqual([
      'dep',
    ])
  })
})

describe('sameFilter / isFilterActive', () => {
  it('既定のままなら絞り込んでいない扱い', () => {
    expect(isFilterActive(DEFAULT_FILTER)).toBe(false)
    expect(isFilterActive({ ...DEFAULT_FILTER, query: '  ' })).toBe(false)
  })

  it('検索語・並び順・期間・カテゴリのどれかが違えば絞り込み中', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, query: 'a' })).toBe(true)
    expect(isFilterActive({ ...DEFAULT_FILTER, sort: 'amount_desc' })).toBe(true)
    expect(isFilterActive({ ...DEFAULT_FILTER, period: 'month' })).toBe(true)
    expect(isFilterActive({ ...DEFAULT_FILTER, categories: ['food'] })).toBe(true)
  })

  it('カテゴリの並び順が違うだけなら同じ条件とみなす', () => {
    expect(
      sameFilter(
        { ...DEFAULT_FILTER, categories: ['food', 'daily'] },
        { ...DEFAULT_FILTER, categories: ['daily', 'food'] }
      )
    ).toBe(true)
  })
})

describe('タグでの絞り込み (機能088)', () => {
  const dateTx = tx({ id: 'date', store: '映画館', tags: ['デート'] })
  const tripTx = tx({ id: 'trip', store: '旅館', tags: ['旅行2026', 'デート'] })
  const plainTx = tx({ id: 'plain', store: 'スーパー' })
  const rows = [dateTx, tripTx, plainTx]
  const ctx = { month: '2026-08', labelOf }

  it('タグ未指定なら全件を通す(既存の絞り込みの挙動は変わらない)', () => {
    expect(filterTransactions(rows, DEFAULT_FILTER, ctx)).toHaveLength(3)
    // tags キー自体が無い保存済み条件でも落ちない
    const legacy = { query: '', sort: 'date_desc', period: 'all', categories: [] } as HistoryFilter
    expect(filterTransactions(rows, legacy, ctx)).toHaveLength(3)
  })

  it('選んだタグのどれかが付いている記録だけに絞る', () => {
    const only = filterTransactions(rows, { ...DEFAULT_FILTER, tags: ['旅行2026'] }, ctx)
    expect(only.map((t) => t.id)).toEqual(['trip'])
    const either = filterTransactions(rows, { ...DEFAULT_FILTER, tags: ['旅行2026', 'デート'] }, ctx)
    expect(either.map((t) => t.id).sort()).toEqual(['date', 'trip'])
  })

  it('カテゴリの絞り込みと重ねると AND になる', () => {
    const hit = filterTransactions(
      rows,
      { ...DEFAULT_FILTER, tags: ['デート'], categories: ['food'] },
      ctx
    )
    expect(hit).toHaveLength(2)
    const miss = filterTransactions(
      rows,
      { ...DEFAULT_FILTER, tags: ['デート'], categories: ['transport'] },
      ctx
    )
    expect(miss).toHaveLength(0)
  })

  it('検索欄からも「#タグ」「タグ」で引ける', () => {
    expect(transactionHaystack(tripTx, labelOf)).toContain('#旅行2026')
    expect(filterTransactions(rows, { ...DEFAULT_FILTER, query: '#旅行2026' }, ctx)).toHaveLength(1)
    expect(filterTransactions(rows, { ...DEFAULT_FILTER, query: '旅行2026' }, ctx)).toHaveLength(1)
  })

  it('タグを持たない記録の検索対象は今までどおり(店名・メモ・カテゴリ名だけ)', () => {
    expect(transactionHaystack(plainTx, labelOf)).toBe('スーパー食費')
  })

  it('タグの違いは「別の条件」として扱う(保存した条件の突き合わせ)', () => {
    expect(isFilterActive({ ...DEFAULT_FILTER, tags: ['デート'] })).toBe(true)
    expect(
      sameFilter({ ...DEFAULT_FILTER, tags: ['a', 'b'] }, { ...DEFAULT_FILTER, tags: ['b', 'a'] })
    ).toBe(true)
    expect(sameFilter({ ...DEFAULT_FILTER, tags: ['a'] }, DEFAULT_FILTER)).toBe(false)
  })
})

// ============================================================
// お店での絞り込み(レポートのお店別 / 行の長押しからの導線)。
//
// ここは「レポートに出ている件数」と「その行を押した先の履歴の件数」を
// 食い違わせないための取り決めを守る場所:
//   ・突き合わせは **完全一致**(検索の表記ゆれ吸収 normalizeSearchText は通さない)
//   ・レポートのお店別 (report.ts の rankByStore) と同じキー(types.ts の storeKey)
// 片方だけ「揺れも同じ店とみなす」と緩めると、押した瞬間に件数が変わり、
// その食い違い自体が不具合に見える。
// ============================================================
describe('お店での絞り込み', () => {
  const okamoto = tx({ id: 'ok1', store: 'オカモトセルフ', category: 'transport' })
  // 前後の空白だけが違う記録。同じ店として束ねる(レポートも trim して束ねている)
  const padded = tx({ id: 'ok2', store: ' オカモトセルフ ', date: '2026-07-10' })
  // 半角カナ + 支店名。検索なら「オカモトセルフ」で引けるが、店としては別の店
  const kana = tx({ id: 'kana', store: 'ｵｶﾓﾄｾﾙﾌ 東店' })
  const seven = tx({ id: 'sev', store: 'セブンイレブン', category: 'food' })
  const noStore = tx({ id: 'none', store: '' })
  const rows = [okamoto, padded, kana, seven, noStore]
  const ctx = { month: '2026-08', labelOf }
  const ids = (f: HistoryFilter) => filterTransactions(rows, f, ctx).map((t) => t.id).sort()

  it('お店未指定なら全件を通す(既存の絞り込みの挙動は変わらない)', () => {
    expect(filterTransactions(rows, DEFAULT_FILTER, ctx)).toHaveLength(5)
    // stores キー自体が無い(この項目より前に保存された)条件でも落ちない
    const legacy = { query: '', sort: 'date_desc', period: 'all', categories: [] } as HistoryFilter
    expect(filterStores(legacy)).toEqual([])
    expect(filterTransactions(rows, legacy, ctx)).toHaveLength(5)
  })

  it('完全一致だけを拾う(表記ゆれは別の店。レポートの件数と合わせるため)', () => {
    expect(ids({ ...DEFAULT_FILTER, stores: ['オカモトセルフ'] })).toEqual(['ok1', 'ok2'])
    // 検索(query)なら半角カナも拾う。お店の絞り込みは拾わない — この違いが取り決め
    expect(filterTransactions(rows, { ...DEFAULT_FILTER, query: 'オカモトセルフ' }, ctx)).toHaveLength(3)
    // 部分一致もしない
    expect(ids({ ...DEFAULT_FILTER, stores: ['オカモト'] })).toEqual([])
    expect(ids({ ...DEFAULT_FILTER, stores: ['ｵｶﾓﾄｾﾙﾌ 東店'] })).toEqual(['kana'])
  })

  it('前後の空白の違いは同じ店として扱う(レポートが束ねる単位に合わせる)', () => {
    expect(ids({ ...DEFAULT_FILTER, stores: [' オカモトセルフ '] })).toEqual(['ok1', 'ok2'])
  })

  it('複数のお店を選んだらどれかに一致すれば通す(カテゴリと同じ OR)', () => {
    expect(ids({ ...DEFAULT_FILTER, stores: ['オカモトセルフ', 'セブンイレブン'] })).toEqual([
      'ok1',
      'ok2',
      'sev',
    ])
  })

  it('店名が空の記録は、お店を選んだ時点で必ず落ちる', () => {
    expect(ids({ ...DEFAULT_FILTER, stores: ['オカモトセルフ'] })).not.toContain('none')
    // 預かり・返金・調整は店名を持たないので、お店で絞ると残らない
    const deposit = tx({ id: 'dep', type: 'partner_deposit', category: null, store: '' })
    expect(
      filterTransactions([deposit], { ...DEFAULT_FILTER, stores: ['オカモトセルフ'] }, ctx)
    ).toEqual([])
  })

  it('ほかの条件と重ねると AND になる(期間・カテゴリ・検索語)', () => {
    // 期間: padded だけ7月
    expect(ids({ ...DEFAULT_FILTER, stores: ['オカモトセルフ'], period: 'month' })).toEqual(['ok1'])
    // カテゴリ: ok1 は交通費、ok2(padded)は既定の食費
    expect(ids({ ...DEFAULT_FILTER, stores: ['オカモトセルフ'], categories: ['transport'] })).toEqual([
      'ok1',
    ])
    // 検索語
    expect(ids({ ...DEFAULT_FILTER, stores: ['オカモトセルフ'], query: 'セブン' })).toEqual([])
  })

  it('レポートのお店別と同じキーで絞れる(同じ期間なら件数も一致する)', () => {
    // ここが崩れると「レポートで 2件と出ている行を押したら履歴は 3件」になる
    const ranked = rankByStore(rows, { start: '2026-07-01', end: '2026-08-31' })
    expect(ranked.length).toBeGreaterThan(0)
    for (const item of ranked) {
      if (item.key === '') continue // 「店名なし」は絞り込む先が無いので押せる行にしない
      const hit = filterTransactions(rows, { ...DEFAULT_FILTER, stores: [item.key] }, ctx)
      expect(hit).toHaveLength(item.count)
    }
  })

  // ---- 型が守ってくれない3箇所のうちの1つ。ここが落ちたら sameFilter への追記漏れ ----
  it('お店の違いは「別の条件」として扱う(sameFilter に stores を足し忘れると落ちる)', () => {
    // 書き忘れると isFilterActive が false のままになり、
    // お店で絞ったのに一覧に切り替わらない(押しても何も起きない)
    expect(isFilterActive({ ...DEFAULT_FILTER, stores: ['オカモトセルフ'] })).toBe(true)
    expect(sameFilter({ ...DEFAULT_FILTER, stores: ['A'] }, DEFAULT_FILTER)).toBe(false)
    expect(
      sameFilter({ ...DEFAULT_FILTER, stores: ['A'] }, { ...DEFAULT_FILTER, stores: ['B'] })
    ).toBe(false)
    // 並び順の違いは同じ条件(タグと同じ扱い)
    expect(
      sameFilter({ ...DEFAULT_FILTER, stores: ['A', 'B'] }, { ...DEFAULT_FILTER, stores: ['B', 'A'] })
    ).toBe(true)
    // 未指定と空配列は同じ(古い保存を読み戻しても「別の条件」にならない)
    const legacy = { query: '', sort: 'date_desc', period: 'all', categories: [] } as HistoryFilter
    expect(sameFilter(legacy, DEFAULT_FILTER)).toBe(true)
  })
})

describe('describeFilter / suggestFilterName', () => {
  it('絞り込んでいるお店を画面の説明文に出す(黙って件数が変わらないように)', () => {
    const f: HistoryFilter = { ...DEFAULT_FILTER, stores: ['オカモトセルフ'] }
    // レポートから飛んだときの見え方。期間が「すべて」であることも必ず出す —
    // レポートの行の件数と変わる理由がこれ
    expect(describeFilter(f, labelOf)).toBe('お店:オカモトセルフ / すべて')
  })

  it('お店を足しても、既存の説明文の並びは変えない', () => {
    expect(describeFilter({ ...DEFAULT_FILTER, query: 'コーヒー' }, labelOf)).toBe(
      '「コーヒー」 / すべて'
    )
    expect(
      describeFilter({ ...DEFAULT_FILTER, categories: ['food'], period: 'month' }, labelOf)
    ).toBe('食費 / この月')
  })

  it('保存名の初期値は20文字まで。既定のままの期間は名前からは落とす', () => {
    // 「すべて」= 何も選んでいない期間。名前に入れても条件を思い出す助けにならないので、
    // 席を条件そのもの(お店・カテゴリ・タグ)に譲る
    expect(suggestFilterName({ ...DEFAULT_FILTER, stores: ['オカモトセルフ'] }, labelOf)).toBe(
      'お店:オカモトセルフ'
    )
    // 選んだ期間は残す
    expect(
      suggestFilterName({ ...DEFAULT_FILTER, categories: ['food'], period: 'month' }, labelOf)
    ).toBe('食費 / この月')
    // 長すぎるときは20文字で切る(入力欄の maxLength と同じ)
    const long = suggestFilterName(
      { ...DEFAULT_FILTER, query: 'ガソリン', stores: ['オカモトセルフ'], categories: ['food'] },
      labelOf
    )
    expect(long).toHaveLength(20)
    expect(long.startsWith('「ガソリン」 / お店:オカモトセルフ')).toBe(true)
  })
})

describe('parseHistoryFilter', () => {
  it('既定値をベースに、読めたキーだけ上書きする', () => {
    expect(parseHistoryFilter({ query: 'スタバ' })).toEqual({ ...DEFAULT_FILTER, query: 'スタバ' })
    expect(parseHistoryFilter({ tags: ['デート'] })).toEqual({ ...DEFAULT_FILTER, tags: ['デート'] })
  })

  it('オブジェクトでない値は既定の条件として読む', () => {
    expect(parseHistoryFilter(null)).toEqual(DEFAULT_FILTER)
    expect(parseHistoryFilter('ごみ')).toEqual(DEFAULT_FILTER)
  })

  it('型の合わない値・知らない並び順や期間は既定のままにする', () => {
    const got = parseHistoryFilter({
      query: 42,
      sort: 'いつかの並び',
      period: 'decade',
      categories: 'food',
      tags: ['ok', 3, null],
      stores: ['オカモトセルフ', 7],
      unknownKey: 'なにか',
    })
    expect(got).toEqual({ ...DEFAULT_FILTER, tags: ['ok'], stores: ['オカモトセルフ'] })
  })

  it('保存できるすべての項目が往復する(項目を足したらここに1行足す)', () => {
    const full: HistoryFilter = {
      query: 'スタバ',
      sort: 'amount_asc',
      period: 'last3',
      categories: ['food', NO_CATEGORY_KEY],
      tags: ['デート'],
      stores: ['オカモトセルフ'],
    }
    expect(parseHistoryFilter(JSON.parse(JSON.stringify(full)))).toEqual(full)
    // 読み直したものが元と「同じ条件」として突き合わせられること
    expect(sameFilter(parseHistoryFilter(full), full)).toBe(true)
  })
})
