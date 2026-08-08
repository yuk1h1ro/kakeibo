import { describe, expect, it } from 'vitest'
import {
  MAX_TRIP_SENDS,
  addTripSend,
  findTripSend,
  parseTripSends,
  tripResendNotice,
  tripSendKey,
} from './tripSummarySends'

// ============================================================
// 「この旅行はもう送った」の控え。
// 二度送りを **止めない** のがこの機能の判断なので、ここで確かめるのは
// 「同じ旅行を正しく言い当てられるか」と「文言が禁止ではなく事実か」だけ。
// ============================================================

const rec = (over: Partial<Parameters<typeof addTripSend>[1]> = {}) => ({
  key: 'k1',
  sentAt: '2026-08-09T02:00:00.000Z',
  entries: 12,
  messages: 2,
  ...over,
})

describe('tripSendKey', () => {
  it('タグと期間の両方で1回ぶんを指す', () => {
    const a = tripSendKey(['旅行', '2026和歌山'], { start: '2026-08-06', end: '2026-08-08' })
    const b = tripSendKey(['旅行', '2026和歌山'], { start: '2026-09-01', end: '2026-09-02' })
    // 同じ行き先に2回行っても、別の回として区別できる
    expect(a).not.toBe(b)
    expect(a).toBe(tripSendKey(['旅行', '2026和歌山'], { start: '2026-08-06', end: '2026-08-08' }))
  })

  it('タグが違えば別の旅行', () => {
    const r = { start: '2026-08-06', end: '2026-08-08' }
    expect(tripSendKey(['旅行'], r)).not.toBe(tripSendKey(['旅行', '2026和歌山'], r))
  })
})

describe('控えの読み書き', () => {
  it('壊れた値は「まだ送っていない」に倒す', () => {
    expect(parseTripSends(null)).toEqual([])
    expect(parseTripSends('{}')).toEqual([])
    expect(parseTripSends([{ key: 1 }, null, { sentAt: 'x' }])).toEqual([])
  })

  it('同じ旅行は最新の1件だけ残る(新しい順)', () => {
    const list = addTripSend([rec()], rec({ sentAt: '2026-08-10T00:00:00.000Z', messages: 3 }))
    expect(list).toHaveLength(1)
    expect(list[0].messages).toBe(3)
  })

  it('別の旅行は積み上がり、上限を超えたら古いものから捨てる', () => {
    let list: ReturnType<typeof addTripSend> = []
    for (let i = 0; i < MAX_TRIP_SENDS + 5; i++) list = addTripSend(list, rec({ key: `k${i}` }))
    expect(list).toHaveLength(MAX_TRIP_SENDS)
    expect(findTripSend(list, 'k0')).toBeNull()
    expect(findTripSend(list, `k${MAX_TRIP_SENDS + 4}`)).not.toBeNull()
  })

  it('送っていない旅行は null', () => {
    expect(findTripSend([rec()], 'ほかの旅行')).toBeNull()
  })
})

describe('tripResendNotice', () => {
  it('禁止ではなく事実だけを書く(送り直せることも伝える)', () => {
    const text = tripResendNotice(rec(), () => '8月9日 11:00')
    expect(text).toContain('8月9日 11:00 に送信済み')
    expect(text).toContain('12件・2通')
    expect(text).toContain('送り直し')
    expect(text).not.toContain('できません')
  })
})
