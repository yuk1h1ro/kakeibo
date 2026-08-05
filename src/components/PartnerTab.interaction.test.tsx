// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SupabaseClient } from '@supabase/supabase-js'
import PartnerTab from './PartnerTab'
import type { TransactionInput, useTransactions } from '../hooks/useTransactions'
import { partnerBalance, partnerImpact } from '../lib/partnerBalance'
import {
  getWebhookUrl,
  initDiscordWebhook,
  resetDiscordWebhookForTest,
} from '../lib/discordWebhook'
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

// Discord の設定はモジュールレベルのストアに載っているので、
// 1件ずつ初期状態に戻さないと前のテストの URL が残る
beforeEach(() => {
  localStorage.clear()
  resetDiscordWebhookForTest()
})

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
function setup(balance = 30000, supabase: SupabaseClient = {} as SupabaseClient) {
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

  render(<PartnerTab store={store} supabase={supabase} onEdit={() => {}} />)
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

// ============================================================
// Discord通知カード
//
// この機能の存在理由は「彼女に残高の増減を知らせる」こと。
// Webhook URL が端末ごとだった頃は、いちばん入力に使っているスマホで
// 設定されておらず、**通知されるべき経路が丸ごと通知されていなかった**。
// いまは discord_settings で端末間に同期する。ここで確かめるのは:
//   ・設定・解除が **サーバーにも** 送られること(片方だけ直らない)
//   ・秘密のトークンは画面に出さないこと
//   ・テスト送信の結果表示(原因ごとの文言)が生きていること
//   ・同期できない環境でも、設定できて通知が止まらないこと
// ============================================================

const WEBHOOK = 'https://discord.com/api/webhooks/1234567890123456789/SECRET-TOKEN-abcdefghij'

/** upsert された中身を記録する supabase もどき */
function fakeSupabase(row: { webhook_url: string | null } | null = null, error: unknown = null) {
  const upserts: { webhook_url: string | null }[] = []
  const client = {
    from: () => ({
      select: () => ({ maybeSingle: async () => ({ data: row, error }) }),
      upsert: async (payload: { webhook_url: string | null }) => {
        upserts.push(payload)
        return { error: null }
      },
      // 彼女タブはコメントも読みに行く。ここでは使わないので空で返す
      order: async () => ({ data: [], error: null }),
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
      update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
    }),
  } as unknown as SupabaseClient
  return { client, upserts }
}

/**
 * Discord通知カードの中だけを見る。
 * 「保存」ボタンは残高アラートのカードにもあるので、画面全体から探すと取り違える
 */
function discordCard() {
  const card = screen.getByRole('heading', { name: 'Discord通知' }).closest('.card')
  if (!card) throw new Error('Discord通知カードが見つかりません')
  return within(card as HTMLElement)
}

describe('Discord通知の設定', () => {
  it('保存すると、この端末にもサーバーにも入る(他の端末に反映される)', async () => {
    const { client, upserts } = fakeSupabase()
    const { user } = setup(30000, client)

    await user.type(discordCard().getByLabelText('Webhook URL'), WEBHOOK)
    await user.click(discordCard().getByRole('button', { name: '保存' }))

    // 端末側は即座に効く(サーバーの応答を待たない = 通知に間に合う)
    expect(getWebhookUrl()).toBe(WEBHOOK)
    await waitFor(() => expect(upserts).toEqual([expect.objectContaining({ webhook_url: WEBHOOK })]))
  })

  it('保存後の表示は伏字で、秘密のトークンは出さない', async () => {
    const { client } = fakeSupabase()
    const { user } = setup(30000, client)

    await user.type(discordCard().getByLabelText('Webhook URL'), WEBHOOK)
    await user.click(discordCard().getByRole('button', { name: '保存' }))

    expect(discordCard().getByText('✓ 通知は有効です')).toBeTruthy()
    expect(document.body.textContent).not.toContain('SECRET-TOKEN')
    // どのチャンネルかは分かる(ホストと ID の頭まで)
    expect(document.body.textContent).toContain('https://discord.com/api/webhooks/1234567')
  })

  it('形式の違う URL は保存させない(別の場所へ送ってしまうため)', async () => {
    const { client, upserts } = fakeSupabase()
    const { user } = setup(30000, client)

    await user.type(discordCard().getByLabelText('Webhook URL'), 'https://evil.example.com/hook')
    await user.click(discordCard().getByRole('button', { name: '保存' }))

    expect(discordCard().getByText(/の形式.*を入力してください/)).toBeTruthy()
    expect(getWebhookUrl()).toBeNull()
    expect(upserts).toHaveLength(0)
  })

  it('解除もサーバーへ送る(行は消さず null を書く)', async () => {
    // 解除が端末の中だけで終わると、他の端末からは鳴り続ける
    const { client, upserts } = fakeSupabase()
    const { user } = setup(30000, client)

    await user.type(discordCard().getByLabelText('Webhook URL'), WEBHOOK)
    await user.click(discordCard().getByRole('button', { name: '保存' }))
    await user.click(discordCard().getByRole('button', { name: '解除' }))

    expect(getWebhookUrl()).toBeNull()
    // 入力欄に戻っている
    expect(discordCard().getByLabelText('Webhook URL')).toBeTruthy()
    await waitFor(() =>
      expect(upserts[upserts.length - 1]).toEqual(expect.objectContaining({ webhook_url: null }))
    )
  })

  it('他の端末で設定した URL が、この端末の画面にそのまま出る', async () => {
    // 起動時の初回同期。スマホで設定 → PC を開くとここが効く
    const { client } = fakeSupabase({ webhook_url: WEBHOOK })
    await initDiscordWebhook(client)
    setup(30000, client)

    expect(discordCard().getByText('✓ 通知は有効です')).toBeTruthy()
    expect(document.body.textContent).not.toContain('SECRET-TOKEN')
  })
})

describe('Discord通知のテスト送信', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('Webhook が無効なときは、URL の取り直し方まで出す', async () => {
    // チャンネルを作り直すと 404 になる。いちばん多い原因なので、
    // 「通信を確認してください」で終わらせない
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
    const { client } = fakeSupabase()
    const { user } = setup(30000, client)

    await user.type(discordCard().getByLabelText('Webhook URL'), WEBHOOK)
    await user.click(discordCard().getByRole('button', { name: '保存' }))
    await user.click(discordCard().getByRole('button', { name: 'テスト送信' }))

    await waitFor(() => expect(discordCard().getByText(/Webhook URL が古い/)).toBeTruthy())
  })

  it('届いたときは、確認先まで書いて知らせる', async () => {
    // Discord は Webhook の投稿成功に 204 を返す(本文なし)
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }))
    const { client } = fakeSupabase()
    const { user } = setup(30000, client)

    await user.type(discordCard().getByLabelText('Webhook URL'), WEBHOOK)
    await user.click(discordCard().getByRole('button', { name: '保存' }))
    await user.click(discordCard().getByRole('button', { name: 'テスト送信' }))

    await waitFor(() => expect(discordCard().getByText(/テスト通知を送信しました/)).toBeTruthy())
  })
})

describe('マイグレーション未実行の環境の Discord通知', () => {
  it('同期されないことを伝えつつ、設定はできる(通知は止めない)', async () => {
    const schemaError = { message: 'relation "discord_settings" does not exist', code: '42P01' }
    const { client, upserts } = fakeSupabase(null, schemaError)
    await initDiscordWebhook(client)
    const { user } = setup(30000, client)

    expect(discordCard().getByText(/この端末にだけ保存されています/)).toBeTruthy()

    await user.type(discordCard().getByLabelText('Webhook URL'), WEBHOOK)
    await user.click(discordCard().getByRole('button', { name: '保存' }))

    // 機能は消えない。同期されないだけ
    expect(getWebhookUrl()).toBe(WEBHOOK)
    expect(discordCard().getByText('✓ 通知は有効です')).toBeTruthy()
    expect(upserts).toHaveLength(0)
  })
})
