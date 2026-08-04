// ============================================================
// カレンダーのヒートマップ (機能113)
//
// 履歴タブのカレンダーとは別物として、レポート画面に独立して置く
// (履歴側の選択状態・明細表示とは目的が違うため、共有すると両方が複雑になる)。
//
// 色は既存トークンの --accent の濃さだけで作り、**濃さは補助**にする。
// 各セルには金額も出す(色覚に依存せず読めるようにするため)。
// ============================================================

import type { Transaction } from './types'
import { monthWeeks, type CalendarDay } from './calendar'
import { monthRange } from './report'
import { dailyTotals } from './reportBuckets'

/** 色の段階数。4段階なら濃淡の差が判別でき、凡例も短く済む */
export const HEAT_LEVELS = 4

export interface HeatCell extends CalendarDay {
  total: number
  count: number
  /** 0(支出なし)〜HEAT_LEVELS。最大の日を基準にした線形の段階 */
  level: number
}

export interface MonthHeatmap {
  /** 日曜始まりの週配列。当月以外のセルは null(履歴のカレンダーと同じ形) */
  weeks: (HeatCell | null)[][]
  max: number
  total: number
  /** 支出のあった日数 */
  activeDays: number
  /** 凡例に出す各段階の下限額(level 1..HEAT_LEVELS の順) */
  legend: number[]
}

/**
 * 月の日別支出をカレンダーの形に並べる。(純粋関数)
 *
 * 段階は「その月の最大の日」を 4 等分した線形。分位点にすると見た目の分布は
 * よくなるが、凡例で説明できない(「なぜこの日が濃いのか」が言えない)ため、
 * 説明のつく線形にしている。
 */
export function monthHeatmap(txs: readonly Transaction[], month: string): MonthHeatmap {
  const byDate = new Map(dailyTotals(txs, monthRange(month)).map((d) => [d.iso, d]))
  let max = 0
  let total = 0
  let activeDays = 0
  for (const d of byDate.values()) {
    if (d.total > max) max = d.total
    total += d.total
    if (d.total > 0) activeDays += 1
  }

  const weeks = monthWeeks(month).map((week) =>
    week.map((cell) => {
      if (cell === null) return null
      const d = byDate.get(cell.iso)
      const value = d?.total ?? 0
      return {
        ...cell,
        total: value,
        count: d?.count ?? 0,
        level: value <= 0 || max <= 0 ? 0 : Math.min(HEAT_LEVELS, Math.ceil((value / max) * HEAT_LEVELS)),
      }
    })
  )

  const legend =
    max > 0 ? Array.from({ length: HEAT_LEVELS }, (_, i) => Math.round((max * i) / HEAT_LEVELS)) : []

  return { weeks, max, total, activeDays, legend }
}
