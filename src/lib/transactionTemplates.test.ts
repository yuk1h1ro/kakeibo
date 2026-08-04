import { describe, expect, it } from 'vitest'
import { templateFromTransaction, templateLabel } from './transactionTemplates'
import type { Transaction } from './types'

const tx: Transaction = {
  id: 't1',
  date: '2026-08-01',
  type: 'expense',
  amount: 1200,
  category: 'food',
  memo: '昼食',
  store: 'セブンイレブン',
  partner_amount: 600,
  created_at: '2026-08-01T00:00:00Z',
}

describe('templateFromTransaction', () => {
  it('取引から店・カテゴリ・金額・彼女の負担分を引き継ぐ', () => {
    expect(templateFromTransaction(tx)).toEqual({
      title: 'セブンイレブン',
      amount: 1200,
      category: 'food',
      store: 'セブンイレブン',
      memo: '昼食',
      partnerAmount: 600,
    })
  })
})

describe('templateLabel', () => {
  const base = { amount: 100, category: 'food', store: '', memo: '', partnerAmount: 0 }

  it('名前があればそれを使う', () => {
    expect(templateLabel({ ...base, title: ' 昼のコンビニ ' })).toBe('昼のコンビニ')
  })

  it('名前が空なら店名 → メモ → カテゴリ名の順で補う', () => {
    expect(templateLabel({ ...base, title: '', store: 'セブン' })).toBe('セブン')
    expect(templateLabel({ ...base, title: '', memo: '昼食' })).toBe('昼食')
    expect(templateLabel({ ...base, title: '' })).toBe('食費')
  })
})
