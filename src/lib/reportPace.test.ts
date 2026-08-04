import { describe, expect, it } from 'vitest'
import type { Transaction } from './types'
import { monthRange } from './report'
import {
  cumulativeSeries,
  daysInMonthOf,
  monthEndForecast,
  paceStatus,
  resolvePaceBaseline,
} from './reportPace'

let seq = 0
function tx(p: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: p.id ?? `p${String(seq).padStart(3, '0')}`,
    date: '2026-08-04',
    type: 'expense',
    amount: 1000,
    category: 'food',
    memo: '',
    store: '',
    partner_amount: 0,
    created_at: '2026-08-04T03:00:00.000Z',
    ...p,
  }
}

/** 指定した日ごとに1件ずつ記録を作る */
function txsOn(dates: string[], amount = 1000): Transaction[] {
  return dates.map((date) => tx({ date, amount }))
}

describe('cumulativeSeries', () => {
  it('記録が0件なら全日0のまま並ぶ', () => {
    const s = cumulativeSeries([], monthRange('2026-08'), '2026-08-04')
    expect(s).toHaveLength(31)
    expect(s.every((p) => p.cumulative === 0)).toBe(true)
  })

  it('累積は減らず、今日より後は future になる', () => {
    const s = cumulativeSeries(
      txsOn(['2026-08-01', '2026-08-03'], 500),
      monthRange('2026-08'),
      '2026-08-04'
    )
    expect(s[0]).toMatchObject({ day: 1, cumulative: 500, future: false })
    expect(s[1].cumulative).toBe(500)
    expect(s[2].cumulative).toBe(1000)
    expect(s[3].future).toBe(false) // 今日
    expect(s[4].future).toBe(true)
    expect(s[30].cumulative).toBe(1000)
  })

  it('うるう年の2月は29日ぶん並ぶ', () => {
    expect(cumulativeSeries([], monthRange('2024-02'), '2024-02-10')).toHaveLength(29)
    expect(cumulativeSeries([], monthRange('2023-02'), '2023-02-10')).toHaveLength(28)
  })
})

describe('resolvePaceBaseline', () => {
  const past = [
    ...txsOn(['2026-05-10'], 30000),
    ...txsOn(['2026-06-10'], 50000),
    ...txsOn(['2026-07-10'], 40000),
  ]

  it('予算が設定されていれば予算を使う', () => {
    expect(resolvePaceBaseline(past, '2026-08', 60000)).toEqual({
      amount: 60000,
      source: 'budget',
      monthsUsed: 0,
    })
  })

  it('予算が無ければ直近3ヶ月の平均を使う', () => {
    expect(resolvePaceBaseline(past, '2026-08', null)).toEqual({
      amount: 40000,
      source: 'average',
      monthsUsed: 3,
    })
  })

  it('記録の無い月は平均に混ぜない', () => {
    const only = txsOn(['2026-07-10'], 40000)
    expect(resolvePaceBaseline(only, '2026-08', null)).toEqual({
      amount: 40000,
      source: 'average',
      monthsUsed: 1,
    })
  })

  it('過去に記録が1件も無ければ基準線を引かない', () => {
    expect(resolvePaceBaseline([], '2026-08', null)).toBeNull()
    expect(resolvePaceBaseline([], '2026-08', 0)).toBeNull() // 予算0は未設定と同じ扱い
  })

  it('年をまたいで過去月を遡れる', () => {
    const dec = txsOn(['2025-12-10'], 20000)
    expect(resolvePaceBaseline(dec, '2026-01', null)).toEqual({
      amount: 20000,
      source: 'average',
      monthsUsed: 1,
    })
  })
})

