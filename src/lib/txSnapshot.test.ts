import { describe, expect, it } from 'vitest'
import { applyPendingOps, normalizeRows, sortRows } from './txSnapshot'
import type { PendingOp } from './offlineQueue'
import type { Transaction, TransactionInput } from './types'

function row(id: string, date: string, created_at: string, amount = 100): Transaction {
  return { id, date, type: 'expense', amount, category: 'food', memo: '', store: '', partner_amount: 0, created_at }
}

function input(amount: number, date = '2026-10-02'): TransactionInput {
  return { date, type: 'expense', amount, category: 'food', memo: '', store: '', partner_amount: 0 }
}

function op(kind: PendingOp['kind'], id: string, payload?: TransactionInput): PendingOp {
  return { opId: `op-${kind}-${id}`, kind, id, payload, queuedAt: '2026-10-02T09:00:00Z' }
}

describe('normalizeRows', () => {
  it('store の無い古い行は空文字にそろえる', () => {
    const old = { ...row('a', '2026-10-01', 'x'), store: undefined } as unknown as Transaction
    expect(normalizeRows([old])[0].store).toBe('')
  })
})

describe('sortRows', () => {
  it('日付の新しい順、同じ日は作った順に新しいものから', () => {
    const rows = [
      row('a', '2026-10-01', '2026-10-01T08:00:00Z'),
      row('b', '2026-10-02', '2026-10-02T08:00:00Z'),
      row('c', '2026-10-01', '2026-10-01T09:00:00Z'),
    ]
    expect(sortRows(rows).map((r) => r.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('applyPendingOps', () => {
  const server = [row('a', '2026-10-01', '2026-10-01T08:00:00Z')]

  it('追加はキューに積んだ時刻を作成時刻の仮置きにして一覧に入る', () => {
    const out = applyPendingOps(server, [op('insert', 'n', input(500))])
    expect(out.map((r) => r.id)).toEqual(['n', 'a'])
    expect(out[0].created_at).toBe('2026-10-02T09:00:00Z')
  })

  it('同じ行IDがもうサーバーにあれば二重に足さない(送れたが応答が無かった回)', () => {
    const out = applyPendingOps(server, [op('insert', 'a', input(999))])
    expect(out).toHaveLength(1)
    expect(out[0].amount).toBe(100)
  })

  it('更新は中身を重ね、削除は外す', () => {
    expect(applyPendingOps(server, [op('update', 'a', input(300, '2026-10-01'))])[0].amount).toBe(300)
    expect(applyPendingOps(server, [op('delete', 'a')])).toEqual([])
  })

  it('積んだ順に重ねる(追加 → 更新 → 削除)', () => {
    const ops = [op('insert', 'n', input(500)), op('update', 'n', input(700)), op('delete', 'a')]
    const out = applyPendingOps(server, ops)
    expect(out.map((r) => [r.id, r.amount])).toEqual([['n', 700]])
  })

  it('元の配列は書き換えない', () => {
    const before = JSON.stringify(server)
    applyPendingOps(server, [op('delete', 'a')])
    expect(JSON.stringify(server)).toBe(before)
  })
})
