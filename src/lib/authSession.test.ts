import { describe, it, expect, vi } from 'vitest'
import {
  needsRefresh,
  isExpiredTokenResponse,
  isAuthEndpoint,
  withAuthHeader,
  createSelfHealingFetch,
  createRefresher,
  ensureFreshSession,
  REFRESH_MARGIN_SEC,
  type SessionRefresher,
} from './authSession'

const NOW = 1_700_000_000

describe('needsRefresh', () => {
  it('まだ十分先なら更新しない', () => {
    expect(needsRefresh(NOW + 3600, NOW)).toBe(false)
  })

  it('余裕を割り込んだら、切れる前でも更新する', () => {
    expect(needsRefresh(NOW + REFRESH_MARGIN_SEC - 1, NOW)).toBe(true)
  })

  it('すでに切れていれば更新する', () => {
    expect(needsRefresh(NOW - 1, NOW)).toBe(true)
  })

  it('期限が読めないときは更新する側に倒す(切れたまま投げない)', () => {
    expect(needsRefresh(null, NOW)).toBe(true)
    expect(needsRefresh(undefined, NOW)).toBe(true)
    expect(needsRefresh(Number.NaN, NOW)).toBe(true)
  })
})

describe('isExpiredTokenResponse', () => {
  it('401 の JWT expired は送り直せる', () => {
    expect(isExpiredTokenResponse(401, '{"message":"JWT expired","code":"PGRST301"}')).toBe(true)
  })

  it('成功や 500 は対象外', () => {
    expect(isExpiredTokenResponse(200, 'JWT expired')).toBe(false)
    expect(isExpiredTokenResponse(500, 'JWT expired')).toBe(false)
  })

  it('権限が無いだけ(RLS)は送り直さない — 何度送っても同じ', () => {
    expect(isExpiredTokenResponse(401, '{"message":"permission denied for table transactions"}')).toBe(
      false
    )
    expect(isExpiredTokenResponse(401, '{"message":"Invalid API key"}')).toBe(false)
  })
})

describe('isAuthEndpoint', () => {
  it('更新そのものの往復は送り直しの対象にしない(輪にしない)', () => {
    expect(isAuthEndpoint('https://x.supabase.co/auth/v1/token?grant_type=refresh_token')).toBe(true)
    expect(isAuthEndpoint('https://x.supabase.co/rest/v1/transactions')).toBe(false)
    expect(isAuthEndpoint(new URL('https://x.supabase.co/auth/v1/user'))).toBe(true)
  })
})

describe('withAuthHeader', () => {
  it('Authorization だけ差し替え、他のヘッダは落とさない', () => {
    const init = { method: 'POST', headers: { apikey: 'anon', Authorization: 'Bearer old' } }
    const next = withAuthHeader('https://x/rest/v1/t', init, 'new')
    const headers = next.headers as Headers
    expect(headers.get('Authorization')).toBe('Bearer new')
    expect(headers.get('apikey')).toBe('anon')
    expect(next.method).toBe('POST')
  })

  it('init に headers が無いときは Request 側から引き継ぐ', () => {
    const req = new Request('https://x/rest/v1/t', { headers: { apikey: 'anon' } })
    const headers = withAuthHeader(req, undefined, 'new').headers as Headers
    expect(headers.get('apikey')).toBe('anon')
    expect(headers.get('Authorization')).toBe('Bearer new')
  })
})

/** 本文と状態だけの応答を作る小道具 */
function res(status: number, body: string): Response {
  return new Response(body, { status })
}

