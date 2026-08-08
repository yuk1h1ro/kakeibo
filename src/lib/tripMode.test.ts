import { describe, expect, it } from 'vitest'
import {
  TRIP_REMINDER_DAYS,
  beginTripMode,
  isTripOverdue,
  mergeTripTag,
  mergeTripTags,
  parseTripMode,
  placeTagOptions,
  serializeTripMode,
  tripAutoTag,
  tripAutoTags,
  tripBadgeText,
  tripDayCount,
  tripModeTags,
  tripReminderText,
  tripTagOptions,
  tripTagsText,
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

// ============================================================
// 行き先タグ(「旅行」と「2026和歌山」の2つを自動で付ける)
//
// 階層タグは作らない。保存されるのは tags: ['旅行','2026和歌山'] という
// これまでとまったく同じ文字列の配列で、レポート側が共起を見て内側を出す。
// ここで確かめるのは:
//   ・入れなければ従来どおり1つだけ(オフのときの手数が増えない)
//   ・入れたら2つとも付き、画面の表示と保存内容が必ず一致する
// ============================================================

describe('行き先タグ', () => {
  const on = { taggingAvailable: true, skippedForThisEntry: false }

  it('入れなければ従来どおり1つだけ付く', () => {
    const m = beginTripMode('旅行', '2026-08-06')
    expect(m?.place).toBeUndefined()
    expect(tripModeTags(m!)).toEqual(['旅行'])
    expect(tripAutoTags(m!, on)).toEqual(['旅行'])
  })

  it('入れたら「旅行」と「2026和歌山」の2つが付く', () => {
    const m = beginTripMode('旅行', '2026-08-06', ' #2026和歌山 ')
    expect(m).toEqual({ tag: '旅行', place: '2026和歌山', startedOn: '2026-08-06' })
    expect(tripAutoTags(m!, on)).toEqual(['旅行', '2026和歌山'])
  })

  it('行き先が空になる文字列なら、これまでと同じ1つだけ', () => {
    expect(beginTripMode('旅行', '2026-08-06', '   ')?.place).toBeUndefined()
    expect(beginTripMode('旅行', '2026-08-06', '#')?.place).toBeUndefined()
  })

  it('タグと同じ行き先を打っても二重にならない', () => {
    const m = beginTripMode('旅行', '2026-08-06', '旅行')
    expect(tripModeTags(m!)).toEqual(['旅行'])
  })

  it('行き先だけでは始められない(付ける先のタグが要る)', () => {
    expect(beginTripMode('', '2026-08-06', '2026和歌山')).toBeNull()
  })

  it('帯には2つとも出る(付くタグと表示が食い違わない)', () => {
    const m = beginTripMode('旅行', '2026-08-01', '2026和歌山')!
    expect(tripTagsText(m)).toBe('#旅行 #2026和歌山')
    expect(tripBadgeText(m, '2026-08-03')).toBe('#旅行 #2026和歌山 ・ 3日目')
  })

  it('この1件だけ外すときは、行き先ごと外す', () => {
    const m = beginTripMode('旅行', '2026-08-06', '2026和歌山')!
    expect(tripAutoTags(m, { ...on, skippedForThisEntry: true })).toEqual([])
    expect(tripAutoTags(m, { ...on, taggingAvailable: false })).toEqual([])
  })

  it('保存した値をそのまま読み戻せる(古い保存値も読める)', () => {
    const m = beginTripMode('旅行', '2026-08-06', '2026和歌山')!
    expect(parseTripMode(serializeTripMode(m))).toEqual(m)
    // 行き先が無いときの保存の形は、この機能より前とまったく同じ
    expect(serializeTripMode(beginTripMode('旅行', '2026-08-06')!)).toBe(
      '{"tag":"旅行","startedOn":"2026-08-06"}'
    )
    // 壊れた行き先は無視して、タグだけで動かす
    expect(parseTripMode('{"tag":"旅行","place":123,"startedOn":"2026-08-01"}')).toEqual({
      tag: '旅行',
      startedOn: '2026-08-01',
    })
    expect(parseTripMode('{"tag":"旅行","place":"#","startedOn":"2026-08-01"}')?.place).toBeUndefined()
  })

  it('手で付けたタグと合わせても、自動の2つが先頭に残る(上限で落ちない)', () => {
    const merged = mergeTripTags(['a', 'b', 'c', 'd', 'e'], ['旅行', '2026和歌山'])
    expect(merged).toHaveLength(5)
    expect(merged.slice(0, 2)).toEqual(['旅行', '2026和歌山'])
  })

  it('手で同じタグを打っていても二重にならない', () => {
    expect(mergeTripTags(['2026和歌山'], ['旅行', '2026和歌山'])).toEqual(['旅行', '2026和歌山'])
  })
})

describe('placeTagOptions', () => {
  const tx = (date: string, tags: string[]) => ({
    id: `${date}-${tags.join('')}`,
    date,
    type: 'expense' as const,
    amount: 100,
    category: null,
    memo: '',
    store: '',
    partner_amount: 0,
    created_at: `${date}T00:00:00.000Z`,
    tags,
  })

  it('その旅行タグと一緒に使ったタグを、最近使った順に出す', () => {
    const txs = [
      tx('2025-05-01', ['旅行', '2025北海道']),
      tx('2026-08-06', ['旅行', '2026和歌山']),
      tx('2026-01-02', ['旅行', '2026正月']),
    ]
    expect(placeTagOptions(txs, '旅行')).toEqual(['2026和歌山', '2026正月', '2025北海道'])
  })

  it('別のタグの行き先は混ざらない', () => {
    const txs = [tx('2026-08-06', ['出張', '大阪']), tx('2026-08-07', ['旅行', '2026和歌山'])]
    expect(placeTagOptions(txs, '旅行')).toEqual(['2026和歌山'])
  })

  it('一緒に使ったタグが無ければ空(候補を出さない)', () => {
    expect(placeTagOptions([tx('2026-08-06', ['旅行'])], '旅行')).toEqual([])
    expect(placeTagOptions([], '旅行')).toEqual([])
  })

  it('多すぎるときは新しいものから打ち切る', () => {
    const txs = Array.from({ length: 12 }, (_, i) =>
      tx(`2026-08-${String(i + 1).padStart(2, '0')}`, ['旅行', `place${i}`])
    )
    expect(placeTagOptions(txs, '旅行', 3)).toEqual(['place11', 'place10', 'place9'])
  })
})
