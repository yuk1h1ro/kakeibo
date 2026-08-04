import { describe, expect, it } from 'vitest'
import type { Transaction } from './types'
import {
  categoryBulkTargets,
  duplicateInput,
  restoreInput,
  transactionToInput,
  withCategory,
} from './txActions'

function tx(p: Partial<Transaction> = {}): Transaction {
  return {
    id: 'id001',
    date: '2026-07-20',
    type: 'expense',
    amount: 1200,
    category: 'food',
    memo: 'おにぎり',
    store: 'セブンイレブン',
    partner_amount: 300,
    created_at: '2026-07-20T03:00:00.000Z',
    ...p,
  }
}

describe('transactionToInput', () => {
  it('中身をそのまま写す', () => {
    expect(transactionToInput(tx())).toEqual({
      date: '2026-07-20',
      type: 'expense',
      amount: 1200,
      category: 'food',
      memo: 'おにぎり',
      store: 'セブンイレブン',
      partner_amount: 300,
    })
  })

  it('自動生成の印と気分は写す(編集で消えないこと)', () => {
    const input = transactionToInput(tx({ source: 'recurring', satisfaction: 'regret' }))
    expect(input.source).toBe('recurring')
    expect(input.satisfaction).toBe('regret')
  })

  it('気分が未設定(キー無し)のときはキーごと落とす(列が無いDBでも通す)', () => {
    expect('satisfaction' in transactionToInput(tx())).toBe(false)
  })

  it('source が空文字ならキーを送らない', () => {
    expect('source' in transactionToInput(tx({ source: '' }))).toBe(false)
  })
})

describe('duplicateInput (機能149)', () => {
  it('同じ内容で今日の日付になる', () => {
    const input = duplicateInput(tx(), '2026-08-04')
    expect(input.date).toBe('2026-08-04')
    expect(input.amount).toBe(1200)
    expect(input.store).toBe('セブンイレブン')
    expect(input.partner_amount).toBe(300)
  })

  it('気分と自動生成の印は引き継がない(今回の買い物は別物)', () => {
    const input = duplicateInput(tx({ source: 'recurring', satisfaction: 'good' }), '2026-08-04')
    expect('satisfaction' in input).toBe(false)
    expect('source' in input).toBe(false)
  })
})

describe('withCategory (機能151)', () => {
  it('カテゴリ以外は変わらない', () => {
    const before = tx()
    const input = withCategory(before, 'daily')
    expect(input.category).toBe('daily')
    expect(input.amount).toBe(before.amount)
    expect(input.date).toBe(before.date)
    expect(input.memo).toBe(before.memo)
    expect(input.partner_amount).toBe(before.partner_amount)
  })
})

describe('restoreInput (機能159)', () => {
  it('削除した行を欠けなく戻せる', () => {
    const before = tx({ source: 'recurring', satisfaction: 'neutral' })
    const input = restoreInput(before)
    expect(input).toEqual({
      date: before.date,
      type: before.type,
      amount: before.amount,
      category: before.category,
      memo: before.memo,
      store: before.store,
      partner_amount: before.partner_amount,
      source: 'recurring',
      satisfaction: 'neutral',
    })
  })

  it('預かりの行もそのまま戻せる', () => {
    const dep = tx({ type: 'partner_deposit', amount: 30000, category: null, partner_amount: 0 })
    const input = restoreInput(dep)
    expect(input.type).toBe('partner_deposit')
    expect(input.amount).toBe(30000)
    expect(input.category).toBeNull()
  })
})

describe('categoryBulkTargets', () => {
  it('すでにそのカテゴリの行と預かりは対象にしない', () => {
    const rows = [
      tx({ id: 'a', category: 'food' }),
      tx({ id: 'b', category: 'daily' }),
      tx({ id: 'c', type: 'partner_deposit', category: null }),
    ]
    expect(categoryBulkTargets(rows, 'food').map((t) => t.id)).toEqual(['b'])
  })
})
