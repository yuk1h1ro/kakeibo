import { describe, expect, it } from 'vitest'
import { clampMonth, monthCells, monthsWithRecords, selectableYears } from './monthJump'

describe('selectableYears', () => {
  it('一番古い記録の年から今年まで(新しい順)', () => {
    const years = selectableYears(['2023-05-01', '2025-01-02'], '2026-08-04')
    expect(years).toEqual([2026, 2025, 2024, 2023])
  })

  it('記録が無ければ今年だけ', () => {
    expect(selectableYears([], '2026-08-04')).toEqual([2026])
  })

  it('未来の年は出さない', () => {
    expect(selectableYears(['2030-01-01'], '2026-08-04')).toEqual([2026])
  })
})

describe('monthCells', () => {
  const withRecords = monthsWithRecords(['2026-03-05', '2026-03-20', '2026-07-01'])

  it('12ヶ月ぶん返す', () => {
    expect(monthCells(2026, '2026-08-04', withRecords)).toHaveLength(12)
  })

  it('未来の月は選べない', () => {
    const cells = monthCells(2026, '2026-08-04', withRecords)
    expect(cells[7].disabled).toBe(false) // 8月(当月)
    expect(cells[8].disabled).toBe(true) // 9月
  })

  it('記録がある月に印が付く', () => {
    const cells = monthCells(2026, '2026-08-04', withRecords)
    expect(cells[2].hasRecords).toBe(true) // 3月
    expect(cells[3].hasRecords).toBe(false) // 4月
  })

  it('過去の年はすべて選べる', () => {
    expect(monthCells(2025, '2026-08-04', withRecords).every((c) => !c.disabled)).toBe(true)
  })
})

describe('clampMonth', () => {
  it('未来には飛ばさない', () => {
    expect(clampMonth('2027-01', '2026-08-04')).toBe('2026-08')
    expect(clampMonth('2026-03', '2026-08-04')).toBe('2026-03')
  })
})