describe('createSelfHealingFetch', () => {
  const refresher = (token: string | null): SessionRefresher => ({
    refreshSession: async () => ({ accessToken: token }),
  })

  it('成功した往復はそのまま通す(更新しない)', async () => {
    const base = vi.fn(async () => res(200, '[]'))
    const refresh = vi.fn(async () => ({ accessToken: 'new' }))
    const f = createSelfHealingFetch({ refreshSession: refresh }, base as unknown as typeof fetch)

    const out = await f('https://x/rest/v1/transactions', { headers: { apikey: 'anon' } })
    expect(out.status).toBe(200)
    expect(refresh).not.toHaveBeenCalled()
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('期限切れは、黙って更新して1回だけ送り直す', async () => {
    const base = vi
      .fn()
      .mockResolvedValueOnce(res(401, '{"message":"JWT expired","code":"PGRST301"}'))
      .mockResolvedValueOnce(res(200, '[{"id":1}]'))
    const f = createSelfHealingFetch(refresher('new-token'), base as unknown as typeof fetch)

    const out = await f('https://x/rest/v1/transactions', {
      headers: { apikey: 'anon', Authorization: 'Bearer old' },
    })
    expect(out.status).toBe(200)
    expect(await out.text()).toBe('[{"id":1}]')
    expect(base).toHaveBeenCalledTimes(2)
    // 送り直しは新しいトークンで飛ぶ
    const retryHeaders = (base.mock.calls[1][1] as RequestInit).headers as Headers
    expect(retryHeaders.get('Authorization')).toBe('Bearer new-token')
    expect(retryHeaders.get('apikey')).toBe('anon')
  })

  it('送り直しは1回まで(2回目も期限切れなら、そのまま返す)', async () => {
    const expired = () => res(401, '{"message":"JWT expired"}')
    const base = vi.fn(async () => expired())
    const f = createSelfHealingFetch(refresher('new-token'), base as unknown as typeof fetch)

    const out = await f('https://x/rest/v1/transactions', { headers: { apikey: 'anon' } })
    expect(out.status).toBe(401)
    expect(base).toHaveBeenCalledTimes(2)
  })

  it('更新できなかったときは、元の応答をそのまま返す(案内は今までどおり出る)', async () => {
    const base = vi.fn(async () => res(401, '{"message":"JWT expired"}'))
    const f = createSelfHealingFetch(refresher(null), base as unknown as typeof fetch)

    const out = await f('https://x/rest/v1/transactions', { headers: { apikey: 'anon' } })
    expect(out.status).toBe(401)
    expect(await out.text()).toContain('JWT expired')
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('権限エラー(RLS)は送り直さない', async () => {
    const base = vi.fn(async () => res(401, '{"message":"permission denied"}'))
    const refresh = vi.fn(async () => ({ accessToken: 'new' }))
    const f = createSelfHealingFetch({ refreshSession: refresh }, base as unknown as typeof fetch)

    await f('https://x/rest/v1/transactions', { headers: { apikey: 'anon' } })
    expect(refresh).not.toHaveBeenCalled()
    expect(base).toHaveBeenCalledTimes(1)
  })

  it('更新そのものが 401 でも送り直さない(輪にしない)', async () => {
    const base = vi.fn(async () => res(401, '{"message":"JWT expired"}'))
    const refresh = vi.fn(async () => ({ accessToken: 'new' }))
    const f = createSelfHealingFetch({ refreshSession: refresh }, base as unknown as typeof fetch)

    await f('https://x/auth/v1/token?grant_type=refresh_token', { headers: { apikey: 'anon' } })
    expect(refresh).not.toHaveBeenCalled()
    expect(base).toHaveBeenCalledTimes(1)
  })
})

describe('createRefresher', () => {
  it('同時に呼ばれても更新は1回だけ(更新トークンを使い回さない)', async () => {
    let resolve: (v: unknown) => void = () => {}
    const pending = new Promise((r) => {
      resolve = r
    })
    const refreshSession = vi.fn(async () => {
      await pending
      return { data: { session: { access_token: 'new' } }, error: null }
    })
    const r = createRefresher({ auth: { refreshSession } } as never)

    const both = Promise.all([r.refreshSession(), r.refreshSession()])
    resolve(null)
    const [a, b] = await both

    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(a.accessToken).toBe('new')
    expect(b.accessToken).toBe('new')
  })

  it('更新に失敗しても例外を投げない(null を返すだけ)', async () => {
    const r = createRefresher({
      auth: { refreshSession: async () => ({ data: { session: null }, error: { message: 'x' } }) },
    } as never)
    await expect(r.refreshSession()).resolves.toEqual({ accessToken: null })
  })

  it('通信ごと落ちても例外を投げない', async () => {
    const r = createRefresher({
      auth: {
        refreshSession: async () => {
          throw new Error('Failed to fetch')
        },
      },
    } as never)
    await expect(r.refreshSession()).resolves.toEqual({ accessToken: null })
  })
})

describe('ensureFreshSession', () => {
  const sessionOf = (expiresAt: number | null) =>
    ({
      auth: { getSession: async () => ({ data: { session: { expires_at: expiresAt } } }) },
    }) as never

  it('ログインしていなければ何もしない', async () => {
    const refresh = vi.fn(async () => ({ accessToken: 'new' }))
    const supabase = { auth: { getSession: async () => ({ data: { session: null } }) } } as never
    await expect(ensureFreshSession(supabase, { refreshSession: refresh }, NOW)).resolves.toBe('none')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('まだ先なら更新しない', async () => {
    const refresh = vi.fn(async () => ({ accessToken: 'new' }))
    await expect(
      ensureFreshSession(sessionOf(NOW + 3600), { refreshSession: refresh }, NOW)
    ).resolves.toBe('fresh')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('切れかけていれば、使われる前に更新しておく', async () => {
    const refresh = vi.fn(async () => ({ accessToken: 'new' }))
    await expect(
      ensureFreshSession(sessionOf(NOW + 10), { refreshSession: refresh }, NOW)
    ).resolves.toBe('refreshed')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('更新できなかったことは分かるが、例外にはしない', async () => {
    await expect(
      ensureFreshSession(sessionOf(NOW - 10), { refreshSession: async () => ({ accessToken: null }) }, NOW)
    ).resolves.toBe('failed')
  })
})
