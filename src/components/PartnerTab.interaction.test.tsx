// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SupabaseClient } from '@supabase/supabase-js'
import PartnerTab from './PartnerTab'
import type { TransactionInput, useTransactions } from '../hooks/useTransactions'
import { partnerBalance, partnerImpact } from '../lib/partnerBalance'
import type { Transaction } from '../lib/types'

// ============================================================
// 彼女タブの記録カード —— 預かる / 返す / 調整 (機能012)
//
// 以前は「返す・調整」だけが別カードのボタンから開くシートに入っていた。
// そのシートは無くなり、いまは1枚のカードのチップで切り替える。
// 変わったのは形だけで、**取り違えると預かり残高が静かに壊れる** ことは同じ:
//   ・返したはずのお金で残高が増える
//   ・調整の向きが逆になる
//
// 「選んだ種類 → 保存される type と金額の符号」の対応は
// lib/partnerSettlement.ts の純粋関数が持っているが、
// **どのチップがどの種類につながっているか** はこの画面にしか無い。
// だから実際に押して、保存される内容そのものを受け取って確かめる。
// ============================================================

afterEach(cleanup)

// jsdom は window.scrollTo を実装していない(背面固定の解除で呼ばれるだけ)
window.scrollTo = () => {}

function deposit(amount: number): Transaction {
  return {
    id: `d${amount}`,
    date: '2026-08-01',
    type: 'partner_deposit',
    amount,
    category: null,
    memo: '',
    store: '',
    partner_amount: 0,
    created_at: '2026-08-01T01:00:00.000Z',
  }
}

/** 預かり残高がちょうど balance 円になる状態で開く */
function setup(balance = 30000) {
  const transactions = [deposit(balance)]
  // 画面が読む残高と、テストが期待する残高が同じ式から出ていること
  expect(partnerBalance(transactions)).toBe(balance)

  const submitted: TransactionInput[] = []
  const store = {
    transactions,
    add: async (input: TransactionInput) => {
      submitted.push(input)
    },
  } as unknown as ReturnType<typeof useTransactions>

  render(<PartnerTab store={store} supabase={{} as SupabaseClient} onEdit={() => {}} />)
  return { user: userEvent.setup(), submitted }
}

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement

async function typeAmount(user: ReturnType<typeof userEvent.setup>, label: string, v: string) {
  await user.type(screen.getByLabelText(label), v)
}

describe('記録カードが保存する種別と符号', () => {
  it('既定の「預かる」は預かりとして、残高を増やす向きで積む', async () => {
    const { user, submitted } = setup()
    await typeAmount(user, '預かり金額(円)', '5000')
    await user.click(button('預かりを記録'))

    expect(submitted[0]).toMatchObject({
      type: 'partner_deposit',
      amount: 5000,
      category: null,
      store: '',
      partner_amount: 0,
    })
    expect(partnerImpact(submitted[0] as Transaction)).toBe(5000)
  })

  it('「返す」は返金として、残高を減らす向きで積む', async () => {
    const { user, submitted } = setup()
    await user.click(button('返す'))
    await typeAmount(user, '返した金額(円)', '5000')
    await user.click(button('返金を記録'))

    expect(submitted[0]).toMatchObject({ type: 'partner_refund', amount: 5000, partner_amount: 0 })
    // 種別と金額の組が、残高を減らす向きになっていること
    expect(partnerImpact(submitted[0] as Transaction)).toBe(-5000)
  })

  it('「調整・残高を減らす」は符号つきのマイナスで保存する(数字に符号を打たせない)', async () => {
    const { user, submitted } = setup()
    await user.click(button('調整'))
    await user.click(button('残高を減らす'))
    await typeAmount(user, '調整する金額(円)', '700')
    await user.click(button('調整を記録'))

    expect(submitted[0]).toMatchObject({ type: 'partner_adjust', amount: -700 })
    expect(partnerImpact(submitted[0] as Transaction)).toBe(-700)
  })

  it('「調整・残高を増やす」はプラスで保存する', async () => {
    const { user, submitted } = setup()
    await user.click(button('調整'))
    await typeAmount(user, '調整する金額(円)', '700')
    await user.click(button('調整を記録'))

    expect(submitted[0]).toMatchObject({ type: 'partner_adjust', amount: 700 })
  })

  it('理由(メモ)はそのまま記録に残る(共有ページにも出るため)', async () => {
    const { user, submitted } = setup()
    await user.click(button('調整'))
    await user.type(screen.getByPlaceholderText(/計算違い/), '7/3 の割り勘の計算違い')
    await typeAmount(user, '調整する金額(円)', '700')
    await user.click(button('調整を記録'))

    expect(submitted[0].memo).toBe('7/3 の割り勘の計算違い')
  })

  it('種類を切り替えると、見出し・金額欄・保存ボタンがそろって変わる', async () => {
    // 3か所のうち1つでも取り残されると、「返すつもりで預かりを記録した」が起きる
    const { user } = setup()
    expect(screen.getByRole('heading', { name: '預かりを記録' })).toBeTruthy()

    await user.click(button('返す'))
    expect(screen.getByRole('heading', { name: '返金を記録' })).toBeTruthy()
    expect(screen.getByLabelText('返した金額(円)')).toBeTruthy()
    expect(button('返金を記録')).toBeTruthy()

    await user.click(button('調整'))
    expect(screen.getByRole('heading', { name: '残高を調整' })).toBeTruthy()
    expect(screen.getByLabelText('調整する金額(円)')).toBeTruthy()
    expect(button('調整を記録')).toBeTruthy()
  })

  it('調整のときだけ向きを選ばせる(預かる・返すは種別で向きが決まっている)', async () => {
    const { user } = setup()
    expect(screen.queryByRole('group', { name: '調整の向き' })).toBeNull()
    await user.click(button('返す'))
    expect(screen.queryByRole('group', { name: '調整の向き' })).toBeNull()
    await user.click(button('調整'))
    expect(screen.getByRole('group', { name: '調整の向き' })).toBeTruthy()
  })
})

describe('記録カードの「この記録のあと」', () => {
  it('返すと残高が減った状態を、言葉と絶対値で先に見せる', async () => {
    const { user } = setup(30000)
    await user.click(button('返す'))
    await typeAmount(user, '返した金額(円)', '5000')
    const preview = screen.getByText(/この記録のあと/).textContent ?? ''
    expect(preview).toContain('¥25,000')
    expect(preview).toContain('預かり中')
  })

  it('預かりを超えて返すと「立て替え中」に変わることが分かる', async () => {
    const { user } = setup(3000)
    await user.click(button('返す'))
    await typeAmount(user, '返した金額(円)', '5000')
    const preview = screen.getByText(/この記録のあと/).textContent ?? ''
    // 符号ではなく言葉で伝える(機能011)。金額は絶対値
    expect(preview).toContain('¥2,000')
    expect(preview).toContain('立て替え中')
  })

  it('調整の向きを変えると、見込みも同じ向きに動く', async () => {
    const { user } = setup(30000)
    await user.click(button('調整'))
    await typeAmount(user, '調整する金額(円)', '700')
    expect(screen.getByText(/この記録のあと/).textContent).toContain('¥30,700')
    await user.click(button('残高を減らす'))
    expect(screen.getByText(/この記録のあと/).textContent).toContain('¥29,300')
  })

  it('金額を入れるまでは、保存も見込みも出さない', () => {
    setup()
    expect(button('預かりを記録').disabled).toBe(true)
    expect(screen.queryByText(/この記録のあと/)).toBeNull()
  })
})
