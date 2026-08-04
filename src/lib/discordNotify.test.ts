import { describe, expect, it } from 'vitest'
import { classifyDiscordStatus, discordFailureMessage } from './discordNotify'

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
