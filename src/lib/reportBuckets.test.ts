import { describe, expect, it } from 'vitest'
import type { Transaction } from './types'
import {
  addDays,
  bucketRanges,
  bucketSeries,
  dailyTotals,
  enumerateDates,
  startOfWeek,
} from './reportBuckets'

let seq = 0
function tx(p: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: p.id ?? `b${String(seq).padStart(3, '0')}`,
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

describe('日付ユーティリティ', () => {
  it('月またぎ・年またぎで正しく進む', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31')
  })

  it('うるう年の2月をまたげる', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01')
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01')
  })

  it('週の始まりは日曜', () => {
    expect(startOfWeek('2026-08-04')).toBe('2026-08-02') // 火曜 → 直前の日曜
    expect(startOfWeek('2026-08-02')).toBe('2026-08-02') // 日曜はその日
  })

  it('期間の日付を列挙する(逆順は空)', () => {
    expect(enumerateDates({ start: '2026-08-01', end: '2026-08-03' })).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
    ])
    expect(enumerateDates({ start: '2026-08-03', end: '2026-08-01' })).toEqual([])
    expect(enumerateDates({ start: '2024-02-01', end: '2024-02-29' })).toHaveLength(29)
  })
})

describe('dailyTotals', () => {
  it('記録が0件でも日数分ならぶ', () => {
    const result = dailyTotals([], { start: '2026-08-01', end: '2026-08-31' })
    expect(result).toHaveLength(31)
    expect(result.every((d) => d.total === 0 && d.count === 0)).toBe(true)
  })

  it('同じ日の複数件を合算し、彼女の負担分は除く', () => {
    const txs = [
      tx({ date: '2026-08-01', amount: 1000 }),
      tx({ date: '2026-08-01', amount: 3000, partner_amount: 1000 }),
      tx({ date: '2026-08-03', amount: 500 }),
    ]
    const result = dailyTotals(txs, { start: '2026-08-01', end: '2026-08-03' })
    expect(result[0]).toEqual({ iso: '2026-08-01', total: 3000, count: 2 })
    expect(result[1]).toEqual({ iso: '2026-08-02', total: 0, count: 0 })
    expect(result[2].total).toBe(500)
  })

  it('預かり金(支出でない行)は数えない', () => {
    const txs = [tx({ date: '2026-08-01', type: 'partner_deposit', amount: 30000 })]
    expect(dailyTotals(txs, { start: '2026-08-01', end: '2026-08-01' })[0].total).toBe(0)
  })
})

describe('bucketRanges', () => {
  it('日は今日を最後に古い順で並ぶ', () => {
    const r = bucketRanges('day', '2026-03-02', 3)
    expect(r.map((b) => b.start)).toEqual(['2026-02-28', '2026-03-01', '2026-03-02'])
    expect(r.every((b) => b.start === b.end)).toBe(true)
  })

  it('週は日曜〜土曜の7日間になる', () => {
    const r = bucketRanges('week', '2026-08-04', 2)
    expect(r[1]).toMatchObject({ start: '2026-08-02', end: '2026-08-08' })
    expect(r[0]).toMatchObject({ start: '2026-07-26', end: '2026-08-01' })
  })

  it('月は年をまたいでも末日が正しい(うるう年を含む)', () => {
    const r = bucketRanges('month', '2024-03-15', 3)
    expect(r.map((b) => `${b.start}..${b.end}`)).toEqual([
      '2024-01-01..2024-01-31',
      '2024-02-01..2024-02-29',
      '2024-03-01..2024-03-31',
    ])
  })

  it('年は1月1日〜12月31日', () => {
    const r = bucketRanges('year', '2026-08-04', 2)
    expect(r[0]).toMatchObject({ key: '2025', start: '2025-01-01', end: '2025-12-31' })
    expect(r[1]).toMatchObject({ key: '2026', start: '2026-01-01', end: '2026-12-31' })
  })
})

describe('bucketSeries', () => {
  const txs = [
    tx({ date: '2025-12-31', amount: 5000 }),
    tx({ date: '2026-01-01', amount: 700 }),
    tx({ date: '2026-01-02', amount: 300 }),
  ]

  it('年をまたいで正しいバケットに入る', () => {
    const byDay = bucketSeries(txs, 'day', '2026-01-02', 3)
    expect(byDay.map((b) => b.total)).toEqual([5000, 700, 300])
    const byYear = bucketSeries(txs, 'year', '2026-01-02', 2)
    expect(byYear.map((b) => b.total)).toEqual([5000, 1000])
  })

  it('窓の外の記録は入らない', () => {
    const byDay = bucketSeries(txs, 'day', '2026-01-02', 2)
    expect(byDay.map((b) => b.total)).toEqual([700, 300])
  })

  it('記録が0件でも本数ぶんの箱が返る', () => {
    const r = bucketSeries([], 'week', '2026-08-04', 4)
    expect(r).toHaveLength(4)
    expect(r.every((b) => b.total === 0 && b.count === 0)).toBe(true)
  })
})
