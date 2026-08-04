import { describe, expect, it } from 'vitest'
import {
  HINT_LIMIT,
  parseEnabled,
  parseHintCount,
  serializeEnabled,
  shouldShield,
  shouldShowHint,
} from './privacyBlur'

describe('shouldShield', () => {
  it('見えていてフォーカスもあるときは隠さない', () => {
    expect(shouldShield({ hidden: false, focused: true })).toBe(false)
  })

  it('タブが裏に回ったら隠す', () => {
    expect(shouldShield({ hidden: true, focused: false })).toBe(true)
  })

  it('フォーカスだけ失ったときも隠す(iOS のタブ一覧・アプリスイッチャー対策)', () => {
    expect(shouldShield({ hidden: false, focused: false })).toBe(true)
  })

  it('hidden だがフォーカスが残っている報告でも隠す', () => {
    expect(shouldShield({ hidden: true, focused: true })).toBe(true)
  })
})

describe('parseEnabled', () => {
  it('未設定は既定でオン(金額を晒す側に倒さない)', () => {
    expect(parseEnabled(null)).toBe(true)
  })

  it('off を保存したときだけオフ', () => {
    expect(parseEnabled('off')).toBe(false)
    expect(parseEnabled('on')).toBe(true)
  })

  it('壊れた値はオンとして扱う', () => {
    expect(parseEnabled('')).toBe(true)
    expect(parseEnabled('yes')).toBe(true)
  })

  it('serializeEnabled と往復する', () => {
    expect(parseEnabled(serializeEnabled(true))).toBe(true)
    expect(parseEnabled(serializeEnabled(false))).toBe(false)
  })
})

describe('parseHintCount', () => {
  it('未設定・壊れた値は 0', () => {
    expect(parseHintCount(null)).toBe(0)
    expect(parseHintCount('abc')).toBe(0)
    expect(parseHintCount('-3')).toBe(0)
  })

  it('数値は整数に丸めて読む', () => {
    expect(parseHintCount('2')).toBe(2)
    expect(parseHintCount('2.9')).toBe(2)
  })
})

describe('shouldShowHint', () => {
  it('最初の数回だけ「もう隠さない」への導線を出す', () => {
    expect(shouldShowHint(0)).toBe(true)
    expect(shouldShowHint(HINT_LIMIT - 1)).toBe(true)
    expect(shouldShowHint(HINT_LIMIT)).toBe(false)
    expect(shouldShowHint(HINT_LIMIT + 10)).toBe(false)
  })
})
