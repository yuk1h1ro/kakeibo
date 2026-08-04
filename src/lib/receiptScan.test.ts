import { describe, expect, it } from 'vitest'
import { buildTestFailureMessage, httpErrorMessage } from './receiptScan'

// レシート読み取り (Gemini) のエラー文言 (機能161)。
// ここで見ているのは「原因が分かるか」と「次に何をすればいいか書いてあるか」。
// 原因ごとに対処が違うもの (429) を1つに丸めていないことも確かめる。

/** 次の行動が書かれているか(手を動かす先が名指しされているか) */
function hasNextAction(message: string): boolean {
  return /してください|お試しください|待って/.test(message)
}

describe('httpErrorMessage', () => {
  it('どのステータスでも、次の行動が書かれている', () => {
    for (const status of [400, 401, 403, 404, 429, 500, 418]) {
      const m = httpErrorMessage(status, null)
      expect(hasNextAction(m), `HTTP ${status}: ${m}`).toBe(true)
    }
  })

  it('キーが疑わしいときは、切り分け方と作り直す場所を出す', () => {
    const m = httpErrorMessage(401, null)
    expect(m).toContain('接続テスト')
    expect(m).toContain('aistudio.google.com/apikey')
    // 原因を1つに断定しない(打ち間違い / API未有効 / キーの制限)
    expect(m).toContain('可能性')
  })

  it('モデルが見つからないときは、自動で選び直すことを伝える', () => {
    const m = httpErrorMessage(404, null)
    expect(m).toContain('自動で選び直します')
  })

  it('分からないステータスでは原因を作らない', () => {
    const m = httpErrorMessage(418, null)
    expect(m).toContain('特定できませんでした')
  })

  it('429 は原因ごとに違う対処を出す(待つ / 日を跨ぐ / 課金設定)', () => {
    const perMinute = httpErrorMessage(429, 'Quota exceeded per minute')
    const perDay = httpErrorMessage(429, 'Quota exceeded: GenerateRequestsPerDayPerProject')
    const credits = httpErrorMessage(429, 'You have exhausted your prepayment credits')
    expect(perMinute).toContain('1分')
    expect(perDay).toContain('日付が変わってから')
    expect(credits).toContain('課金')
    expect(new Set([perMinute, perDay, credits]).size).toBe(3)
  })

  it('Google が返した原文は必ず併記する(切り分けの手がかりを捨てない)', () => {
    expect(httpErrorMessage(400, 'API key not valid')).toContain('詳細: API key not valid')
  })
})

describe('buildTestFailureMessage', () => {
  it('キーが違う / APIが未有効 / キーの制限 を書き分ける', () => {
    const invalid = buildTestFailureMessage(400, 'API key not valid. Please pass a valid API key.')
    const disabled = buildTestFailureMessage(403, 'SERVICE_DISABLED')
    const restricted = buildTestFailureMessage(403, 'Requests from referer are blocked')
    expect(invalid).toContain('aistudio.google.com/apikey')
    expect(disabled).toContain('有効化')
    expect(restricted).toContain('制限')
    expect(new Set([invalid, disabled, restricted]).size).toBe(3)
  })

  it('どの分岐でも次の行動がある', () => {
    for (const [status, detail] of [
      [400, 'API key not valid'],
      [403, 'SERVICE_DISABLED'],
      [403, null],
      [429, 'per minute'],
      [500, null],
    ] as [number, string | null][]) {
      const m = buildTestFailureMessage(status, detail)
      expect(hasNextAction(m), `HTTP ${status}: ${m}`).toBe(true)
    }
  })
})
