import { describe, expect, it } from 'vitest'
import type { Transaction } from './types'
import {
  DEFAULT_FILTER,
  NO_CATEGORY_KEY,
  filterTransactions,
  isFilterActive,
  normalizeSearchText,
  periodRange,
  sameFilter,
  searchTokens,
  sortAmount,
  sortTransactions,
  transactionHaystack,
  type HistoryFilter,
} from './historyFilter'

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
