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

  it('彼女が払った額・タグ・分割の束ねも写す(残高と内訳が変わらないこと)', () => {
    const input = transactionToInput(
      tx({ partner_paid: 800, tags: ['旅行'], split_group: 'g1' })
    )
    expect(input.partner_paid).toBe(800)
    expect(input.tags).toEqual(['旅行'])
    expect(input.split_group).toBe('g1')
  })

  it('書き換えでは created_at を送らない(仮置きの時刻で本物を上書きしない)', () => {
    expect('created_at' in transactionToInput(tx())).toBe(false)
    expect('created_at' in withCategory(tx(), 'daily')).toBe(false)
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

  it('作成日時は引き継がない(複製はいま作った別の記録)', () => {
    expect('created_at' in duplicateInput(tx(), '2026-08-04')).toBe(false)
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
      created_at: before.created_at,
    })
  })

  it('作成日時をそのまま写す(復元した時刻に付け替わらない)', () => {
    const input = restoreInput(tx({ created_at: '2026-07-20T03:00:00.000Z' }))
    expect(input.created_at).toBe('2026-07-20T03:00:00.000Z')
  })

  it('作成日時が無い/空のときはキーごと落とす(DB の now() に任せる)', () => {
    expect('created_at' in restoreInput(tx({ created_at: '' }))).toBe(false)
    expect(
      'created_at' in restoreInput({ ...tx(), created_at: undefined as unknown as string })
    ).toBe(false)
  })

  it('彼女が払った額も写す(元に戻しただけで残高が動かないこと)', () => {
    const input = restoreInput(tx({ partner_paid: 1200, partner_amount: 300 }))
    expect(input.partner_paid).toBe(1200)
    expect(input.partner_amount).toBe(300)
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
