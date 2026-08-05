// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  clearWebhookUrl,
  getWebhookUrl,
  initDiscordWebhook,
  resetDiscordWebhookForTest,
  saveWebhookUrl,
} from './discordWebhook'

// ============================================================
// 端末キャッシュ ⇄ Supabase のつなぎ込み。
//
// ここで守りたいのはただ1つ、**通知が止まらないこと**。
// 同期を足したせいで1通も飛ばなくなるのが、いちばん悪い結果なので:
//   ・サーバーが読めない/書けない/そもそもテーブルが無い、どの場合でも
//     この端末の URL は残り、getWebhookUrl() が返し続ける
//   ・保存は「先に端末、後からサーバー」の順で、await を待たずに効く
// ============================================================

const URL_A = 'https://discord.com/api/webhooks/1111111111111111111/AAAAAAAAAAAAAAAAAAAAAAAA'
const URL_B = 'https://discord.com/api/webhooks/2222222222222222222/BBBBBBBBBBBBBBBBBBBBBBBB'

const CACHE_KEY = 'kakeibo.discordWebhook'

type Upsert = { webhook_url: string | null; updated_at: string; user_id?: string }

const USER_ID = '11111111-1111-1111-1111-111111111111'

/** select / upsert の結果を差し替えられる最小の supabase もどき */
function fakeSupabase(opts: {
  select?: { data: { webhook_url: string | null } | null; error: unknown }
  selectThrows?: Error
  upsertError?: unknown
}) {
  const upserts: Upsert[] = []
  const client = {
    // upsert の衝突判定に使う user_id を、実物と同じくセッションから引く
    auth: { getSession: async () => ({ data: { session: { user: { id: USER_ID } } } }) },
    from: () => ({
      select: () => ({
        maybeSingle: async () => {
          if (opts.selectThrows) throw opts.selectThrows
          return opts.select ?? { data: null, error: null }
        },
      }),
      upsert: async (payload: Upsert) => {
        upserts.push(payload)
        return { error: opts.upsertError ?? null }
      },
    }),
  } as unknown as SupabaseClient
  return { client, upserts }
}

const schemaError = { message: 'relation "public.discord_settings" does not exist', code: '42P01' }
const networkError = { message: 'TypeError: Failed to fetch', code: null }

beforeEach(() => {
  localStorage.clear()
  resetDiscordWebhookForTest()
})

/** 端末に設定済みの状態から始める(既存端末の再現) */
function withLocalUrl(url: string) {
  localStorage.setItem(CACHE_KEY, url)
  resetDiscordWebhookForTest()
}

describe('マイグレーション未実行でも通知は止まらない', () => {
  it('テーブルが無くても、保存した URL はこの端末で使える', async () => {
    const { client, upserts } = fakeSupabase({ select: { data: null, error: schemaError } })
    await initDiscordWebhook(client)
    await saveWebhookUrl(client, URL_A)

    expect(getWebhookUrl()).toBe(URL_A)
    expect(localStorage.getItem(CACHE_KEY)).toBe(URL_A)
    // テーブルが無いと分かったあとは、サーバーに書きに行かない
    expect(upserts).toHaveLength(0)
  })

  it('テーブルが無いとき、既存端末の設定を消さない', async () => {
    withLocalUrl(URL_A)
    const { client } = fakeSupabase({ select: { data: null, error: schemaError } })
    await initDiscordWebhook(client)
    expect(getWebhookUrl()).toBe(URL_A)
  })
})

describe('通信できないときも設定を失わない', () => {
  it('読み取りが失敗しても、この端末の URL はそのまま', async () => {
    withLocalUrl(URL_A)
    const { client } = fakeSupabase({ select: { data: null, error: networkError } })
    await initDiscordWebhook(client)
    expect(getWebhookUrl()).toBe(URL_A)
  })

  it('例外が飛んでも、この端末の URL はそのまま', async () => {
    withLocalUrl(URL_A)
    const { client } = fakeSupabase({ selectThrows: new Error('Load failed') })
    await initDiscordWebhook(client)
    expect(getWebhookUrl()).toBe(URL_A)
  })

  it('サーバーへの書き込みが失敗しても、端末には保存されている', async () => {
    const { client } = fakeSupabase({ upsertError: networkError })
    await saveWebhookUrl(client, URL_A)
    expect(getWebhookUrl()).toBe(URL_A)
    expect(localStorage.getItem(CACHE_KEY)).toBe(URL_A)
  })

  it('保存は await を待たずに効く(サーバーの応答が遅くても通知に間に合う)', () => {
    const { client } = fakeSupabase({})
    void saveWebhookUrl(client, URL_A)
    expect(getWebhookUrl()).toBe(URL_A)
  })
})

describe('既存端末の localStorage からの引き上げ', () => {
  it('サーバーに行が無ければ、この端末の URL を上げる', async () => {
    withLocalUrl(URL_A)
    const { client, upserts } = fakeSupabase({ select: { data: null, error: null } })
    await initDiscordWebhook(client)
    expect(upserts).toHaveLength(1)
    expect(upserts[0].webhook_url).toBe(URL_A)
    // 1ユーザー1行なので、衝突先の列も一緒に送る(行が増えない)
    expect(upserts[0].user_id).toBe(USER_ID)
    expect(getWebhookUrl()).toBe(URL_A)
  })

  it('引き上げは1回で済む(次からはサーバー側の行が読まれる)', async () => {
    withLocalUrl(URL_A)
    const first = fakeSupabase({ select: { data: null, error: null } })
    await initDiscordWebhook(first.client)
    const second = fakeSupabase({ select: { data: { webhook_url: URL_A }, error: null } })
    await initDiscordWebhook(second.client)
    expect(second.upserts).toHaveLength(0)
  })

  it('未設定の端末は、サーバーの値をそのまま受け取る(スマホ側の救済)', async () => {
    const { client } = fakeSupabase({ select: { data: { webhook_url: URL_B }, error: null } })
    await initDiscordWebhook(client)
    expect(getWebhookUrl()).toBe(URL_B)
    expect(localStorage.getItem(CACHE_KEY)).toBe(URL_B)
  })

  it('食い違ったらサーバーが勝つ(端末の古い写しを上げ直さない)', async () => {
    withLocalUrl(URL_A)
    const { client, upserts } = fakeSupabase({ select: { data: { webhook_url: URL_B }, error: null } })
    await initDiscordWebhook(client)
    expect(getWebhookUrl()).toBe(URL_B)
    expect(upserts).toHaveLength(0)
  })

  it('他の端末での解除が届き、古い URL は復活しない', async () => {
    withLocalUrl(URL_A)
    const { client, upserts } = fakeSupabase({ select: { data: { webhook_url: null }, error: null } })
    await initDiscordWebhook(client)
    expect(getWebhookUrl()).toBeNull()
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    expect(upserts).toHaveLength(0)
  })
})

describe('解除も同期される', () => {
  it('行は消さず null を保存する(消すと他の端末が復活させてしまう)', async () => {
    withLocalUrl(URL_A)
    const { client, upserts } = fakeSupabase({})
    await clearWebhookUrl(client)
    expect(getWebhookUrl()).toBeNull()
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    expect(upserts).toEqual([expect.objectContaining({ webhook_url: null })])
  })
})
