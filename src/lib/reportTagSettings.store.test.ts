import { afterEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// 「非日常」とみなすタグの選択の出し入れ。
//
// 保存先は 'kakeibo.specialTags' で、中身は ["旅行","デート"] の **JSON 配列**。
// 保存値は3つの状態を区別する(reportTagSettings.ts の冒頭のとおり):
//   キーが無い     … まだ触っていない → 既定の3つ
//   [] が入っている … 自分で全部外した → 空のまま(既定を復活させない)
//   タグが入っている … その選択
// **空配列を既定に戻してしまうと「外したのに次に開くと戻っている」になる**ので、
// ここは載せ替えでいちばん壊しやすい箇所として先に固定しておく。
// ============================================================

const KEY = 'kakeibo.specialTags'

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
  return await import('./reportTagSettings')
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('保存された選択の読み込み', () => {
  it('移行前に書かれた JSON 配列をそのまま読む', async () => {
    installStorage().set(KEY, '["旅行","帰省"]')
    expect((await freshModule()).getSpecialTags()).toEqual(['旅行', '帰省'])
  })

  it('キーが無ければ既定の3つ', async () => {
    installStorage()
    expect((await freshModule()).getSpecialTags()).toEqual(['旅行', 'デート', '出張'])
  })

  it('空配列は「自分で全部外した」なので空のまま(既定を復活させない)', async () => {
    installStorage().set(KEY, '[]')
    expect((await freshModule()).getSpecialTags()).toEqual([])
  })

  it('壊れた JSON は既定の3つ', async () => {
    installStorage().set(KEY, 'これはJSONではない')
    expect((await freshModule()).getSpecialTags()).toEqual(['旅行', 'デート', '出張'])
  })

  it('localStorage が使えない環境でも既定の3つで動く', async () => {
    Reflect.deleteProperty(globalThis, 'localStorage')
    expect((await freshModule()).getSpecialTags()).toEqual(['旅行', 'デート', '出張'])
  })
})

describe('選択の保存', () => {
  it('JSON 配列で書く(古い版と同じ形)', async () => {
    const map = installStorage()
    const m = await freshModule()
    m.setSpecialTags(['旅行', '冠婚葬祭'])
    expect(map.get(KEY)).toBe('["旅行","冠婚葬祭"]')
  })

  it('保存時も入力欄と同じ正規化を通す(「#旅行」と「旅行」は同じ)', async () => {
    const map = installStorage()
    const m = await freshModule()
    m.setSpecialTags(['#旅行', '旅行', ''])
    expect(m.getSpecialTags()).toEqual(['旅行'])
    expect(map.get(KEY)).toBe('["旅行"]')
  })

  it('全部外したときは [] が保存される(キーは消さない)', async () => {
    const map = installStorage()
    const m = await freshModule()
    m.setSpecialTags([])
    expect(map.get(KEY)).toBe('[]')
  })

  it('チップのタップは今の選択を出し入れする', async () => {
    installStorage()
    const m = await freshModule()
    m.toggleSpecialTag('デート')
    expect(m.getSpecialTags()).toEqual(['旅行', '出張'])
    m.toggleSpecialTag('デート')
    expect(m.getSpecialTags()).toEqual(['旅行', '出張', 'デート'])
  })

  it('スナップショットは set まで同じ参照(再描画が止まらなくならない)', async () => {
    installStorage()
    const m = await freshModule()
    expect(m.getSpecialTags()).toBe(m.getSpecialTags())
  })

  it('保存できなくても、この起動中は選んだとおりに見える', async () => {
    installStorage({ failWrites: true })
    const m = await freshModule()
    expect(() => m.setSpecialTags(['帰省'])).not.toThrow()
    expect(m.getSpecialTags()).toEqual(['帰省'])
  })
})
