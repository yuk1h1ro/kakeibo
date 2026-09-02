import { afterEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// 「この提案はいらない」の記憶の出し入れ。
//
// 保存先は 'kakeibo.recurringSuggestDismissed' で、中身は鍵の **JSON 文字列配列**。
// ここが読めなくなると、いちど消した提案がまた出てくる(実害は小さいが、
// 「消したのに戻る」は信用を落とす)。逆に壊れた値で消えたままになるのも困るので、
// 読めない値は「何も消していない」に倒す。
// ============================================================

const KEY = 'kakeibo.recurringSuggestDismissed'

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
  return await import('./recurringInsights')
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('消した提案の読み込み', () => {
  it('移行前に書かれた JSON 配列をそのまま読む', async () => {
    installStorage().set(KEY, '["家賃|月次","電気代|月次"]')
    expect((await freshModule()).getDismissedSuggestions()).toEqual(['家賃|月次', '電気代|月次'])
  })

  it('キーが無ければ何も消していない', async () => {
    installStorage()
    expect((await freshModule()).getDismissedSuggestions()).toEqual([])
  })

  it('壊れた JSON・配列でない値は「何も消していない」に倒す', async () => {
    const map = installStorage()
    map.set(KEY, '{"家賃":true}')
    expect((await freshModule()).getDismissedSuggestions()).toEqual([])
    map.set(KEY, 'これはJSONではない')
    expect((await freshModule()).getDismissedSuggestions()).toEqual([])
  })

  it('文字列でない要素だけを落とす', async () => {
    installStorage().set(KEY, '["家賃|月次",42,null]')
    expect((await freshModule()).getDismissedSuggestions()).toEqual(['家賃|月次'])
  })

  it('localStorage が使えない環境でも動く', async () => {
    Reflect.deleteProperty(globalThis, 'localStorage')
    expect((await freshModule()).getDismissedSuggestions()).toEqual([])
  })
})

describe('消す・戻す', () => {
  it('JSON 配列で書き、消した順に後ろへ積む', async () => {
    const map = installStorage()
    const m = await freshModule()
    m.dismissSuggestion('家賃|月次')
    m.dismissSuggestion('電気代|月次')
    expect(map.get(KEY)).toBe('["家賃|月次","電気代|月次"]')
  })

  it('同じ鍵を二度消しても増えない', async () => {
    installStorage()
    const m = await freshModule()
    m.dismissSuggestion('家賃|月次')
    m.dismissSuggestion('家賃|月次')
    expect(m.getDismissedSuggestions()).toEqual(['家賃|月次'])
  })

  it('すべて元に戻すとキーごと消える', async () => {
    const map = installStorage()
    const m = await freshModule()
    m.dismissSuggestion('家賃|月次')
    m.clearDismissedSuggestions()
    expect(map.has(KEY)).toBe(false)
    expect(m.getDismissedSuggestions()).toEqual([])
  })

  it('保存できなくても、この起動中は消えたままになる', async () => {
    installStorage({ failWrites: true })
    const m = await freshModule()
    expect(() => m.dismissSuggestion('家賃|月次')).not.toThrow()
    expect(m.getDismissedSuggestions()).toEqual(['家賃|月次'])
  })
})