describe('paceStatus', () => {
  const august = monthRange('2026-08')

  it('月初1日目でも破綻せず、1日ぶんの適正額を出す', () => {
    const s = cumulativeSeries(txsOn(['2026-08-01'], 5000), august, '2026-08-01')
    const status = paceStatus(s, 31000, '2026-08-01')
    expect(status).toEqual({
      expected: 1000, // 31000 × 1 ÷ 31
      actual: 5000,
      diff: 4000,
      elapsedDays: 1,
      totalDays: 31,
    })
  })

  it('使いすぎていなければ diff が負になる', () => {
    const s = cumulativeSeries(txsOn(['2026-08-01'], 1000), august, '2026-08-10')
    const status = paceStatus(s, 31000, '2026-08-10')
    expect(status?.expected).toBe(10000)
    expect(status?.diff).toBe(-9000)
  })

  it('過去の月を見ているときは月末時点の比較になる', () => {
    const s = cumulativeSeries(txsOn(['2026-07-05'], 20000), monthRange('2026-07'), '2026-08-04')
    const status = paceStatus(s, 31000, '2026-08-04')
    expect(status).toMatchObject({ elapsedDays: 31, expected: 31000, actual: 20000 })
  })

  it('期間が始まる前なら null', () => {
    const s = cumulativeSeries([], monthRange('2026-09'), '2026-08-04')
    expect(paceStatus(s, 31000, '2026-08-04')).toBeNull()
    expect(paceStatus([], 31000, '2026-08-04')).toBeNull()
  })
})

describe('monthEndForecast', () => {
  it('月初(経過7日未満)は予測を出さない', () => {
    const txs = txsOn(['2026-08-01', '2026-08-02', '2026-08-03'], 3000)
    expect(monthEndForecast(txs, '2026-08', '2026-08-03')).toEqual({
      available: false,
      reason: 'too-early',
      elapsedDays: 3,
      activeDays: 3,
    })
  })

  it('支出のあった日が少なければ予測を出さない', () => {
    const txs = txsOn(['2026-08-01', '2026-08-02'], 3000)
    const r = monthEndForecast(txs, '2026-08', '2026-08-10')
    expect(r).toMatchObject({ available: false, reason: 'few-records', activeDays: 2 })
  })

  it('記録が0件なら予測を出さない', () => {
    expect(monthEndForecast([], '2026-08', '2026-08-20')).toMatchObject({
      available: false,
      reason: 'few-records',
    })
  })

  it('過去の月は予測しない(実績が確定しているため)', () => {
    const txs = txsOn(['2026-07-01', '2026-07-10', '2026-07-20'], 3000)
    expect(monthEndForecast(txs, '2026-07', '2026-08-04')).toMatchObject({
      available: false,
      reason: 'not-current-month',
    })
  })

  it('月末日には予測を出さない(残り日数が無い)', () => {
    const txs = txsOn(['2026-08-01', '2026-08-10', '2026-08-20'], 3000)
    expect(monthEndForecast(txs, '2026-08', '2026-08-31')).toMatchObject({
      available: false,
      reason: 'month-end',
    })
  })

  it('毎日一定額なら中心値は月額そのもので、幅は0になる', () => {
    const dates = Array.from({ length: 10 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`)
    const r = monthEndForecast(txsOn(dates, 1000), '2026-08', '2026-08-10')
    expect(r.available).toBe(true)
    if (!r.available) return
    expect(r.actual).toBe(10000)
    expect(r.dailyAverage).toBe(1000)
    expect(r.point).toBe(31000)
    expect(r.low).toBe(31000)
    expect(r.high).toBe(31000)
    expect(r.elapsedDays).toBe(10)
    expect(r.remainingDays).toBe(21)
    expect(r.activeDays).toBe(10)
  })

  it('ばらつきがあると幅が広がり、下限は実績を下回らない', () => {
    const txs = [
      ...txsOn(['2026-08-01'], 50000),
      ...txsOn(['2026-08-05'], 1000),
      ...txsOn(['2026-08-09'], 1000),
    ]
    const r = monthEndForecast(txs, '2026-08', '2026-08-10')
    expect(r.available).toBe(true)
    if (!r.available) return
    expect(r.high).toBeGreaterThan(r.point)
    expect(r.low).toBeGreaterThanOrEqual(r.actual)
    expect(r.activeDays).toBe(3)
  })

  it('うるう年の2月は29日で着地を見る', () => {
    const dates = Array.from({ length: 10 }, (_, i) => `2024-02-${String(i + 1).padStart(2, '0')}`)
    const r = monthEndForecast(txsOn(dates, 1000), '2024-02', '2024-02-10')
    expect(r.available).toBe(true)
    if (!r.available) return
    expect(r.remainingDays).toBe(19)
    expect(r.point).toBe(29000)
  })
})

describe('daysInMonthOf', () => {
  it('うるう年を含めて月の日数を返す', () => {
    expect(daysInMonthOf('2024-02')).toBe(29)
    expect(daysInMonthOf('2023-02')).toBe(28)
    expect(daysInMonthOf('2026-08')).toBe(31)
  })
})
