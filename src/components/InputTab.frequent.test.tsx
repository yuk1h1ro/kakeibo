// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SupabaseClient } from '@supabase/supabase-js'
import InputTab from './InputTab'
import type { TransactionInput, useTransactions } from '../hooks/useTransactions'
import type { Transaction } from '../lib/types'
import { daysAgoISO } from '../lib/format'

// ============================================================
// よく使う記録 (frequentEntries.ts)。何度も入れている定番を1回押すだけで入れ直せること。
// 並べ方・数え方は lib のテストが守っているので、ここでは
// 「押すと保存される中身がその定番のとおりになるか」を見る。
// ============================================================

afterEach(cleanup)

let seq = 0
function train(daysAgo: number, over: Partial<Transaction> = {}): Transaction {
  seq++
  return {
    id: `t${seq}`,
    date: daysAgoISO(daysAgo),
    type: 'expense',
    amount: 418,
    category: 'transport',
    memo: '羽沢横浜国大→新宿',
    store: 'JR',
    partner_amount: 0,
    created_at: `2026-10-01T00:00:${String(seq).padStart(2, '0')}Z`,
    ...over,
  }
}

function setup(transactions: Transaction[]) {
  const added: TransactionInput[] = []
  const store = {
    transactions,
    add: vi.fn(async (input: TransactionInput) => {
      added.push(input)
    }),
    addMany: vi.fn(async () => {}),
  } as unknown as ReturnType<typeof useTransactions>
  render(<InputTab store={store} supabase={{} as SupabaseClient} />)
  return { user: userEvent.setup(), added }
}

describe('よく使う記録', () => {
  it('2回以上同じ内容で入れた定番が並び、押して「記録する」だけで同じ中身が保存される', async () => {
    const { user, added } = setup([
      train(1),
      train(2),
      train(3),
      // 1回きりの記録は定番ではない
      train(4, { memo: '横浜→渋谷', amount: 300 }),
    ])
    const chip = screen.getByRole('button', { name: /JR 羽沢横浜国大→新宿.*3回/ })
    expect(screen.queryByRole('button', { name: /横浜→渋谷.*回/ })).toBeNull()

    await user.click(chip)
    await user.click(screen.getByRole('button', { name: '記録する' }))

    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({
      type: 'expense',
      category: 'transport',
      store: 'JR',
      memo: '羽沢横浜国大→新宿',
      amount: 418,
      partner_amount: 0,
      date: daysAgoISO(0),
    })
  })

  it('二人で乗った回は、彼女の負担分も一緒に入る', async () => {
    const { user, added } = setup([
      train(1, { amount: 836, partner_amount: 418 }),
      train(2, { amount: 836, partner_amount: 418 }),
    ])
    await user.click(screen.getByRole('button', { name: /羽沢横浜国大→新宿.*2回/ }))
    await user.click(screen.getByRole('button', { name: '記録する' }))
    expect(added[0]).toMatchObject({ amount: 836, partner_amount: 418 })
  })

  it('定番が無いうちは何も出さない', () => {
    setup([train(1)])
    expect(screen.queryByText('よく使う記録')).toBeNull()
  })
})
