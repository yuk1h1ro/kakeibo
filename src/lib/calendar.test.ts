import { describe, expect, it } from 'vitest'
import { daysInMonth, monthEndISO } from './calendar'

// 統合前は report / netWorth / historyFilter / recurrence / reportYear / calendar が
// それぞれ月末日を出していた。各実装が持っていた境界(うるう年・28/29/30/31日・年またぎ)を
// ここで固定しておき、共通化のあとにずれたら落ちるようにする。

describe('daysInMonth', () => {
  it('月ごとの日数を返す', () => {
    expect(daysInMonth(2026, 1)).toBe(31)
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it('うるう年の2月を29日、平年を28日と数える', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
  })

  it('100年・400年のうるう年規則にも従う(Date 任せなので誤らない)', () => {
    expect(daysInMonth(1900, 2)).toBe(28)
    expect(daysInMonth(2000, 2)).toBe(29)
    expect(daysInMonth(2100, 2)).toBe(28)
  })
})

describe('monthEndISO', () => {
  it('月末日を YYYY-MM-DD で返す', () => {
    expect(monthEndISO('2026-08')).toBe('2026-08-31')
    expect(monthEndISO('2026-04')).toBe('2026-04-30')
    expect(monthEndISO('2026-02')).toBe('2026-02-28')
    expect(monthEndISO('2024-02')).toBe('2024-02-29')
  })

  it('1月・12月でも年をまたがない', () => {
    expect(monthEndISO('2026-01')).toBe('2026-01-31')
    expect(monthEndISO('2026-12')).toBe('2026-12-31')
  })
})
