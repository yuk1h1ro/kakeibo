import { describe, expect, it } from 'vitest'
import {
  isValidWebhookUrl,
  maskWebhookUrl,
  planWebhookSync,
  type RemoteWebhook,
} from './discordWebhook'

// 実物に近い形の URL。ID は 19桁、トークンは長い英数字
const URL_A = 'https://discord.com/api/webhooks/1234567890123456789/AbCdEfGhIjKlMnOpQrStUvWxYz-0123456789'
const URL_B = 'https://discord.com/api/webhooks/9876543210987654321/ZzZzZzZzZzZzZzZzZzZzZzZzZz-9876543210'

describe('isValidWebhookUrl', () => {
  it('Discord の Webhook URL だけを受け付ける', () => {
    expect(isValidWebhookUrl(URL_A)).toBe(true)
    expect(isValidWebhookUrl('https://discordapp.com/api/webhooks/1/x')).toBe(true)
  })

  it('似ているだけの URL は受け付けない(別の場所へ送ってしまうため)', () => {
    expect(isValidWebhookUrl('https://evil.example.com/api/webhooks/1/x')).toBe(false)
    expect(isValidWebhookUrl('http://discord.com/api/webhooks/1/x')).toBe(false)
    expect(isValidWebhookUrl('')).toBe(false)
  })
})

describe('maskWebhookUrl', () => {
  it('秘密のトークン部分は画面に出さない', () => {
    const masked = maskWebhookUrl(URL_A)
    expect(masked).not.toContain('AbCdEfGhIjKlMnOpQrStUvWxYz')
    // トークンの直前のスラッシュにも届かない = トークンは1文字も出ない
    expect(masked.slice('https://discord.com/api/webhooks/'.length)).not.toContain('/')
  })

  it('どのチャンネルを設定したか分かる程度には見せる(ホストと ID の先頭)', () => {
    const masked = maskWebhookUrl(URL_A)
    expect(masked.startsWith('https://discord.com/api/webhooks/1234567')).toBe(true)
    expect(masked.endsWith('…')).toBe(true)
  })

  it('40文字以下ならそのまま(伏せる中身が無い)', () => {
    expect(maskWebhookUrl('https://discord.com/api/webhooks/1')).toBe(
      'https://discord.com/api/webhooks/1'
    )
  })

  it('別のチャンネルを設定したことは、伏せたあとでも見分けられる', () => {
    // 設定し直したのに表示が同じだと、直ったのかどうか確かめようがない
    expect(maskWebhookUrl(URL_A)).not.toBe(maskWebhookUrl(URL_B))
  })
})

// ============================================================
// 端末のキャッシュとサーバーの突き合わせ。
// ここを間違えると「通知が復活する」「解除が効かない」「新しい設定が
// 古い設定で上書きされる」のいずれかが起きる
// ============================================================
const missing: RemoteWebhook = { kind: 'missing' }
const row = (url: string | null): RemoteWebhook => ({ kind: 'row', url })

describe('planWebhookSync — 既存端末の引き上げ', () => {
  it('サーバーに行が無く、この端末に URL があれば引き上げる(再入力させない)', () => {
    // これが今回の主目的。PCに設定済みの URL を、初回起動でサーバーへ移す
    expect(planWebhookSync(URL_A, missing)).toEqual({ action: 'push', url: URL_A })
  })

  it('どちらにも無ければ何もしない(空の行を作らない)', () => {
    expect(planWebhookSync(null, missing)).toEqual({ action: 'none' })
  })

  it('壊れた値は引き上げない(サーバーに置いても送れないため)', () => {
    expect(planWebhookSync('not-a-url', missing)).toEqual({ action: 'none' })
  })
})

describe('planWebhookSync — サーバーの値が端末に届く', () => {
  it('別の端末で設定された URL を取り込む(この端末は未設定だった)', () => {
    // スマホで設定 → PC を開くとここが効く
    expect(planWebhookSync(null, row(URL_B))).toEqual({ action: 'adopt', url: URL_B })
  })

  it('食い違ったらサーバーが勝つ(端末の古い写しで上書きしない)', () => {
    expect(planWebhookSync(URL_A, row(URL_B))).toEqual({ action: 'adopt', url: URL_B })
  })

  it('別の端末での「解除」もそのまま反映する', () => {
    // 行を消さず null を保存しているからこそ、解除を伝えられる。
    // 行ごと消していたら missing になり、この端末が古い URL を復活させてしまう
    expect(planWebhookSync(URL_A, row(null))).toEqual({ action: 'adopt', url: null })
  })

  it('一致していれば何もしない(無駄な書き込みをしない)', () => {
    expect(planWebhookSync(URL_A, row(URL_A))).toEqual({ action: 'none' })
    expect(planWebhookSync(null, row(null))).toEqual({ action: 'none' })
  })
})

describe('planWebhookSync — 何度実行しても同じ結果に収束する', () => {
  it('adopt / push を適用した状態でもう一度計画すると none になる', () => {
    const cases: { local: string | null; remote: RemoteWebhook }[] = [
      { local: URL_A, remote: missing },
      { local: null, remote: row(URL_B) },
      { local: URL_A, remote: row(URL_B) },
      { local: URL_A, remote: row(null) },
    ]
    for (const c of cases) {
      const plan = planWebhookSync(c.local, c.remote)
      // 計画どおりに端末とサーバーを揃えた「あとの」状態
      const local = plan.action === 'adopt' ? plan.url : c.local
      const remote: RemoteWebhook =
        plan.action === 'push' ? row(plan.url) : c.remote.kind === 'row' ? c.remote : missing
      expect(planWebhookSync(local, remote)).toEqual({ action: 'none' })
    }
  })
})
