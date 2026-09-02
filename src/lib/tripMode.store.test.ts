import { afterEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// 旅行モードの出し入れ。
//
// 保存先は 'kakeibo.tripMode' で、中身は
//   {"tag":"旅行","startedOn":"2026-03-27"}            … 行き先なし
//   {"tag":"旅行","place":"2026和歌山","startedOn":"…"} … 行き先あり
// という JSON。**行き先が無いときは place を書かない** —
// この機能より前の保存値とまったく同じ形になり、古い版のアプリでも読める
// (tripMode.ts の serializeTripMode のとおり)。
// 終わったときはキーごと消す。
// ============================================================

const KEY = 'kakeibo.tripMode'

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
  return await import('./tripMode')
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('保存された旅行モードの読み込み', () => {
  it('移行前に書かれた JSON(place 無し)をそのまま読む', async () => {
    installStorage().set(KEY, '{"tag":"旅行","startedOn":"2026-03-27"}')
    expect((await freshModule()).getTripMode()).toEqual({ tag: '旅行', startedOn: '2026-03-27' })
  })

  it('行き先つきの JSON も読める', async () => {
    installStorage().set(KEY, '{"tag":"旅行","place":"2026和歌山","startedOn":"2026-03-27"}')
    expect((await freshModule()).getTripMode()).toEqual({
      tag: '旅行',
      place: '2026和歌山',
      startedOn: '2026-03-27',
    })
  })

  it('キーが無ければオフ', async () => {
    installStorage()
    expect((await freshModule()).getTripMode()).toBeNull()
  })

  it('壊れた JSON・欠けた項目はオフに倒す(記録に変なタグを混ぜない)', async () => {
    installStorage().set(KEY, '{"tag":"旅行"}')
    expect((await freshModule()).getTripMode()).toBeNull()
  })

  it('localStorage が使えない環境でもオフで動く', async () => {
    Reflect.deleteProperty(globalThis, 'localStorage')
    expect((await freshModule()).getTripMode()).toBeNull()
  })
})

describe('開始と終了の保存', () => {
  it('行き先なしで始めると place を書かない(古い版でも読める形)', async () => {
    const map = installStorage()
    const m = await freshModule()
    expect(m.startTripMode('旅行')).toBe(true)
    const saved = JSON.parse(map.get(KEY) ?? '{}') as Record<string, unknown>
    expect(Object.keys(saved).sort()).toEqual(['startedOn', 'tag'])
    expect(saved.tag).toBe('旅行')
  })

  it('行き先を打つと place も入る', async () => {
    const map = installStorage()
    const m = await freshModule()
    m.startTripMode('#旅行', '2026和歌山')
    const saved = JSON.parse(map.get(KEY) ?? '{}') as Record<string, unknown>
    expect(saved.tag).toBe('旅行')
    expect(saved.place).toBe('2026和歌山')
  })

  it('タグにならない文字では始まらず、保存もしない', async () => {
    const map = installStorage()
    const m = await freshModule()
    expect(m.startTripMode('#')).toBe(false)
    expect(map.has(KEY)).toBe(false)
    expect(m.getTripMode()).toBeNull()
  })

  it('終えるとキーごと消える', async () => {
    const map = installStorage()
    const m = await freshModule()
    m.startTripMode('旅行')
    m.endTripMode()
    expect(map.has(KEY)).toBe(false)
    expect(m.getTripMode()).toBeNull()
  })

  it('保存できなくても、この起動中は旅行モードで動く', async () => {
    installStorage({ failWrites: true })
    const m = await freshModule()
    expect(m.startTripMode('旅行')).toBe(true)
    expect(m.getTripMode()?.tag).toBe('旅行')
  })
})
