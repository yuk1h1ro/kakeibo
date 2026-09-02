import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseBudget } from './monthlyBudget'

// ============================================================
// 月の予算(機能026 の参照線の基準)の出し入れ。
//
// 保存先は 'kakeibo.monthlyBudget' で、中身は '30000' のような **十進数の文字列**
// (JSON でも円記号付きでもない)。
// **未設定はキーごと消す** のが肝心 — '0' を書いて残すと、次に読んだときに
// 「予算 0円」と区別が付かず、1円でも使えば使いすぎという参照線になってしまう。
// ============================================================

const KEY = 'kakeibo.monthlyBudget'

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
        if (options.failWrites) throw new Error('QuotaExceededError')
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
  return await import('./monthlyBudget')
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('parseBudget', () => {
  it('未設定・空・0以下・小数は null(= 予算なし)', () => {
    expect(parseBudget(null)).toBeNull()
    expect(parseBudget(undefined)).toBeNull()
    expect(parseBudget('')).toBeNull()
    expect(parseBudget('0')).toBeNull()
    expect(parseBudget('-100')).toBeNull()
    expect(parseBudget('1000.5')).toBeNull()
    expect(parseBudget('三万')).toBeNull()
  })

  it('正の整数だけを予算として読む', () => {
    expect(parseBudget('30000')).toBe(30000)
    expect(parseBudget(' 30000 ')).toBe(30000)
  })
})

describe('保存された予算の読み込み', () => {
  it('移行前に書かれた十進数の文字列をそのまま読む', async () => {
    installStorage().set(KEY, '80000')
    expect((await freshModule()).getMonthlyBudget()).toBe(80000)
  })

  it('キーが無ければ未設定(過去平均から参照線を引く状態)', async () => {
    installStorage()
    expect((await freshModule()).getMonthlyBudget()).toBeNull()
  })

  it('壊れた値は未設定に倒す', async () => {
    installStorage().set(KEY, '{"amount":30000}')
    expect((await freshModule()).getMonthlyBudget()).toBeNull()
  })

  it('localStorage が使えない環境でも未設定として動く', async () => {
    Reflect.deleteProperty(globalThis, 'localStorage')
    expect((await freshModule()).getMonthlyBudget()).toBeNull()
  })
})

describe('予算の保存', () => {
  it('十進数の文字列で書く(古い版と同じ形)', async () => {
    const map = installStorage()
    const m = await freshModule()
    m.setMonthlyBudget(50000)
    expect(map.get(KEY)).toBe('50000')
    expect(m.getMonthlyBudget()).toBe(50000)
  })

  it('null を渡すとキーごと消える(「0」を書き残さない)', async () => {
    const map = installStorage()
    map.set(KEY, '50000')
    const m = await freshModule()
    m.setMonthlyBudget(null)
    expect(map.has(KEY)).toBe(false)
    expect(m.getMonthlyBudget()).toBeNull()
  })

  it('保存できなくても、この起動中は設定した予算で動く', async () => {
    installStorage({ failWrites: true })
    const m = await freshModule()
    expect(() => m.setMonthlyBudget(50000)).not.toThrow()
    expect(m.getMonthlyBudget()).toBe(50000)
  })
})
