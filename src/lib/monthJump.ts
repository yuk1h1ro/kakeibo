// ============================================================
// 年月ピッカーで一気にジャンプ (機能130)
//
// 何年も遡るのに矢印を連打させない。既存の月送り(← →)はそのまま残し、
// 見出しの年月を押すと年の一覧が開く、という積み増しにしている
// (今までの操作が変わらないので、覚え直しが要らない)。
// ============================================================

import { monthKey } from './format'

export interface MonthCell {
  /** 'YYYY-MM' */
  key: string
  month: number
  /** 未来の月。選べない */
  disabled: boolean
  /** その月に記録があるか(ある月だけ点を打って、遡る目印にする) */
  hasRecords: boolean
}

/** 記録がある月の集合。(純粋関数) */
export function monthsWithRecords(dates: readonly string[]): Set<string> {
  const set = new Set<string>()
  for (const d of dates) set.add(monthKey(d))
  return set
}

/**
 * 選べる年の範囲。(純粋関数)
 * 一番古い記録の年から今年まで。記録が無ければ今年だけ。
 * 未来の年は出さない(このアプリは「記録した過去」を見る道具のため)。
 */
export function selectableYears(dates: readonly string[], todayIso: string): number[] {
  const thisYear = Number(todayIso.slice(0, 4))
  let min = thisYear
  for (const d of dates) {
    const y = Number(d.slice(0, 4))
    if (Number.isFinite(y) && y < min) min = y
  }
  const years: number[] = []
  for (let y = thisYear; y >= min; y--) years.push(y)
  return years
}

/** その年の12ヶ月分のセル。(純粋関数) */
export function monthCells(
  year: number,
  todayIso: string,
  withRecords: ReadonlySet<string>
): MonthCell[] {
  const currentMonth = monthKey(todayIso)
  const cells: MonthCell[] = []
  for (let m = 1; m <= 12; m++) {
    const key = `${year}-${String(m).padStart(2, '0')}`
    cells.push({
      key,
      month: m,
      disabled: key > currentMonth,
      hasRecords: withRecords.has(key),
    })
  }
  return cells
}

/** 未来へ飛ばないように丸める。(純粋関数) */
export function clampMonth(month: string, todayIso: string): string {
  const currentMonth = monthKey(todayIso)
  return month > currentMonth ? currentMonth : month
}
