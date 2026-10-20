import { describe, expect, it } from 'vitest'
import { judgeRejection } from './syncRejection'
import type { TransactionInput } from './types'

const expense = (amount: number): TransactionInput => ({
  date: '2026-10-01',
  type: 'expense',
  amount,
  category: 'food',
  memo: '',
  store: '',
  partner_amount: 0,
})

const refund: TransactionInput = { ...expense(500), type: 'partner_refund', category: null }

const checkViolation = { code: '23514', message: 'new row violates check constraint "transactions_amount_check"' }

describe('judgeRejection', () => {
  it('列が無い(マイグレーション未実行)なら、送り直せば通る失敗として案内する', () => {
    const v = judgeRejection({ code: 'PGRST204', message: "Could not find the 'tags' column" }, expense(100), true)
    expect(v.retryable).toBe(true)
    expect(v.ledgerRejected).toBe(false)
    expect(v.guide.kind).toBe('migration')
  })

  it('0円 の支出が金額の制約に弾かれたら、おごりの SQL を名指しする', () => {
    const v = judgeRejection(checkViolation, expense(0), true)
    expect(v.retryable).toBe(true)
    expect(v.ledgerRejected).toBe(false)
    expect(v.guide.actions.join('')).toMatch(/migration-favor\.sql/)
  })

  it('返金・調整が種別の制約に弾かれたら、精算の SQL を名指しして導線を閉じさせる', () => {
    const v = judgeRejection(
      { code: '23514', message: 'new row violates check constraint "transactions_type_check"' },
      refund,
      true
    )
    expect(v.retryable).toBe(true)
    expect(v.ledgerRejected).toBe(true)
    expect(v.guide.actions.join('')).toMatch(/migration-partner-ledger\.sql/)
  })

  it('それ以外の拒否は何度送っても同じなので、送り直さない', () => {
    const v = judgeRejection(checkViolation, expense(100), true)
    expect(v.retryable).toBe(false)
    expect(v.ledgerRejected).toBe(false)
    expect(v.guide.kind).toBe('rejected')
  })
})
