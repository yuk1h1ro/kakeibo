import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalSetting } from './localSetting'

// ============================================================
// 端末ごとの設定の入れ物。
//
// ここが壊れると、**既存の端末に入っている設定が黙って初期値に戻る**。
// テンキーの設定も、金額の目隠しも、月の予算も、
// 「前に使ったときの状態で開く」ことがそのまま信用になっている機能なので、
// キーと直列化の形は寄せる前と1バイトも変えていない。
// それを固定するために、**移行前の版が書いた文字列を localStorage に直に置いてから**
// 読めることを確かめる。
//
// node には localStorage が無いので最小の代役を差し込む
// (recurringLedger.test.ts と同じやり方)。
// ============================================================

function installStorage(options: { failReads?: boolean; failWrites?: boolean } = {}) {
  const map = new Map<string, string>()
  const storage = {
    getItem: (k: string) => {
      if (options.failReads) throw new Error('SecurityError')
      return map.get(k) ?? null
    },
    setItem: (k: string, v: string) => {
      if (options.failWrites) throw new Error('QuotaExceededError')
      map.set(k, v)
    },
    removeItem: (k: string) => {
      if (options.failWrites) throw new Error('QuotaExceededError')
      map.delete(k)
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  })
  return map
}

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(globalThis, 'localStorage')
})

/** 文字列そのままの設定(テンキー・金額の目隠しと同じ形) */
function textSetting(fallback: string) {
  return createLocalSetting<string>({
    key: 'kakeibo.test.text',
    fallback,
    parse: (raw) => (raw === 'on' || raw === 'off' ? raw : null),
    serialize: (v) => v,
  })
}

describe('保存値の読み込み', () => {
  it('移行前に書かれた生の文字列をそのまま読む', () => {
    installStorage().set('kakeibo.test.text', 'on')
    expect(textSetting('off').get()).toBe('on')
  })

  it('キーが無いときは既定', () => {
    installStorage()
    expect(textSetting('off').get()).toBe('off')
  })

  it('読めない値は既定に倒す(壊れた保存値で画面を壊さない)', () => {
    installStorage().set('kakeibo.test.text', 'yes')
    expect(textSetting('off').get()).toBe('off')
  })

  it('parse が例外を投げても(壊れた JSON など)既定で動く', () => {
    installStorage().set('kakeibo.test.json', 'これはJSONではない')
    const store = createLocalSetting<string[]>({
      key: 'kakeibo.test.json',
      fallback: [],
      parse: (raw) => (raw === null ? null : (JSON.parse(raw) as string[])),
      serialize: (v) => JSON.stringify(v),
    })
    expect(store.get()).toEqual([])
  })

  it('読み込みは作った時点の1回だけ(あとから localStorage を書き換えても追わない)', () => {
    const map = installStorage()
    map.set('kakeibo.test.text', 'on')
    const store = textSetting('off')
    map.set('kakeibo.test.text', 'off')
    expect(store.get()).toBe('on')
  })
})

describe('既定値は呼ぶ側が決める', () => {
  // 金額の目隠し(機能169・既定オフ)とアプリ切替時の目隠し(機能208・既定オン)は
  // 「金額を隠す」に見えて意味が逆。入れ物を共通にしても、既定は潰さない。
  it('同じ入れ物で、既定オフと既定オンの両方が作れる', () => {
    installStorage()
    expect(textSetting('off').get()).toBe('off')
    expect(textSetting('on').get()).toBe('on')
  })
})

describe('保存', () => {
  it('set は直列化した文字列を書く', () => {
    const map = installStorage()
    textSetting('off').set('on')
    expect(map.get('kakeibo.test.text')).toBe('on')
  })

  it('serialize が null を返す値はキーごと消す(未設定に戻す)', () => {
    const map = installStorage()
    map.set('kakeibo.test.num', '3000')
    const store = createLocalSetting<number | null>({
      key: 'kakeibo.test.num',
      fallback: null,
      parse: (raw) => (raw === null ? null : Number(raw)),
      serialize: (v) => (v === null ? null : String(v)),
    })
    expect(store.get()).toBe(3000)
    store.set(null)
    expect(map.has('kakeibo.test.num')).toBe(false)
    expect(store.get()).toBeNull()
  })

  it('clear は既定に戻し、保存値も消す', () => {
    const map = installStorage()
    map.set('kakeibo.test.text', 'on')
    const store = textSetting('off')
    store.clear()
    expect(store.get()).toBe('off')
    expect(map.has('kakeibo.test.text')).toBe(false)
  })

  it('get は set まで同じ参照を返す(スナップショットが安定する)', () => {
    installStorage()
    const store = createLocalSetting<string[]>({
      key: 'kakeibo.test.json',
      fallback: [],
      parse: () => null,
      serialize: (v) => JSON.stringify(v),
    })
    expect(store.get()).toBe(store.get())
    const next = ['旅行']
    store.set(next)
    expect(store.get()).toBe(next)
  })
})

describe('localStorage が使えない環境', () => {
  it('読めなくても既定で動く(起動を止めない)', () => {
    installStorage({ failReads: true })
    expect(() => textSetting('off').get()).not.toThrow()
    expect(textSetting('off').get()).toBe('off')
  })

  it('書けなくても例外を出さず、この起動中は設定したとおりに動く', () => {
    installStorage({ failWrites: true })
    const store = textSetting('off')
    expect(() => store.set('on')).not.toThrow()
    expect(store.get()).toBe('on')
  })

  it('localStorage そのものが無い環境でも作れる', () => {
    Reflect.deleteProperty(globalThis, 'localStorage')
    const store = textSetting('off')
    expect(store.get()).toBe('off')
    expect(() => store.set('on')).not.toThrow()
    expect(store.get()).toBe('on')
  })
})

describe('購読', () => {
  it('set のたびに購読者へ知らせる', () => {
    installStorage()
    const store = textSetting('off')
    const seen: string[] = []
    store.subscribe(() => seen.push(store.get()))
    store.set('on')
    store.set('off')
    expect(seen).toEqual(['on', 'off'])
  })

  it('同じ値を入れ直したときも知らせる(寄せる前の挙動のまま)', () => {
    installStorage()
    const store = textSetting('off')
    let calls = 0
    store.subscribe(() => calls++)
    store.set('on')
    store.set('on')
    expect(calls).toBe(2)
  })

  it('clear も知らせる', () => {
    installStorage()
    const store = textSetting('off')
    let calls = 0
    store.subscribe(() => calls++)
    store.clear()
    expect(calls).toBe(1)
  })

  it('返された関数を呼ぶと購読が外れる', () => {
    installStorage()
    const store = textSetting('off')
    let calls = 0
    const unsubscribe = store.subscribe(() => calls++)
    store.set('on')
    unsubscribe()
    store.set('off')
    expect(calls).toBe(1)
  })

  it('保存できない環境でも購読者には知らせる(画面は切り替わる)', () => {
    installStorage({ failWrites: true })
    const store = textSetting('off')
    let calls = 0
    store.subscribe(() => calls++)
    store.set('on')
    expect(calls).toBe(1)
  })
})
