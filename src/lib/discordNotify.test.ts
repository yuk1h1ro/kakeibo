import { describe, expect, it } from 'vitest'
import {
  addSplitPart,
  classifyDiscordStatus,
  discordFailureMessage,
  formatSplitNotification,
  splitGroupOfOp,
} from './discordNotify'

describe('classifyDiscordStatus', () => {
  it('401 / 403 / 404 は Webhook が無効になった側の失敗', () => {
    // チャンネルを削除・作り直すと、それまでの Webhook URL は 404 になる
    for (const status of [401, 403, 404]) {
      expect(classifyDiscordStatus(status)).toEqual({ kind: 'webhook', status })
    }
  })

  it('混雑や一時的な不調は Webhook のせいにしない', () => {
    // 429(送りすぎ)や 5xx は待てば直る。URL を入れ直させるのは筋違い
    expect(classifyDiscordStatus(429).kind).toBe('http')
    expect(classifyDiscordStatus(500).kind).toBe('http')
  })
})

describe('discordFailureMessage', () => {
  it('Webhook が無効なときは、URL の取り直し方を手順で書く', () => {
    const m = discordFailureMessage({ kind: 'webhook', status: 404 })
    expect(m).toContain('Webhook URL が古い')
    expect(m).toContain('チャンネル設定')
    expect(m).toContain('ウェブフック')
  })

  it('届いていないときは、通信の確認を促す(URL のせいにしない)', () => {
    const m = discordFailureMessage({ kind: 'network' })
    expect(m).toContain('通信')
    expect(m).not.toContain('Webhook URL が古い')
  })

  it('その他の失敗は、ステータスを添えて再試行を促す', () => {
    const m = discordFailureMessage({ kind: 'http', status: 429 })
    expect(m).toContain('429')
    expect(m).toContain('もう一度')
  })

  it('どの失敗でも、次にやることが必ず書いてある', () => {
    const all = [
      { kind: 'network' } as const,
      { kind: 'webhook', status: 404 } as const,
      { kind: 'http', status: 500 } as const,
    ]
    for (const f of all) {
      expect(discordFailureMessage(f)).toMatch(/ください/)
    }
  })
})

describe('分割の会計の通知(純粋関数)', () => {
  const part = (id: string, over: Record<string, unknown> = {}) => ({
    kind: 'insert' as const,
    id,
    payload: {
      type: 'expense' as const,
      amount: 1000,
      partner_amount: 300,
      partner_paid: 0,
      category: 'food',
      memo: '',
      store: 'お店',
      split_group: 'g1',
      ...over,
    },
  })

  it('束ねを持つ追加だけが内訳。修正・削除・束ね無しは対象外', () => {
    expect(splitGroupOfOp(part('a'))).toBe('g1')
    expect(splitGroupOfOp({ ...part('a'), kind: 'update' })).toBeNull()
    expect(splitGroupOfOp({ kind: 'delete', id: 'a' })).toBeNull()
    expect(splitGroupOfOp(part('a', { split_group: null }))).toBeNull()
    expect(splitGroupOfOp(part('a', { split_group: '' }))).toBeNull()
  })

  it('内訳ではない op を足しても、まとめている会計は変わらない', () => {
    const acc = addSplitPart(null, part('a'), 100)
    expect(addSplitPart(acc, { kind: 'delete', id: 'x' }, 50)).toBe(acc)
  })

  it('残高は最後に足した内訳のあとの値。負担の無い内訳も行IDは控える', () => {
    let acc = addSplitPart(null, part('a'), 700)
    acc = addSplitPart(acc, part('b', { partner_amount: 0 }), 700)
    expect(acc?.parts).toHaveLength(1)
    expect(acc?.ids).toEqual(['a', 'b'])
    expect(acc?.balance).toBe(700)
  })

  it('効く内訳が無ければ通知しない', () => {
    const acc = addSplitPart(null, part('a', { partner_amount: 0 }), 0)
    expect(formatSplitNotification(acc!)).toBeNull()
  })

  it('お店もメモも無いときは「分けた会計」と書く', () => {
    let acc = addSplitPart(null, part('a', { store: '' }), 0)
    acc = addSplitPart(acc, part('b', { store: '', category: 'daily' }), 0)
    expect(formatSplitNotification(acc!)?.split('\n')[0]).toBe('🍽️ 分けた会計 −¥600(2つに分けた会計)')
  })
})
