import { afterEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// 旅行のまとめ送信の控えの出し入れ。
//
// 保存先は 'kakeibo.tripSummarySends' で、中身は控えの **JSON 配列**
// (新しいものが先頭)。ここが読めなくなると
// 「もう送った旅行」の印が消え、二度送りに気づけなくなる。
// ============================================================

const KEY = 'kakeibo.tripSummarySends'

function installStorage(options: { failWrites?: boolean } = {}): Map<string, string> {
  const map = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (options.failWrites) throw new Error('QuotaExceededError')
        map.set(k, v)
      },
      removeItem: (k: string) => {
        map.delete(k)
      },
    },
    configurable: true,
    writable: true,
  })
  return map
}

/** 保存値は読み込み時に1回だけ読まれるので、毎回モジュールごと読み直す */
async function freshModule() {
  vi.resetModules()
  return await import('./tripSummarySends')
}

const record = {
  key: '旅行|2026-03-01|2026-03-03',
  sentAt: '2026-03-03T12:00:00.000Z',
  entries: 12,
  messages: 2,
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('保存された控えの読み込み', () => {
  it('移行前に書かれた JSON 配列をそのまま読む', async () => {
    installStorage().set(KEY, JSON.stringify([record]))
    expect((await freshModule()).getTripSends()).toEqual([record])
  })

  it('キーが無ければ控えなし', async () => {
    installStorage()
    expect((await freshModule()).getTripSends()).toEqual([])
  })

  it('壊れた JSON は控えなし扱い(送信そのものは止めない)', async () => {
    installStorage().set(KEY, 'これはJSONではない')
    expect((await freshModule()).getTripSends()).toEqual([])
  })

  it('項目の欠けた控えは読み飛ばす', async () => {
    installStorage().set(KEY, JSON.stringify([{ key: '旅行' }, record]))
    expect((await freshModule()).getTripSends()).toEqual([record])
  })

  it('localStorage が使えない環境でも控えなしで動く', async () => {
    Reflect.deleteProperty(globalThis, 'localStorage')
    expect((await freshModule()).getTripSends()).toEqual([])
  })
})

describe('控えの保存', () => {
  it('JSON 配列で書き、新しいものが先頭に来る', async () => {
    const map = installStorage()
    const m = await freshModule()
    m.rememberTripSend(record)
    m.rememberTripSend({ ...record, key: '出張|2026-04-01|2026-04-02' })
    const saved = JSON.parse(map.get(KEY) ?? '[]') as { key: string }[]
    expect(saved.map((r) => r.key)).toEqual(['出張|2026-04-01|2026-04-02', record.key])
  })

  it('同じ旅行を送り直すと1件に上書きされる', async () => {
    installStorage()
    const m = await freshModule()
    m.rememberTripSend(record)
    m.rememberTripSend({ ...record, entries: 20 })
    expect(m.getTripSends()).toHaveLength(1)
    expect(m.getTripSends()[0].entries).toBe(20)
  })

  it('resetTripSendsForTest はキーごと消す', async () => {
    const map = installStorage()
    const m = await freshModule()
    m.rememberTripSend(record)
    m.resetTripSendsForTest()
    expect(map.has(KEY)).toBe(false)
    expect(m.getTripSends()).toEqual([])
  })

  it('保存できなくても、この起動中は控えが画面に出る', async () => {
    installStorage({ failWrites: true })
    const m = await freshModule()
    expect(() => m.rememberTripSend(record)).not.toThrow()
    expect(m.getTripSends()).toEqual([record])
  })
})
