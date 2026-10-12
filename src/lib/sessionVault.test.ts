import { describe, it, expect, vi } from 'vitest'
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import {
  VAULT_KEY,
  authViewFor,
  clearVault,
  parseVault,
  readVault,
  restoreFromVault,
  vaultEntryOf,
  writeVault,
} from './sessionVault'

/** Storage の最小の写し(テスト用) */
function fakeStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init))
  return {
    get length() {
      return m.size
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  }
}

const SESSION = { refresh_token: 'rt-1', user: { id: 'u1' } }
const stored = (token = 'rt-1') =>
  fakeStorage({ [VAULT_KEY]: JSON.stringify({ refreshToken: token, userId: 'u1', savedAt: 'x' }) })

describe('parseVault', () => {
  it('壊れた値・空のトークンは控えとして扱わない', () => {
    expect(parseVault(null)).toBeNull()
    expect(parseVault('not json')).toBeNull()
    expect(parseVault('null')).toBeNull()
    expect(parseVault(JSON.stringify({ refreshToken: '', userId: 'u1', savedAt: 'x' }))).toBeNull()
    expect(parseVault(JSON.stringify({ refreshToken: 'rt', savedAt: 'x' }))).toBeNull()
  })

  it('正しい形なら読める', () => {
    expect(parseVault(JSON.stringify({ refreshToken: 'rt', userId: 'u1', savedAt: 'x' }))).toEqual({
      refreshToken: 'rt',
      userId: 'u1',
      savedAt: 'x',
    })
  })
})

describe('控えの読み書き', () => {
  it('更新トークンが無いセッションからは控えを作らない', () => {
    expect(vaultEntryOf({ refresh_token: '', user: { id: 'u1' } })).toBeNull()
  })

  it('書いて読める・消せる', () => {
    const storage = fakeStorage()
    writeVault(SESSION, storage)
    expect(readVault(storage)?.refreshToken).toBe('rt-1')
    clearVault(storage)
    expect(readVault(storage)).toBeNull()
  })

  it('更新のたびに最新のトークンへ書き換わる', () => {
    const storage = fakeStorage()
    writeVault(SESSION, storage)
    writeVault({ refresh_token: 'rt-2', user: { id: 'u1' } }, storage)
    expect(readVault(storage)?.refreshToken).toBe('rt-2')
  })

  it('localStorage が使えない端末でも例外を出さない(ログインを止めない)', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    } as unknown as Storage
    expect(() => writeVault(SESSION, broken)).not.toThrow()
    expect(readVault(broken)).toBeNull()
    expect(() => clearVault(broken)).not.toThrow()
  })
})

/** refreshSession だけを持つ最小の auth */
function authReturning(result: unknown) {
  const refreshSession = vi.fn(async () => result)
  return { auth: { refreshSession } as never, refreshSession }
}

describe('restoreFromVault', () => {
  it('控えが無ければ、サーバーに問い合わせずにログイン画面へ', async () => {
    const { auth, refreshSession } = authReturning({ data: { session: null }, error: null })
    await expect(restoreFromVault(auth, { storage: fakeStorage(), online: true })).resolves.toBe(
      'no-backup'
    )
    expect(refreshSession).not.toHaveBeenCalled()
  })

  it('控えのトークンで戻せたら、控えも新しいトークンにする', async () => {
    const storage = stored('rt-old')
    const { auth, refreshSession } = authReturning({
      data: { session: { refresh_token: 'rt-new', user: { id: 'u1' } } },
      error: null,
    })
    await expect(restoreFromVault(auth, { storage, online: true })).resolves.toBe('restored')
    expect(refreshSession).toHaveBeenCalledWith({ refresh_token: 'rt-old' })
    expect(readVault(storage)?.refreshToken).toBe('rt-new')
  })

  it('圏外なら試さず、控えは残す(電波が戻れば戻せる)', async () => {
    const storage = stored()
    const { auth, refreshSession } = authReturning({ data: { session: null }, error: null })
    await expect(restoreFromVault(auth, { storage, online: false })).resolves.toBe('offline')
    expect(refreshSession).not.toHaveBeenCalled()
    expect(readVault(storage)).not.toBeNull()
  })

  it('通信の失敗なら控えは残す', async () => {
    const storage = stored()
    const { auth } = authReturning({
      data: { session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    })
    await expect(restoreFromVault(auth, { storage, online: true })).resolves.toBe('offline')
    expect(readVault(storage)).not.toBeNull()
  })

  it('例外で落ちても控えは残す', async () => {
    const storage = stored()
    const auth = {
      refreshSession: async () => {
        throw new TypeError('Load failed')
      },
    } as never
    await expect(restoreFromVault(auth, { storage, online: true })).resolves.toBe('offline')
    expect(readVault(storage)).not.toBeNull()
  })

  it('控えもサーバーに断られたら、控えを消してログイン画面へ', async () => {
    const storage = stored()
    const { auth } = authReturning({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found'),
    })
    await expect(restoreFromVault(auth, { storage, online: true })).resolves.toBe('rejected')
    expect(readVault(storage)).toBeNull()
  })

  it('同時に呼ばれても、サーバーへは1回だけ(同じトークンを2回使わない)', async () => {
    const storage = stored()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const refreshSession = vi.fn(async () => {
      await gate
      return { data: { session: { refresh_token: 'rt-2', user: { id: 'u1' } } }, error: null }
    })
    const auth = { refreshSession } as never
    const both = Promise.all([
      restoreFromVault(auth, { storage, online: true }),
      restoreFromVault(auth, { storage, online: true }),
    ])
    release()
    await expect(both).resolves.toEqual(['restored', 'restored'])
    expect(refreshSession).toHaveBeenCalledTimes(1)
  })
})

describe('authViewFor', () => {
  const view = (hasSession: boolean, restore: Parameters<typeof authViewFor>[0]['restore']) =>
    authViewFor({ ready: true, hasSession, restore })

  it('起動直後は読み込み中', () => {
    expect(authViewFor({ ready: false, hasSession: false, restore: 'pending' })).toBe('loading')
  })

  it('ログインしていれば本体', () => {
    expect(view(true, 'pending')).toBe('app')
    expect(view(true, 'rejected')).toBe('app')
  })

  // セッションが無いのに本体を出すと、RLS で0件が返ってキャッシュが空で上書きされる
  it('セッションが無い間は、本体を出さない', () => {
    for (const r of ['pending', 'restored', 'offline', 'no-backup', 'rejected'] as const) {
      expect(view(false, r)).not.toBe('app')
    }
  })

  it('戻している最中・戻った直後は「復帰中」(ログイン画面を一瞬も出さない)', () => {
    expect(view(false, 'pending')).toBe('restoring')
    expect(view(false, 'restored')).toBe('restoring')
  })

  it('通信できないだけなら、ログイン画面ではなく電波を待つ', () => {
    expect(view(false, 'offline')).toBe('waiting')
  })

  it('控えが無い・断られたときだけログイン画面', () => {
    expect(view(false, 'no-backup')).toBe('login')
    expect(view(false, 'rejected')).toBe('login')
  })
})
