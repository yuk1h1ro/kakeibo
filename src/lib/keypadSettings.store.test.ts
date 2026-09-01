import { afterEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// テンキーの設定の出し入れ(createLocalSetting に載せ替えても変わらないこと)。
//
// 保存先は 'kakeibo.keypadPreference' で、中身は 'auto' / 'on' / 'off' の
// **生の文字列**(JSON ではない)。すでに端末に入っている値がそのまま読めないと、
// PC で「常にテンキー」にした人の設定が黙って auto に戻る。
// ============================================================

const KEY = 'kakeibo.keypadPreference'

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
  return await import('./keypadSettings')
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('保存された設定の読み込み', () => {
  it('移行前に書かれた生の文字列をそのまま読む', async () => {
    installStorage().set(KEY, 'on')
    expect((await freshModule()).getKeypadPreference()).toBe('on')
  })

  it('off も同じ形で読める', async () => {
    installStorage().set(KEY, 'off')
    expect((await freshModule()).getKeypadPreference()).toBe('off')
  })

  it('未設定の既定は auto(端末の種類で決める)', async () => {
    installStorage()
    expect((await freshModule()).getKeypadPreference()).toBe('auto')
  })

  it('壊れた値・JSON で書かれた値は auto に倒す', async () => {
    installStorage().set(KEY, '"on"')
    expect((await freshModule()).getKeypadPreference()).toBe('auto')
  })

  it('localStorage が使えない環境でも auto で動く(起動を止めない)', async () => {
    Reflect.deleteProperty(globalThis, 'localStorage')
    expect((await freshModule()).getKeypadPreference()).toBe('auto')
  })
})

describe('設定の保存', () => {
  it('引用符を付けずに生の文字列で書く(古い版と同じ形)', async () => {
    const map = installStorage()
    const m = await freshModule()
    m.setKeypadPreference('off')
    expect(map.get(KEY)).toBe('off')
    expect(m.getKeypadPreference()).toBe('off')
  })

  it('保存できなくても、この起動中は選んだとおりに動く', async () => {
    installStorage({ failWrites: true })
    const m = await freshModule()
    expect(() => m.setKeypadPreference('on')).not.toThrow()
    expect(m.getKeypadPreference()).toBe('on')
  })
})
