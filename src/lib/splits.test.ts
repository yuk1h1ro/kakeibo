import { describe, expect, it } from 'vitest'
import type { TransactionInput } from '../hooks/useTransactions'
import { partnerBalance } from './partnerBalance'
import {
  buildSplitInputs,
  evenSplit,
  isSplitPart,
  splitTotal,
  validateSplit,
  type SplitPart,
} from './splits'
import type { Transaction } from './types'

const base: TransactionInput = {
  date: '2026-08-04',
  type: 'expense',
  amount: 5000,
  category: 'food',
  memo: 'スーパー',
  store: 'ライフ',
  partner_amount: 1200,
  tags: ['まとめ買い'],
}

const part = (amount: number, partnerAmount: number, category = 'food'): SplitPart => ({
  category,
  amount,
  partnerAmount,
})

describe('validateSplit', () => {
  it('合計が支払い総額と一致していれば通る', () => {
    const parts = [part(3000, 800), part(2000, 400, 'daily')]
    expect(splitTotal(parts)).toBe(5000)
    expect(validateSplit(parts, 5000)).toEqual({ ok: true, message: null, remaining: 0 })
  })

  it('足りない・多すぎるときは残りを教えて止める', () => {
    const short = validateSplit([part(3000, 0), part(1000, 0)], 5000)
    expect(short.ok).toBe(false)
    expect(short.remaining).toBe(1000)
    const over = validateSplit([part(3000, 0), part(3000, 0)], 5000)
    expect(over.ok).toBe(false)
    expect(over.remaining).toBe(-1000)
  })

  it('内訳が1件だけでは分割にならない', () => {
    expect(validateSplit([part(5000, 0)], 5000).ok).toBe(false)
  })

  it('カテゴリ未選択の内訳があると止める', () => {
    expect(validateSplit([part(3000, 0), { category: null, amount: 2000, partnerAmount: 0 }], 5000).ok).toBe(
      false
    )
  })

  it('彼女の負担分がその内訳の金額を超えたら止める', () => {
    // ここを緩めると、行ごとの partner_amount <= amount が崩れて残高が狂う
    expect(validateSplit([part(3000, 3500), part(2000, 0)], 5000).ok).toBe(false)
    expect(validateSplit([part(3000, 3000), part(2000, 0)], 5000).ok).toBe(true)
  })

  it('負担分がマイナスなら止める', () => {
    expect(validateSplit([part(3000, -1), part(2000, 0)], 5000).ok).toBe(false)
  })
})

describe('buildSplitInputs', () => {
  const parts = [part(3000, 800), part(2000, 400, 'daily')]
  const rows = buildSplitInputs(base, parts, 'group-1')

  it('内訳ごとに独立した支出の行になる', () => {
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.category)).toEqual(['food', 'daily'])
    expect(rows.map((r) => r.amount)).toEqual([3000, 2000])
    expect(rows.every((r) => r.type === 'expense')).toBe(true)
  })

  it('彼女の負担分は行ごとに持たせる(全体に1つではない)', () => {
    expect(rows.map((r) => r.partner_amount)).toEqual([800, 400])
  })

  it('同じ束ねIDが入り、日付・お店・メモ・タグは全部の行に写る', () => {
    for (const r of rows) {
      expect(r.split_group).toBe('group-1')
      expect(r.date).toBe(base.date)
      expect(r.store).toBe('ライフ')
      expect(r.memo).toBe('スーパー')
      expect(r.tags).toEqual(['まとめ買い'])
    }
  })

  it('分割では支払った人の指定を使わない(必ず自分が全額払った扱い)', () => {
    expect(rows.every((r) => r.partner_paid === 0)).toBe(true)
  })

  it('分割しても預かり残高は分割前とまったく同じ', () => {
    // ここが崩れると、分割するだけで残高が動いてしまう
    expect(partnerBalance(rows)).toBe(partnerBalance([base]))
    expect(partnerBalance(rows)).toBe(-1200)
  })

  it('金額の合計は元の支払い総額と一致する(レポートの合計が変わらない)', () => {
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(base.amount)
  })
})

describe('evenSplit', () => {
  it('割り切れない分は先頭に寄せて、合計を必ず一致させる', () => {
    const parts = evenSplit(1000, 3, 'food')
    expect(splitTotal(parts)).toBe(1000)
    expect(parts.map((p) => p.amount)).toEqual([334, 333, 333])
  })

  it('先頭だけ元のカテゴリを引き継ぐ(残りは選び直させる)', () => {
    const parts = evenSplit(1000, 2, 'food')
    expect(parts[0].category).toBe('food')
    expect(parts[1].category).toBeNull()
  })
})

describe('isSplitPart', () => {
  const tx = (p: Partial<Transaction>): Transaction => ({
    id: 'a',
    date: '2026-08-04',
    type: 'expense',
    amount: 1000,
    category: 'food',
    memo: '',
    store: '',
    partner_amount: 0,
    created_at: '2026-08-04T03:00:00.000Z',
    ...p,
  })

  it('束ねIDを持つ行だけが分割された記録', () => {
    expect(isSplitPart(tx({ split_group: 'g1' }))).toBe(true)
    expect(isSplitPart(tx({ split_group: null }))).toBe(false)
    expect(isSplitPart(tx({}))).toBe(false)
  })
})
