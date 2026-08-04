import { describe, expect, it } from 'vitest'
import {
  lookupStoreCategory,
  matchStoreSuggestions,
  mergeStoreCategories,
  normalizeStoreName,
  transactionsToRecategorize,
  type StoreCategory,
} from './storeCategories'
import type { Transaction } from './types'

const entry = (name: string, category: string, updatedAt: string): StoreCategory => ({
  storeKey: normalizeStoreName(name),
  storeName: name,
  category,
  updatedAt,
})

const tx = (over: Partial<Transaction>): Transaction => ({
  id: over.id ?? crypto.randomUUID(),
  date: '2026-08-01',
  type: 'expense',
  amount: 500,
  category: 'daily',
  memo: '',
  store: '',
  partner_amount: 0,
  created_at: '2026-08-01T00:00:00Z',
  ...over,
})

describe('normalizeStoreName', () => {
  it('全角・大文字小文字・空白の違いを吸収する', () => {
    expect(normalizeStoreName('ＳＥＶＥＮ')).toBe('seven')
    expect(normalizeStoreName('セブン イレブン')).toBe(normalizeStoreName('セブンイレブン'))
    expect(normalizeStoreName('  Lawson ')).toBe('lawson')
  })

  it('半角カナを全角に揃える', () => {
    expect(normalizeStoreName('ｾﾌﾞﾝ')).toBe(normalizeStoreName('セブン'))
  })
})

describe('matchStoreSuggestions', () => {
  const entries = [
    entry('セブンイレブン', 'food', '2026-08-03T00:00:00Z'),
    entry('セブンパーク', 'hobby', '2026-08-01T00:00:00Z'),
    entry('ミニセブン', 'daily', '2026-08-02T00:00:00Z'),
    entry('ローソン', 'food', '2026-08-04T00:00:00Z'),
  ]

  it('前方一致を部分一致より前に出す', () => {
    const got = matchStoreSuggestions(entries, 'セブン').map((e) => e.storeName)
    expect(got).toEqual(['セブンイレブン', 'セブンパーク', 'ミニセブン'])
  })

  it('同順位では最近使った店を優先する', () => {
    const got = matchStoreSuggestions(entries, 'セ').map((e) => e.storeName)
    expect(got[0]).toBe('セブンイレブン')
  })

  it('打ち終わった店名そのものは候補に出さない', () => {
    const got = matchStoreSuggestions(entries, 'ローソン')
    expect(got).toEqual([])
  })

  it('空文字では候補を出さない', () => {
    expect(matchStoreSuggestions(entries, '   ')).toEqual([])
  })

  it('件数の上限を守る', () => {
    expect(matchStoreSuggestions(entries, 'セ', 2)).toHaveLength(2)
  })
})

describe('lookupStoreCategory', () => {
  const entries = [entry('セブンイレブン', 'food', '2026-08-03T00:00:00Z')]

  it('表記ゆれがあっても引ける', () => {
    expect(lookupStoreCategory(entries, ' セブン イレブン ')).toBe('food')
  })

  it('知らない店は null', () => {
    expect(lookupStoreCategory(entries, 'ファミマ')).toBeNull()
    expect(lookupStoreCategory(entries, '')).toBeNull()
  })
})

describe('transactionsToRecategorize', () => {
  const rows = [
    tx({ id: 'a', store: 'セブンイレブン', category: 'daily' }),
    tx({ id: 'b', store: 'セブン イレブン', category: 'daily' }),
    tx({ id: 'c', store: 'セブンイレブン', category: 'food' }), // すでに新カテゴリ
    tx({ id: 'd', store: 'ローソン', category: 'daily' }),
    tx({ id: 'e', store: 'セブンイレブン', category: null, type: 'partner_deposit' }),
  ]

  it('同じ店でカテゴリが違う支出だけを返す', () => {
    const got = transactionsToRecategorize(rows, 'セブンイレブン', 'food').map((t) => t.id)
    expect(got).toEqual(['a', 'b'])
  })

  it('店名が空なら対象なし', () => {
    expect(transactionsToRecategorize(rows, '', 'food')).toEqual([])
  })

  it('該当が無ければ空(確認を出さない判断に使う)', () => {
    expect(transactionsToRecategorize(rows, 'ローソン', 'daily')).toEqual([])
  })
})

describe('mergeStoreCategories', () => {
  it('同じ店は新しい方を採る', () => {
    const merged = mergeStoreCategories(
      [entry('セブン', 'food', '2026-08-05T00:00:00Z')],
      [entry('セブン', 'daily', '2026-08-01T00:00:00Z')]
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].category).toBe('food')
  })

  it('両方にしかない店は残す', () => {
    const merged = mergeStoreCategories(
      [entry('セブン', 'food', '2026-08-05T00:00:00Z')],
      [entry('ローソン', 'daily', '2026-08-01T00:00:00Z')]
    )
    expect(merged.map((e) => e.storeName).sort()).toEqual(['セブン', 'ローソン'])
  })
})
