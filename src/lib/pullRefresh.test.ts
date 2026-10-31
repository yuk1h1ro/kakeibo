import { describe, expect, it } from 'vitest'
import {
  PULL_MAX_DISTANCE,
  PULL_TRIGGER_DISTANCE,
  canStartPull,
  formatSyncedAt,
  formatSyncedShort,
  pullOffset,
  shouldTriggerRefresh,
} from './pullRefresh'

describe('canStartPull', () => {
  it('一番上で下に引いたときだけ始まる', () => {
    expect(canStartPull(0, 20, false, 0)).toBe(true)
  })

  it('途中までスクロールしているときは横取りしない', () => {
    expect(canStartPull(120, 20, false, 0)).toBe(false)
  })

  it('上に払ったときは始まらない', () => {
    expect(canStartPull(0, -20, false, 0)).toBe(false)
  })

  it('更新中は二重に始まらない', () => {
    expect(canStartPull(0, 40, true, 0)).toBe(false)
  })

  // 月の帯を左右に払うつもりの指が、少し下へずれただけで引き下げにならないこと。
  // 以前は縦しか見ておらず、横 150px・下 20px の指で更新が走っていた
  it('横のほうが大きく動いた指では始まらない(左右に払う途中で少し下がっただけ)', () => {
    expect(canStartPull(0, 20, false, 150)).toBe(false)
    expect(canStartPull(0, 20, false, -150)).toBe(false)
  })

  it('縦と横が同じだけ動いたときも始めない(縦が勝ったときだけ)', () => {
    expect(canStartPull(0, 30, false, 30)).toBe(false)
    expect(canStartPull(0, 31, false, 30)).toBe(true)
  })

  it('少し横にぶれても、縦が勝っていれば今までどおり引ける', () => {
    expect(canStartPull(0, 40, false, -12)).toBe(true)
  })
})

describe('pullOffset / shouldTriggerRefresh', () => {
  it('引いた量の半分だけ付いてくる', () => {
    expect(pullOffset(40)).toBe(20)
  })

  it('上限を超えて伸びない', () => {
    expect(pullOffset(1000)).toBe(PULL_MAX_DISTANCE)
  })

  it('上に動かしても押し上げない', () => {
    expect(pullOffset(-50)).toBe(0)
  })

  it('しきい値まで引いて離すと更新する', () => {
    expect(shouldTriggerRefresh(PULL_TRIGGER_DISTANCE - 1)).toBe(false)
    expect(shouldTriggerRefresh(PULL_TRIGGER_DISTANCE)).toBe(true)
  })
})

describe('formatSyncedAt', () => {
  const now = new Date(2026, 7, 4, 12, 0, 0) // 2026-08-04 12:00

  it('今日なら時刻だけ', () => {
    expect(formatSyncedAt(new Date(2026, 7, 4, 10, 32).toISOString(), now)).toBe('10:32 に更新')
  })

  it('昨日は「昨日」を付ける', () => {
    expect(formatSyncedAt(new Date(2026, 7, 3, 9, 5).toISOString(), now)).toBe('昨日 09:05 に更新')
  })

  it('それより前は日付を出す', () => {
    expect(formatSyncedAt(new Date(2026, 7, 1, 22, 7).toISOString(), now)).toBe(
      '8月1日 22:07 に更新'
    )
  })

  it('未取得・壊れた値のときは何も出さない', () => {
    expect(formatSyncedAt(null, now)).toBeNull()
    expect(formatSyncedAt('なんだこれ', now)).toBeNull()
  })
})

describe('formatSyncedShort', () => {
  const now = new Date(2026, 7, 4, 12, 0, 0) // 2026-08-04 12:00

  it('今日なら時刻だけ(検索欄の右の小さなボタンに収まる長さ)', () => {
    expect(formatSyncedShort(new Date(2026, 7, 4, 9, 5).toISOString(), now)).toBe('09:05')
  })

  it('昨日は「昨日」だけ', () => {
    expect(formatSyncedShort(new Date(2026, 7, 3, 23, 59).toISOString(), now)).toBe('昨日')
  })

  it('それより前は月/日', () => {
    expect(formatSyncedShort(new Date(2026, 7, 1, 22, 7).toISOString(), now)).toBe('8/1')
  })

  it('未取得・壊れた値のときは何も出さない', () => {
    expect(formatSyncedShort(null, now)).toBeNull()
    expect(formatSyncedShort('なんだこれ', now)).toBeNull()
  })
})
