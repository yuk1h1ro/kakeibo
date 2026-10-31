import { describe, expect, it } from 'vitest'
import { pendingDeleteCount, pendingRows } from './pendingRecords'
import type { PendingOp } from './offlineQueue'
import type { Transaction } from './types'

function tx(id: string, date: string): Transaction {
  return {
    id,
    date,
    type: 'expense',
    amount: 1000,
    category: 'food',
    memo: '',
    store: id,
    partner_amount: 0,
    created_at: `${date}T01:00:00.000Z`,
  }
}

function op(kind: PendingOp['kind'], id: string): PendingOp {
  return { opId: `${kind}-${id}-${Math.random()}`, kind, id, queuedAt: '2026-10-01T00:00:00.000Z' }
}

describe('pendingRows', () => {
  const all = [tx('a', '2026-10-01'), tx('b', '2026-10-05'), tx('c', '2026-10-03')]

  it('送れていない記録だけを、新しい日付から順に返す', () => {
    expect(pendingRows(all, new Set(['a', 'b'])).map((t) => t.id)).toEqual(['b', 'a'])
  })

  it('何も残っていなければ空', () => {
    expect(pendingRows(all, new Set())).toEqual([])
  })
})

describe('pendingDeleteCount', () => {
  it('画面から消えている記録への削除だけを数える', () => {
    expect(pendingDeleteCount([op('delete', 'x'), op('insert', 'y')], new Set(['y']))).toBe(1)
  })

  it('同じ記録への削除が2つ積まれていても1件', () => {
    expect(pendingDeleteCount([op('delete', 'x'), op('delete', 'x')], new Set())).toBe(1)
  })

  it('消したあと「元に戻す」で画面に戻った記録は数えない', () => {
    expect(pendingDeleteCount([op('delete', 'x'), op('insert', 'x')], new Set(['x']))).toBe(0)
  })
})
