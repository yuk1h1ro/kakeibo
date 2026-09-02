import { describe, expect, it } from 'vitest'
import {
  describeRecurrence,
  nextDay,
  nextOccurrenceOnOrAfter,
  occurrencesBetween,
  pendingOccurrences,
  type Recurrence,
} from './recurrence'

const monthly = (day: number): Recurrence => ({
  kind: 'monthly',
  dayOfMonth: day,
  weekday: null,
  monthOfYear: null,
})
const weekly = (weekday: number): Recurrence => ({
  kind: 'weekly',
  dayOfMonth: null,
  weekday,
  monthOfYear: null,
})
const yearly = (month: number, day: number): Recurrence => ({
  kind: 'yearly',
  dayOfMonth: day,
  weekday: null,
  monthOfYear: month,
})

describe('日付ユーティリティ', () => {
  it('月末をまたぐ翌日を返す', () => {
    expect(nextDay('2026-01-31')).toBe('2026-02-01')
    expect(nextDay('2026-12-31')).toBe('2027-01-01')
    expect(nextDay('2024-02-28')).toBe('2024-02-29') // うるう年
    expect(nextDay('2026-02-28')).toBe('2026-03-01')
  })
})

describe('occurrencesBetween — 毎月', () => {
  it('範囲内の該当日を昇順で返す', () => {
    expect(occurrencesBetween(monthly(25), '2026-01-01', '2026-03-31')).toEqual([
      '2026-01-25',
      '2026-02-25',
      '2026-03-25',
    ])
  })

  it('両端を含む', () => {
    expect(occurrencesBetween(monthly(25), '2026-01-25', '2026-01-25')).toEqual(['2026-01-25'])
  })

  it('開始日の前日・終了日の翌日は含めない', () => {
    expect(occurrencesBetween(monthly(25), '2026-01-26', '2026-02-24')).toEqual([])
  })

  it('31日指定はその月の末日に丸める', () => {
    expect(occurrencesBetween(monthly(31), '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
    expect(occurrencesBetween(monthly(31), '2024-02-01', '2024-02-29')).toEqual(['2024-02-29'])
  })

  it('年をまたいで列挙できる', () => {
    expect(occurrencesBetween(monthly(1), '2026-11-02', '2027-02-01')).toEqual([
      '2026-12-01',
      '2027-01-01',
      '2027-02-01',
    ])
  })

  it('範囲が逆なら空', () => {
    expect(occurrencesBetween(monthly(25), '2026-03-01', '2026-01-01')).toEqual([])
  })
})

describe('occurrencesBetween — 毎週', () => {
  it('開始日がその曜日ならその日から始まる', () => {
    // 2026-08-03 は月曜
    expect(occurrencesBetween(weekly(1), '2026-08-03', '2026-08-24')).toEqual([
      '2026-08-03',
      '2026-08-10',
      '2026-08-17',
      '2026-08-24',
    ])
  })

  it('開始日の翌日が該当曜日なら1日進めてから始まる', () => {
    expect(occurrencesBetween(weekly(1), '2026-08-04', '2026-08-17')).toEqual([
      '2026-08-10',
      '2026-08-17',
    ])
  })

  it('該当日が1日も無ければ空', () => {
    expect(occurrencesBetween(weekly(0), '2026-08-03', '2026-08-08')).toEqual([])
  })
})

describe('occurrencesBetween — 毎年', () => {
  it('毎年1回だけ返す', () => {
    expect(occurrencesBetween(yearly(3, 1), '2025-01-01', '2027-12-31')).toEqual([
      '2025-03-01',
      '2026-03-01',
      '2027-03-01',
    ])
  })

  it('2月29日指定は平年では28日に丸める', () => {
    expect(occurrencesBetween(yearly(2, 29), '2026-01-01', '2026-12-31')).toEqual(['2026-02-28'])
    expect(occurrencesBetween(yearly(2, 29), '2024-01-01', '2024-12-31')).toEqual(['2024-02-29'])
  })
})

describe('occurrencesBetween — 不正な設定', () => {
  it('曜日・日にちが欠けていれば空', () => {
    expect(occurrencesBetween(weekly(7), '2026-01-01', '2026-12-31')).toEqual([])
    expect(occurrencesBetween(monthly(0), '2026-01-01', '2026-12-31')).toEqual([])
    expect(occurrencesBetween(monthly(32), '2026-01-01', '2026-12-31')).toEqual([])
    expect(
      occurrencesBetween(
        { kind: 'yearly', dayOfMonth: 1, weekday: null, monthOfYear: 13 },
        '2026-01-01',
        '2026-12-31'
      )
    ).toEqual([])
  })

  it('日付文字列が不正なら空', () => {
    expect(occurrencesBetween(monthly(1), '2026-13-01', '2026-12-31')).toEqual([])
    expect(occurrencesBetween(monthly(1), '2026-02-30', '2026-12-31')).toEqual([])
    expect(occurrencesBetween(monthly(1), 'あした', '2026-12-31')).toEqual([])
  })
})

describe('pendingOccurrences — 重複生成の防止', () => {
  const base = { active: true, recurrence: monthly(25), startDate: '2026-01-01' }

  it('一度も生成していなければ開始日から今日までを作る', () => {
    expect(pendingOccurrences({ ...base, lastGeneratedDate: null }, '2026-03-26')).toEqual([
      '2026-01-25',
      '2026-02-25',
      '2026-03-25',
    ])
  })

  it('生成済みの翌日から数えるので、同じ日を二度作らない', () => {
    expect(pendingOccurrences({ ...base, lastGeneratedDate: '2026-01-25' }, '2026-03-26')).toEqual([
      '2026-02-25',
      '2026-03-25',
    ])
  })

  it('今日まで生成済みなら何も作らない', () => {
    expect(pendingOccurrences({ ...base, lastGeneratedDate: '2026-03-26' }, '2026-03-26')).toEqual(
      []
    )
  })

  it('該当日当日に2回開いても1回しか作らない', () => {
    const first = pendingOccurrences({ ...base, lastGeneratedDate: '2026-02-25' }, '2026-03-25')
    expect(first).toEqual(['2026-03-25'])
    // 生成後は lastGeneratedDate が今日になる
    const second = pendingOccurrences({ ...base, lastGeneratedDate: '2026-03-25' }, '2026-03-25')
    expect(second).toEqual([])
  })

  it('端末の時計が巻き戻っても作らない', () => {
    expect(pendingOccurrences({ ...base, lastGeneratedDate: '2026-05-01' }, '2026-03-26')).toEqual(
      []
    )
  })

  it('開始日より前には遡らない', () => {
    expect(
      pendingOccurrences(
        { ...base, startDate: '2026-02-01', lastGeneratedDate: '2025-01-01' },
        '2026-03-26'
      )
    ).toEqual(['2026-02-25', '2026-03-25'])
  })

  it('開始日が未来なら何も作らない', () => {
    expect(
      pendingOccurrences({ ...base, startDate: '2027-01-01', lastGeneratedDate: null }, '2026-03-26')
    ).toEqual([])
  })

  it('停止中は何も作らない', () => {
    expect(
      pendingOccurrences({ ...base, active: false, lastGeneratedDate: null }, '2026-03-26')
    ).toEqual([])
  })

  it('長く開いていなかった期間の分もすべて遡って作る', () => {
    const dates = pendingOccurrences(
      { ...base, startDate: '2025-01-01', lastGeneratedDate: '2025-01-25' },
      '2026-03-26'
    )
    expect(dates).toHaveLength(14) // 2025-02〜2026-03 の14回
    expect(dates[0]).toBe('2025-02-25')
    expect(dates[dates.length - 1]).toBe('2026-03-25')
  })

  it('生成済みの日付が壊れていても開始日から作り直す', () => {
    expect(pendingOccurrences({ ...base, lastGeneratedDate: 'unknown' }, '2026-02-26')).toEqual([
      '2026-01-25',
      '2026-02-25',
    ])
  })
})

describe('nextOccurrenceOnOrAfter', () => {
  it('当日が該当日ならその日を返す', () => {
    expect(nextOccurrenceOnOrAfter(monthly(25), '2026-08-25')).toBe('2026-08-25')
  })

  it('次の該当日を返す', () => {
    expect(nextOccurrenceOnOrAfter(monthly(25), '2026-08-26')).toBe('2026-09-25')
    expect(nextOccurrenceOnOrAfter(yearly(1, 1), '2026-08-26')).toBe('2027-01-01')
  })
})

describe('describeRecurrence', () => {
  it('日本語の説明にする', () => {
    expect(describeRecurrence(monthly(25))).toBe('毎月25日')
    expect(describeRecurrence(weekly(5))).toBe('毎週金曜')
    expect(describeRecurrence(yearly(3, 1))).toBe('毎年3月1日')
  })
})
