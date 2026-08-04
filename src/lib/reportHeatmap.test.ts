import { describe, expect, it } from 'vitest'
import type { Transaction } from './types'
import { HEAT_LEVELS, monthHeatmap } from './reportHeatmap'

let seq = 0
function tx(p: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: p.id ?? `h${String(seq).padStart(3, '0')}`,
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

function cells(month: string, txs: Transaction[]) {
  return monthHeatmap(txs, month)
    .weeks.flat()
    .filter((c): c is NonNullable<typeof c> => c !== null)
}

describe('monthHeatmap', () => {
  it('記録が0件なら全セルが level 0 で、凡例も出ない', () => {
    const h = monthHeatmap([], '2026-08')
    const all = h.weeks.flat().filter((c) => c !== null)
    expect(all).toHaveLength(31)
    expect(all.every((c) => c!.level === 0 && c!.total === 0)).toBe(true)
    expect(h.max).toBe(0)
    expect(h.legend).toEqual([])
    expect(h.activeDays).toBe(0)
  })

  it('うるう年の2月は29セル、平年は28セル', () => {
    expect(cells('2024-02', [])).toHaveLength(29)
    expect(cells('2023-02', [])).toHaveLength(28)
  })

  it('月初1日目だけの記録でも最大の日として濃くなる', () => {
    const h = monthHeatmap([tx({ date: '2026-08-01', amount: 500 })], '2026-08')
    const first = h.weeks.flat().find((c) => c?.iso === '2026-08-01')
    expect(first?.level).toBe(HEAT_LEVELS)
    expect(h.max).toBe(500)
    expect(h.activeDays).toBe(1)
  })

  it('最大の日を基準に4段階へ割り振る', () => {
    const txs = [
      tx({ date: '2026-08-01', amount: 10000 }), // 最大 → 4
      tx({ date: '2026-08-02', amount: 7000 }), // 70% → 3
      tx({ date: '2026-08-03', amount: 4000 }), // 40% → 2
      tx({ date: '2026-08-04', amount: 1000 }), // 10% → 1
    ]
    const h = monthHeatmap(txs, '2026-08')
    const byIso = new Map(h.weeks.flat().filter(Boolean).map((c) => [c!.iso, c!]))
    expect(byIso.get('2026-08-01')!.level).toBe(4)
    expect(byIso.get('2026-08-02')!.level).toBe(3)
    expect(byIso.get('2026-08-03')!.level).toBe(2)
    expect(byIso.get('2026-08-04')!.level).toBe(1)
    expect(byIso.get('2026-08-05')!.level).toBe(0)
    expect(h.total).toBe(22000)
    expect(h.legend).toEqual([0, 2500, 5000, 7500])
  })

  it('彼女が全額負担した支出は色にも合計にも出ない', () => {
    const h = monthHeatmap(
      [tx({ date: '2026-08-01', amount: 3000, partner_amount: 3000 })],
      '2026-08'
    )
    expect(h.max).toBe(0)
    expect(h.total).toBe(0)
  })

  it('週は日曜始まりで、当月以外のセルは null のまま', () => {
    const h = monthHeatmap([], '2026-08') // 2026-08-01 は土曜
    expect(h.weeks[0].slice(0, 6).every((c) => c === null)).toBe(true)
    expect(h.weeks[0][6]?.day).toBe(1)
  })
})
