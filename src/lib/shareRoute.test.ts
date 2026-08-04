import { describe, expect, it } from 'vitest'
import { buildShareUrl, parseShareToken } from './shareRoute'

const TOKEN = 'a'.repeat(48)

describe('parseShareToken', () => {
  it('#/share/<token> を読める', () => {
    expect(parseShareToken(`#/share/${TOKEN}`)).toBe(TOKEN)
  })

  it('スラッシュ無しの #share/<token> も受ける', () => {
    expect(parseShareToken(`#share/${TOKEN}`)).toBe(TOKEN)
  })

  it('後ろにクエリやスラッシュが付いていても取り出せる', () => {
    expect(parseShareToken(`#/share/${TOKEN}?x=1`)).toBe(TOKEN)
    expect(parseShareToken(`#/share/${TOKEN}/`)).toBe(TOKEN)
  })

  it('共有ページ以外では null(= 通常のアプリを表示する)', () => {
    expect(parseShareToken('')).toBeNull()
    expect(parseShareToken('#')).toBeNull()
    expect(parseShareToken('#/')).toBeNull()
    expect(parseShareToken('#/settings')).toBeNull()
    expect(parseShareToken('#access_token=xyz&type=recovery')).toBeNull()
  })

  it('短すぎる・長すぎる・記号を含むトークンは受け付けない', () => {
    expect(parseShareToken('#/share/short')).toBeNull()
    expect(parseShareToken(`#/share/${'a'.repeat(31)}`)).toBeNull()
    expect(parseShareToken(`#/share/${'a'.repeat(129)}`)).toBeNull()
    expect(parseShareToken(`#/share/${'a'.repeat(40)}<script>`)).toBeNull()
    expect(parseShareToken(`#/share/${'あ'.repeat(48)}`)).toBeNull()
  })

  it('境界ちょうど(32文字・128文字)は受け付ける', () => {
    expect(parseShareToken(`#/share/${'a'.repeat(32)}`)).toBe('a'.repeat(32))
    expect(parseShareToken(`#/share/${'a'.repeat(128)}`)).toBe('a'.repeat(128))
  })

  it('URLエンコードされていても復元する', () => {
    expect(parseShareToken(`#/share/${encodeURIComponent(TOKEN)}`)).toBe(TOKEN)
  })

  it('壊れたパーセントエンコードでも例外にしない', () => {
    expect(parseShareToken('#/share/%E0%A4%A')).toBeNull()
  })
})

describe('buildShareUrl', () => {
  it('GitHub Pages のサブパス配信でも正しいURLになる', () => {
    expect(buildShareUrl('https://me.github.io', '/kakeibo/', TOKEN)).toBe(
      `https://me.github.io/kakeibo/#/share/${TOKEN}`
    )
  })

  it('base の末尾スラッシュが無くても補う', () => {
    expect(buildShareUrl('https://me.github.io', '/kakeibo', TOKEN)).toBe(
      `https://me.github.io/kakeibo/#/share/${TOKEN}`
    )
  })

  it('ルート配信 (base = /) でも動く', () => {
    expect(buildShareUrl('http://localhost:5173', '/', TOKEN)).toBe(
      `http://localhost:5173/#/share/${TOKEN}`
    )
  })

  it('origin の末尾スラッシュを重ねない', () => {
    expect(buildShareUrl('https://me.github.io/', '/kakeibo/', TOKEN)).toBe(
      `https://me.github.io/kakeibo/#/share/${TOKEN}`
    )
  })

  it('作ったURLは自分で読み戻せる', () => {
    const url = buildShareUrl('https://me.github.io', '/kakeibo/', TOKEN)
    expect(parseShareToken(new URL(url).hash)).toBe(TOKEN)
  })
})
