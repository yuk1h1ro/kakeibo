import { describe, expect, it } from 'vitest'
import {
  TRIP_REMINDER_DAYS,
  beginTripMode,
  isTripOverdue,
  mergeTripTag,
  parseTripMode,
  serializeTripMode,
  tripAutoTag,
  tripBadgeText,
  tripDayCount,
  tripReminderText,
  tripTagOptions,
  type TripMode,
} from './tripMode'
import { DEFAULT_SPECIAL_TAGS } from './reportTagSettings'

// ============================================================
// 旅行モードの純粋関数。
//
// ここで守っているのは3つ:
//   ・オフのときは何も足さない(入力の意味を変えない)
//   ・オンのときに付けるタグと、画面に出すタグが必ず同じ
//   ・長引いても **自動では解除しない**(声をかけるだけ)
// ============================================================

const mode = (over: Partial<TripMode> = {}): TripMode => ({
  tag: '旅行',
  startedOn: '2026-08-01',
  ...over,
})

describe('parseTripMode', () => {
  it('保存していなければオフ', () => {
    expect(parseTripMode(null)).toBeNull()
    expect(parseTripMode('')).toBeNull()
  })

  it('保存された状態をそのまま読む', () => {
    expect(parseTripMode('{"tag":"旅行","startedOn":"2026-08-01"}')).toEqual(mode())
  })

  it('タグの正規化は入力欄と同じ規則を通る(「#旅行」も「旅行」)', () => {
    expect(parseTripMode('{"tag":" #旅行 ","startedOn":"2026-08-01"}')?.tag).toBe('旅行')
  })

  it('壊れた値・形の違う値はオフに倒す(意図しないタグを記録に混ぜない)', () => {
    expect(parseTripMode('{')).toBeNull()
    expect(parseTripMode('"旅行"')).toBeNull()
    expect(parseTripMode('null')).toBeNull()
    expect(parseTripMode('{"tag":"旅行"}')).toBeNull() // 開始日が無い
    expect(parseTripMode('{"tag":"旅行","startedOn":"2026/08/01"}')).toBeNull()
    expect(parseTripMode('{"tag":"#","startedOn":"2026-08-01"}')).toBeNull() // 空になるタグ
    expect(parseTripMode('{"tag":123,"startedOn":"2026-08-01"}')).toBeNull()
  })

  it('保存した値をそのまま読み戻せる', () => {
    const m = mode({ tag: 'デート', startedOn: '2026-12-24' })
    expect(parseTripMode(serializeTripMode(m))).toEqual(m)
  })
})

describe('beginTripMode', () => {
  it('打った文字列を正規化して、今日を開始日にする', () => {
    expect(beginTripMode('　#出張　', '2026-08-05')).toEqual({
      tag: '出張',
      startedOn: '2026-08-05',
    })
  })

  it('空になる文字列では始められない', () => {
    expect(beginTripMode('   ', '2026-08-05')).toBeNull()
    expect(beginTripMode('#', '2026-08-05')).toBeNull()
  })
})

describe('tripDayCount', () => {
  it('開始日が1日目', () => {
    expect(tripDayCount(mode(), '2026-08-01')).toBe(1)
    expect(tripDayCount(mode(), '2026-08-04')).toBe(4)
  })

  it('月をまたいでも数え違えない', () => {
    expect(tripDayCount(mode({ startedOn: '2026-08-30' }), '2026-09-02')).toBe(4)
  })

  it('端末の日付が戻っていても、1日目より小さくしない', () => {
    expect(tripDayCount(mode({ startedOn: '2026-08-10' }), '2026-08-01')).toBe(1)
  })
})

describe('切り忘れへの備え', () => {
  it('短いあいだは何も言わない(要らない注意を増やさない)', () => {
    expect(isTripOverdue(mode(), '2026-08-04')).toBe(false)
    expect(tripReminderText(mode(), '2026-08-04')).toBeNull()
  })

  it('3泊4日の旅行・1週間の出張は注意の対象にしない', () => {
    expect(isTripOverdue(mode(), '2026-08-07')).toBe(false) // 7日目
  })

  it('7日を超えたら声をかける(ただし解除はしない)', () => {
    const today = '2026-08-08' // 8日目
    expect(tripDayCount(mode(), today)).toBe(TRIP_REMINDER_DAYS)
    expect(isTripOverdue(mode(), today)).toBe(true)
    const text = tripReminderText(mode(), today) ?? ''
    expect(text).toContain('8日目')
    expect(text).toContain('終わっていませんか')
    // 声をかけたあとも状態は変わらない = 勝手に解除しない
    expect(mode().tag).toBe('旅行')
  })
})

describe('tripBadgeText', () => {
  it('何が付くかと、何日目かだけを出す', () => {
    expect(tripBadgeText(mode(), '2026-08-03')).toBe('#旅行 ・ 3日目')
  })
})

describe('tripAutoTag', () => {
  const on = { taggingAvailable: true, skippedForThisEntry: false }

  it('オフのときは何も付けない', () => {
    expect(tripAutoTag(null, on)).toBeNull()
  })

  it('オンのときは、そのタグを付ける', () => {
    expect(tripAutoTag(mode(), on)).toBe('旅行')
  })

  it('tags 列が無い環境では付けない(送っても保存されないため)', () => {
    expect(tripAutoTag(mode(), { ...on, taggingAvailable: false })).toBeNull()
  })

  it('この1件だけ外したときは付けない(旅行中のコンビニの自分用)', () => {
    expect(tripAutoTag(mode(), { ...on, skippedForThisEntry: true })).toBeNull()
  })
})

describe('mergeTripTag', () => {
  it('オフのときは手で付けたタグだけ(並びも変えない)', () => {
    expect(mergeTripTag(['ごほうび', 'デート'], null)).toEqual(['ごほうび', 'デート'])
  })

  it('自動と手動の両方が付く', () => {
    expect(mergeTripTag(['ごほうび'], '旅行')).toEqual(['旅行', 'ごほうび'])
  })

  it('手で同じタグを打っていても二重にならない', () => {
    expect(mergeTripTag(['旅行', 'ごほうび'], '旅行')).toEqual(['旅行', 'ごほうび'])
  })

  it('手で上限まで付けた回でも、自動タグが落ちない(その1件だけ集計から抜けないように)', () => {
    const manual = ['a', 'b', 'c', 'd', 'e']
    const merged = mergeTripTag(manual, '旅行')
    expect(merged).toHaveLength(5)
    expect(merged[0]).toBe('旅行')
  })
})

describe('tripTagOptions', () => {
  it('レポートで特別扱いされるタグをそのまま候補にする', () => {
    expect(tripTagOptions(['出張', '帰省'])).toEqual(['出張', '帰省'])
  })

  it('特別タグを全部外している人にも候補を出す(でないと始められない)', () => {
    expect(tripTagOptions([])).toEqual([...DEFAULT_SPECIAL_TAGS])
  })

  it('重複と「#」は入力欄と同じ規則でならす', () => {
    expect(tripTagOptions(['#旅行', '旅行', ' デート '])).toEqual(['旅行', 'デート'])
  })
})
