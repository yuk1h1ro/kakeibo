import { describe, expect, it } from 'vitest'
import {
  PULL_MAX_DISTANCE,
  PULL_TRIGGER_DISTANCE,
  canStartPull,
  formatSyncedAt,
  pullOffset,
  shouldTriggerRefresh,
} from './pullRefresh'

describe('canStartPull', () => {
  it('一番上で下に引いたときだけ始まる', () => {
    expect(canStartPull(0, 20, false)).toBe(true)
  })

  it('途中までスクロールしているときは横取りしない', () => {
    expect(canStartPull(120, 20, false)).toBe(false)
  })

  it('上に払ったときは始まらない', () => {
    expect(canStartPull(0, -20, false)).toBe(false)
  })

  it('更新中は二重に始まらない', () => {
    expect(canStartPull(0, 40, true)).toBe(false)
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
