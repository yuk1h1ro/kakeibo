import { describe, expect, it } from 'vitest'
import { resolveKeypadEnabled } from './keypadSettings'

describe('resolveKeypadEnabled', () => {
  it('auto では端末の種類で決まる(タッチ端末だけテンキー)', () => {
    expect(resolveKeypadEnabled('auto', true)).toBe(true)
    expect(resolveKeypadEnabled('auto', false)).toBe(false)
  })

  it('明示的な設定は端末の種類より優先される', () => {
    expect(resolveKeypadEnabled('on', false)).toBe(true)
    expect(resolveKeypadEnabled('off', true)).toBe(false)
  })
})
