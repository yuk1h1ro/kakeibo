import { describe, expect, it } from 'vitest'
import type { Transaction } from './types'
import { yearSummary } from './reportYear'

let seq = 0
function tx(p: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: p.id ?? `y${String(seq).padStart(3, '0')}`,
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

const label = (id: string | null) => id ?? '未分類'

describe('yearSummary (123)', () => {
  it('記録が0件でも12ヶ月ぶんの箱を返す', () => {
    const s = yearSummary([], 2025, '2026-08-04', label)
    expect(s.months).toHaveLength(12)
    expect(s.total).toBe(0)
    expect(s.monthlyAverage).toBe(0)
    expect(s.maxMonth).toBeNull()
    expect(s.minMonth).toBeNull()
    expect(s.partial).toBe(false)
    expect(s.categories).toEqual([])
  })

  it('終わった年は1月1日〜12月31日で集計する', () => {
    const txs = [
      tx({ date: '2025-01-05', amount: 1000 }),
      tx({ date: '2025-12-31', amount: 2000 }),
      tx({ date: '2026-01-01', amount: 9999 }), // 翌年ぶんは入らない
      tx({ date: '2024-12-31', amount: 8888 }), // 前年ぶんも入らない
    ]
    const s = yearSummary(txs, 2025, '2026-08-04', label)
    expect(s.range).toEqual({ start: '2025-01-01', end: '2025-12-31' })
    expect(s.total).toBe(3000)
    expect(s.months[0].total).toBe(1000)
    expect(s.months[11].total).toBe(2000)
    expect(s.monthlyAverage).toBe(1500) // 記録のある2ヶ月の平均
    expect(s.maxMonth?.key).toBe('2025-12')
    expect(s.minMonth?.key).toBe('2025-01')
    expect(s.activeDays).toBe(2)
    expect(s.count).toBe(2)
  })

  it('進行中の年は今日までで切り、途中集計だと分かる', () => {
    const txs = [tx({ date: '2026-08-01', amount: 5000 }), tx({ date: '2026-08-31', amount: 7000 })]
    const s = yearSummary(txs, 2026, '2026-08-04', label)
    expect(s.partial).toBe(true)
    expect(s.range.end).toBe('2026-08-04')
    expect(s.total).toBe(5000) // 今日より後の記録は含めない
    expect(s.months[7].total).toBe(5000) // 8月も今日まで
    expect(s.months[8].future).toBe(true) // 9月はまだ来ていない
    expect(s.months[7].future).toBe(false)
  })

  it('うるう年でも2月末まで数える', () => {
    const s = yearSummary([tx({ date: '2024-02-29', amount: 1000 })], 2024, '2026-08-04', label)
    expect(s.months[1].total).toBe(1000)
    expect(s.total).toBe(1000)
  })

  it('カテゴリ上位・お店上位・彼女の負担分を年でまとめる', () => {
    const txs = [
      tx({ date: '2026-03-01', amount: 3000, category: 'food', store: 'A' }),
      tx({ date: '2026-04-01', amount: 5000, category: 'fun', store: 'B' }),
      tx({ date: '2026-05-01', amount: 2000, category: 'food', store: 'A', partner_amount: 500 }),
    ]
    const s = yearSummary(txs, 2026, '2026-12-31', label)
    // 金額の大きい順。food は 3000 + (2000-500) = 4500
    expect(s.categories.map((c) => c.label)).toEqual(['fun', 'food'])
    expect(s.categories[1]).toMatchObject({ label: 'food', total: 4500, count: 2 })
    expect(s.stores[0]).toMatchObject({ label: 'B', total: 5000 })
    expect(s.stores[1]).toMatchObject({ label: 'A', total: 4500, count: 2 })
    expect(s.partnerTotal).toBe(500)
    expect(s.total).toBe(9500)
  })

  it('気分の内訳も年でまとめる', () => {
    const txs = [
      tx({ date: '2026-02-01', satisfaction: 'regret', amount: 4000 }),
      tx({ date: '2026-02-02', satisfaction: 'good' }),
    ]
    const s = yearSummary(txs, 2026, '2026-12-31', label)
    expect(s.satisfaction.regretCount).toBe(1)
    expect(s.satisfaction.regretTotal).toBe(4000)
    expect(s.satisfaction.stampedCount).toBe(2)
  })
})
