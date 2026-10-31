import { describe, expect, it } from 'vitest'
import { groupByDay, summarizeDays } from './historyGroups'
import type { Transaction } from './types'

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: 'x',
    date: '2026-10-01',
    type: 'expense',
    amount: 1000,
    category: 'food',
    memo: '',
    store: '',
    partner_amount: 0,
    created_at: '2026-10-01T01:00:00.000Z',
    ...over,
  }
}

describe('summarizeDays', () => {
  it('自分の分は彼女の負担分を除いた額で足す(カレンダーのマスと同じ額)', () => {
    const m = summarizeDays([
      tx({ id: 'a', amount: 2000, partner_amount: 800 }),
      tx({ id: 'b', amount: 500 }),
    ])
    expect(m.get('2026-10-01')).toEqual({ own: 1700, deposit: 0 })
  })

  it('預かりは使った額に混ぜず、別に数える', () => {
    const m = summarizeDays([
      tx({ id: 'a', amount: 1000 }),
      tx({ id: 'd', type: 'partner_deposit', amount: 30000, category: null }),
    ])
    expect(m.get('2026-10-01')).toEqual({ own: 1000, deposit: 30000 })
  })

  it('返金・調整は使った額にも預かりにも数えない', () => {
    const m = summarizeDays([
      tx({ id: 'r', type: 'partner_refund', amount: 5000, category: null }),
      tx({ id: 'j', type: 'partner_adjust', amount: 300, category: null }),
    ])
    expect(m.get('2026-10-01')).toEqual({ own: 0, deposit: 0 })
  })
})

describe('groupByDay', () => {
  const rows = [
    tx({ id: 'old', date: '2026-10-03', created_at: '2026-10-03T01:00:00.000Z', amount: 300 }),
    tx({ id: 'new', date: '2026-10-05', created_at: '2026-10-05T09:00:00.000Z', amount: 700 }),
    tx({
      id: 'new-early',
      date: '2026-10-05',
      created_at: '2026-10-05T01:00:00.000Z',
      amount: 100,
    }),
    tx({
      id: 'mid',
      date: '2026-10-04',
      created_at: '2026-10-04T01:00:00.000Z',
      amount: 50,
      partner_amount: 20,
    }),
  ]

  it('新しい日付が上。同じ日の中も新しく入れた順', () => {
    const { groups } = groupByDay(rows)
    expect(groups.map((g) => g.date)).toEqual(['2026-10-05', '2026-10-04', '2026-10-03'])
    expect(groups[0].rows.map((t) => t.id)).toEqual(['new', 'new-early'])
  })

  it('見出しの額はその日の自分の分の合計(カレンダーのマスと同じ)', () => {
    const { groups } = groupByDay(rows)
    expect(groups.map((g) => g.own)).toEqual([800, 30, 300])
  })

  it('記録が無ければ空(見出しだけが並ぶことはない)', () => {
    expect(groupByDay([])).toEqual({ groups: [], shown: 0, total: 0 })
  })

  it('上限を超えたら新しいほうから上限ぶんだけ並べ、何件中何件かを返す', () => {
    const r = groupByDay(rows, 2)
    expect(r.shown).toBe(2)
    expect(r.total).toBe(4)
    expect(r.groups.flatMap((g) => g.rows.map((t) => t.id))).toEqual(['new', 'new-early'])
  })

  it('途中で切れた日でも、見出しの額はその日の全件の合計のまま(カレンダーと食い違わない)', () => {
    const r = groupByDay(rows, 1)
    expect(r.groups).toHaveLength(1)
    expect(r.groups[0].rows.map((t) => t.id)).toEqual(['new'])
    expect(r.groups[0].own).toBe(800)
  })

  it('入力の配列を並べ替えない(呼び出し側の一覧を壊さない)', () => {
    const input = [...rows]
    groupByDay(input)
    expect(input.map((t) => t.id)).toEqual(['old', 'new', 'new-early', 'mid'])
  })
})
