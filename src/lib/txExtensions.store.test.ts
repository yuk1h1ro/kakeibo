import { afterEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// 「後から足した列がこの環境にあるか」の覚え書きの出し入れ。
//
// 保存先は 'kakeibo.txExtensions' で、中身は
//   {"settlement":true,"tagging":true,"favor":false}
// という **3項目の JSON**。オフライン起動でも前回の答えを使うためのもので、
// ここが読めなくなると「圏外でうっかり新機能を使い、あとでサーバーに弾かれる」
// 窓がまた開く。
//
// 既定は3つとも **使える** 側。使えないと決めつけると、通信できないときに
// 機能が消えてしまうため(txExtensions.ts の冒頭のとおり)。
// ============================================================

const KEY = 'kakeibo.txExtensions'

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
  return await import('./txExtensions')
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('覚え書きの読み込み', () => {
  it('移行前に書かれた3項目の JSON をそのまま読む', async () => {
    installStorage().set(KEY, '{"settlement":true,"tagging":true,"favor":false}')
    const m = await freshModule()
    expect(m.isTxFeatureAvailable('settlement')).toBe(true)
    expect(m.isTxFeatureAvailable('tagging')).toBe(true)
    expect(m.isTxFeatureAvailable('favor')).toBe(false)
  })

  it('キーが無ければ3つとも「使える」(通信できないときに機能を消さない)', async () => {
    installStorage()
    const m = await freshModule()
    expect(m.isTxFeatureAvailable('settlement')).toBe(true)
    expect(m.isTxFeatureAvailable('tagging')).toBe(true)
    expect(m.isTxFeatureAvailable('favor')).toBe(true)
  })

  it('項目が欠けている保存値では、欠けた分だけ既定(使える)に戻る', async () => {
    installStorage().set(KEY, '{"tagging":false}')
    const m = await freshModule()
    expect(m.isTxFeatureAvailable('tagging')).toBe(false)
    expect(m.isTxFeatureAvailable('settlement')).toBe(true)
    expect(m.isTxFeatureAvailable('favor')).toBe(true)
  })

  it('壊れたキャッシュは無視して既定で動く(機能が消える側に倒さない)', async () => {
    const map = installStorage()
    map.set(KEY, 'これはJSONではない')
    expect((await freshModule()).isTxFeatureAvailable('favor')).toBe(true)
    map.set(KEY, '"favor"')
    expect((await freshModule()).isTxFeatureAvailable('favor')).toBe(true)
    map.set(KEY, '{"favor":"no"}')
    expect((await freshModule()).isTxFeatureAvailable('favor')).toBe(true)
  })

  it('localStorage が使えない環境でも3つとも使える側で動く', async () => {
    Reflect.deleteProperty(globalThis, 'localStorage')
    expect((await freshModule()).isTxFeatureAvailable('settlement')).toBe(true)
  })
})

describe('「無い」と分かったときの保存', () => {
  it('3項目そろった JSON で書く(古い版と同じ形)', async () => {
    const map = installStorage()
    const m = await freshModule()
    m.markTxFeatureUnavailable('favor')
    expect(JSON.parse(map.get(KEY) ?? '{}')).toEqual({
      settlement: true,
      tagging: true,
      favor: false,
    })
  })

  it('次の起動でも「無い」を覚えている(オフライン起動でも効く)', async () => {
    installStorage()
    const first = await freshModule()
    first.markTxFeatureUnavailable('tagging')
    const second = await freshModule()
    expect(second.isTxFeatureAvailable('tagging')).toBe(false)
  })

  it('「無い」と分かった列は送信内容からキーごと落ちる', async () => {
    installStorage()
    const m = await freshModule()
    m.markTxFeatureUnavailable('favor')
    const out = m.stripUnavailableColumns({
      type: 'expense' as const,
      partner_paid: 0,
      favor_amount: 500,
      favor_kind: 'treat',
      favor_from: '同僚',
    })
    expect('favor_amount' in out).toBe(false)
    expect('favor_kind' in out).toBe(false)
    expect('favor_from' in out).toBe(false)
    expect(out.partner_paid).toBe(0) // 無いと分かっていない列は残る
  })

  it('保存できなくても、この起動中は正しく動く', async () => {
    installStorage({ failWrites: true })
    const m = await freshModule()
    expect(() => m.markTxFeatureUnavailable('settlement')).not.toThrow()
    expect(m.isTxFeatureAvailable('settlement')).toBe(false)
  })
})
