import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KEEP_ON_SIGN_OUT,
  cleanupAfterSignOut,
  clearLocalData,
  clearSupabaseSession,
  keysToClear,
  supabaseSessionKeys,
  markSignOutRequested,
  takeSignOutRequest,
} from './localData'

/** localStorage の代わり(テストは Node 環境で走るため) */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage
}

const stored = {
  'kakeibo.txCache': '[]',
  'kakeibo.geminiApiKey': 'AIza...',
  'kakeibo.discordWebhook': 'https://discord.com/api/webhooks/x',
  'kakeibo.savedFilters': '[]',
  'kakeibo.supabaseUrl': 'https://x.supabase.co',
  'kakeibo.supabaseAnonKey': 'anon',
  'kakeibo.amountMask': 'on',
  'sb-abcdef-auth-token': '{}',
  'other-app.setting': '1',
}

describe('keysToClear', () => {
  it('kakeibo. のキーだけを対象にする(他のアプリのキーは触らない)', () => {
    const got = keysToClear(Object.keys(stored), [])
    expect(got).not.toContain('other-app.setting')
    expect(got).not.toContain('sb-abcdef-auth-token')
    expect(got).toContain('kakeibo.geminiApiKey')
  })

  it('残すキーは対象から外す', () => {
    const got = keysToClear(Object.keys(stored), KEEP_ON_SIGN_OUT)
    // 接続設定を消すと初期設定からやり直しになるので残す
    expect(got).not.toContain('kakeibo.supabaseUrl')
    expect(got).not.toContain('kakeibo.supabaseAnonKey')
    // 目隠しをオンにしていた状態を消すと、次のログインで金額が丸見えに戻る
    expect(got).not.toContain('kakeibo.amountMask')
    expect(got).toContain('kakeibo.txCache')
  })
})

describe('supabaseSessionKeys', () => {
  it('Supabase のログイン状態のキーを見つける', () => {
    expect(supabaseSessionKeys(Object.keys(stored))).toEqual(['sb-abcdef-auth-token'])
  })
})

describe('clearLocalData / clearSupabaseSession', () => {
  it('消す対象だけを消す', () => {
    const storage = fakeStorage(stored)
    clearLocalData(KEEP_ON_SIGN_OUT, storage)
    expect(storage.getItem('kakeibo.geminiApiKey')).toBeNull()
    expect(storage.getItem('kakeibo.txCache')).toBeNull()
    expect(storage.getItem('kakeibo.supabaseUrl')).toBe('https://x.supabase.co')
    expect(storage.getItem('other-app.setting')).toBe('1')
    expect(storage.getItem('sb-abcdef-auth-token')).toBe('{}')
  })

  it('接続設定のやり直しでは接続情報もログイン状態も消す', () => {
    const storage = fakeStorage(stored)
    clearLocalData([], storage)
    clearSupabaseSession(storage)
    expect(storage.getItem('kakeibo.supabaseUrl')).toBeNull()
    expect(storage.getItem('kakeibo.amountMask')).toBeNull()
    expect(storage.getItem('sb-abcdef-auth-token')).toBeNull()
    expect(storage.getItem('other-app.setting')).toBe('1')
  })
})

describe('cleanupAfterSignOut', () => {
  beforeEach(() => {
    // 未同期の判定は offlineQueue が localStorage から読む
    vi.unstubAllGlobals()
  })

  function stubQueue(ops: unknown[]): Storage {
    const storage = fakeStorage({ ...stored, 'kakeibo.pendingOps': JSON.stringify(ops) })
    vi.stubGlobal('localStorage', storage)
    return storage
  }

  it('未同期が残っているときは何も消さず、知らせるだけ', () => {
    const storage = stubQueue([{ opId: 'o1', kind: 'insert', id: 't1', queuedAt: '' }])
    const alert = vi.fn()
    const confirm = vi.fn(() => true)
    expect(cleanupAfterSignOut({ confirm, alert }, storage)).toBe('blocked')
    expect(alert).toHaveBeenCalledOnce()
    expect(confirm).not.toHaveBeenCalled()
    // この端末にしかない記録なので、1件も消さない
    expect(storage.getItem('kakeibo.pendingOps')).not.toBeNull()
    expect(storage.getItem('kakeibo.txCache')).toBe('[]')
  })

  it('確認でキャンセルすれば何も消さない', () => {
    const storage = stubQueue([])
    expect(cleanupAfterSignOut({ confirm: () => false, alert: () => {} }, storage)).toBe('kept')
    expect(storage.getItem('kakeibo.geminiApiKey')).toBe('AIza...')
  })

  it('確認して OK なら鍵とキャッシュを消す(接続設定は残す)', () => {
    const storage = stubQueue([])
    expect(cleanupAfterSignOut({ confirm: () => true, alert: () => {} }, storage)).toBe('cleared')
    expect(storage.getItem('kakeibo.geminiApiKey')).toBeNull()
    expect(storage.getItem('kakeibo.discordWebhook')).toBeNull()
    expect(storage.getItem('kakeibo.txCache')).toBeNull()
    expect(storage.getItem('kakeibo.supabaseUrl')).toBe('https://x.supabase.co')
  })
})

describe('ログアウトの意図', () => {
  it('意図を立てていなければ後始末しない(セッション期限切れのケース)', () => {
    // 立てずに取り出すと false。呼び出し側はこれで cleanupAfterSignOut を
    // 呼ばない = 何もしていないのに消去の確認が出ることがない
    expect(takeSignOutRequest()).toBe(false)
  })

  it('立てた意図は1回だけ取り出せる', () => {
    markSignOutRequested()
    expect(takeSignOutRequest()).toBe(true)
    // 2回目は倒れている(1回のログアウトで2回後始末しない)
    expect(takeSignOutRequest()).toBe(false)
  })
})
