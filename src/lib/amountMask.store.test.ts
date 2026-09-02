import { afterEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// 金額の目隠し(機能169)の出し入れ。
//
// 保存先は 'kakeibo.amountMask' で、中身は 'on' / 'off' の **生の文字列**。
// 既定は **オフ(表示)** —「金額を隠す」機能なのに既定を隠す側にしない理由は
// amountMask.ts の parseMasked の上に書いてある。
// アプリ切替時の目隠し(機能208・privacyBlur)は同じ 'on' / 'off' を使いながら
// **既定がオン** で、意味も逆。入れ物を共通にしてもここが逆のままであることを、
// 下の「既定」の節で両方いっぺんに固定している。
// ============================================================

const KEY = 'kakeibo.amountMask'
const BLUR_KEY = 'kakeibo.privacyBlur'

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
  return await import('./amountMask')
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('保存された状態の読み込み', () => {
  it('移行前に書かれた on をそのまま読む(人前でリロードしても伏せたまま)', async () => {
    installStorage().set(KEY, 'on')
    expect((await freshModule()).isAmountMasked()).toBe(true)
  })

  it('off が入っていれば表示', async () => {
    installStorage().set(KEY, 'off')
    expect((await freshModule()).isAmountMasked()).toBe(false)
  })

  it('壊れた値・JSON で書かれた値は表示側に倒す', async () => {
    installStorage().set(KEY, '"on"')
    expect((await freshModule()).isAmountMasked()).toBe(false)
  })

  it('localStorage が使えない環境でも表示で動く(起動を止めない)', async () => {
    Reflect.deleteProperty(globalThis, 'localStorage')
    expect((await freshModule()).isAmountMasked()).toBe(false)
  })
})

describe('既定(機能208 と逆であること)', () => {
  it('何も保存されていなければ金額は表示される(機能169 は既定オフ)', async () => {
    installStorage()
    expect((await freshModule()).isAmountMasked()).toBe(false)
  })

  it('同じ状況でアプリ切替時の目隠し(機能208)は既定オン', async () => {
    installStorage()
    vi.resetModules()
    const blur = await import('./privacyBlur')
    const shield = await import('./privacyShield')
    // 保存値が無い状態での既定。ここが逆のままであることが、
    // 2つを1つに統合してはいけない理由そのもの
    expect(blur.parseEnabled(null)).toBe(true)
    expect(shield.getPrivacyBlurEnabled()).toBe(true)
  })

  it('機能208 を off にしても、金額の目隠し(機能169)は別のキーなので影響されない', async () => {
    const map = installStorage()
    map.set(BLUR_KEY, 'off')
    const m = await freshModule()
    m.setAmountMasked(true)
    expect(map.get(KEY)).toBe('on')
    expect(map.get(BLUR_KEY)).toBe('off')
  })
})

describe('切り替えの保存', () => {
  it('on / off の生の文字列で書く(古い版と同じ形)', async () => {
    const map = installStorage()
    const m = await freshModule()
    m.setAmountMasked(true)
    expect(map.get(KEY)).toBe('on')
    m.setAmountMasked(false)
    expect(map.get(KEY)).toBe('off')
  })

  it('toggleAmountMask は今の状態を反転する', async () => {
    const map = installStorage()
    const m = await freshModule()
    m.toggleAmountMask()
    expect(m.isAmountMasked()).toBe(true)
    expect(map.get(KEY)).toBe('on')
    m.toggleAmountMask()
    expect(m.isAmountMasked()).toBe(false)
  })

  it('同じ値を入れ直したときは保存もしない(押されていないのに描き直さない)', async () => {
    const map = installStorage()
    const m = await freshModule()
    m.setAmountMasked(false)
    expect(map.has(KEY)).toBe(false)
  })

  it('保存できなくても、この起動中は伏字にできる', async () => {
    installStorage({ failWrites: true })
    const m = await freshModule()
    expect(() => m.setAmountMasked(true)).not.toThrow()
    expect(m.isAmountMasked()).toBe(true)
  })
})
