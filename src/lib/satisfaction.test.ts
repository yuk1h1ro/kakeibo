import { describe, expect, it } from 'vitest'
import type { Transaction } from './types'
import { satisfactionOf } from './types'
import {
  pendingSatisfactionTargets,
  satisfactionLabel,
  withoutSatisfaction,
} from './satisfaction'

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

describe('satisfactionOf — 未設定と未知の値の扱い', () => {
  it('未設定(列が無い・null)は null', () => {
    expect(satisfactionOf(tx())).toBeNull()
    expect(satisfactionOf(tx({ satisfaction: null }))).toBeNull()
  })

  it('未知の文字列は null に寄せる', () => {
    expect(satisfactionOf(tx({ satisfaction: 'happy' as never }))).toBeNull()
  })

  it('正しい値はそのまま', () => {
    expect(satisfactionOf(tx({ satisfaction: 'regret' }))).toBe('regret')
  })
})

describe('pendingSatisfactionTargets — まとめて仕分ける対象', () => {
  it('未設定の支出だけを新しい順に返す', () => {
    const rows = [
      tx({ id: 'a', date: '2026-08-01' }),
      tx({ id: 'b', date: '2026-08-03', satisfaction: 'good' }),
      tx({ id: 'c', date: '2026-08-02' }),
    ]
    expect(pendingSatisfactionTargets(rows).map((t) => t.id)).toEqual(['c', 'a'])
  })

  // 機能096: 分割した会計は1回の買い物。断片が N 件続けて出ないよう束ねごとに1件
  it('分割した会計は束ねごとに代表1件だけ返す', () => {
    const rows = [
      tx({ id: 's1', split_group: 'g1', created_at: '2026-08-04T03:00:01.000Z' }),
      tx({ id: 's2', split_group: 'g1', created_at: '2026-08-04T03:00:02.000Z' }),
      tx({ id: 's3', split_group: 'g1', created_at: '2026-08-04T03:00:03.000Z' }),
      tx({ id: 'solo', created_at: '2026-08-04T03:00:04.000Z' }),
    ]
    const got = pendingSatisfactionTargets(rows)
    expect(got).toHaveLength(2)
    expect(got.map((t) => t.id)).toEqual(['solo', 's3'])
  })

  it('別々の束ねはそれぞれ1件ずつ出す', () => {
    const rows = [
      tx({ id: 'a1', split_group: 'g1' }),
      tx({ id: 'a2', split_group: 'g1' }),
      tx({ id: 'b1', split_group: 'g2' }),
      tx({ id: 'b2', split_group: 'g2' }),
    ]
    expect(pendingSatisfactionTargets(rows)).toHaveLength(2)
  })

  it('束ねの1件に気分が付いていても、残りは畳んだまま1件だけ出す', () => {
    const rows = [
      tx({ id: 'x1', split_group: 'g1', satisfaction: 'good' }),
      tx({ id: 'x2', split_group: 'g1' }),
      tx({ id: 'x3', split_group: 'g1' }),
    ]
    expect(pendingSatisfactionTargets(rows).map((t) => t.id)).toEqual(['x2'])
  })

  it('預かり(支出以外)は対象にしない', () => {
    const rows = [tx({ id: 'd', type: 'partner_deposit', category: null })]
    expect(pendingSatisfactionTargets(rows)).toEqual([])
  })

  it('同じ日は記録した時刻が新しい方を先に出す', () => {
    const rows = [
      tx({ id: 'old', created_at: '2026-08-04T01:00:00.000Z' }),
      tx({ id: 'new', created_at: '2026-08-04T09:00:00.000Z' }),
    ]
    expect(pendingSatisfactionTargets(rows).map((t) => t.id)).toEqual(['new', 'old'])
  })

  it('上限で打ち切る', () => {
    const rows = Array.from({ length: 5 }, (_, i) => tx({ id: `x${i}` }))
    expect(pendingSatisfactionTargets(rows, 2)).toHaveLength(2)
  })
})

describe('withoutSatisfaction — 列が無い環境へ送る内容', () => {
  it('キーごと落とす(undefined を残さない)', () => {
    const payload = { amount: 100, satisfaction: 'regret' as const }
    const sent = withoutSatisfaction(payload)
    expect('satisfaction' in sent).toBe(false)
    expect(sent).toEqual({ amount: 100 })
  })

  it('もともと無いときも壊れない', () => {
    const payload: { amount: number; satisfaction?: null } = { amount: 100 }
    expect(withoutSatisfaction(payload)).toEqual({ amount: 100 })
  })
})

describe('satisfactionLabel', () => {
  it('未設定は「未設定」', () => {
    expect(satisfactionLabel(null)).toBe('未設定')
    expect(satisfactionLabel('good')).toBe('満足')
  })
})
