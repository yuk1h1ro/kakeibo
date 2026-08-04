// ============================================================
// 年の1年まとめ (機能123)
//
// 新しい集計は足さず、既存の月次の集計(report.ts)を年の期間で束ね直すだけ。
// 同じ数字が別の計算式から出てくると、どちらが正しいのか分からなくなるため。
// ============================================================

import type { Transaction } from './types'
import type { DateRange, RankItem, SatisfactionSummary } from './report'
import {
  rankByCategory,
  rankByStore,
  satisfactionSummary,
  totalOwn,
  totalPartner,
} from './report'
import { dailyTotals } from './reportBuckets'

export interface YearMonthTotal {
  key: string // 'YYYY-MM'
  label: string // '1月'
  total: number
  /** その月がまだ来ていない(進行中の年の未来月)か */
  future: boolean
}

export interface YearSummary {
  year: number
  /** 集計に使った期間。進行中の年は今日までで切る */
  range: DateRange
  /** 進行中の年か(= 途中集計であることを画面に出す) */
  partial: boolean
  total: number
  partnerTotal: number
  /** 記録のあった月だけの平均(記録の無い月を0で混ぜて平均を下げない) */
  monthlyAverage: number
  months: YearMonthTotal[]
  maxMonth: YearMonthTotal | null
  minMonth: YearMonthTotal | null
  categories: RankItem[]
  stores: RankItem[]
  satisfaction: SatisfactionSummary
  /** 支出の件数と、支出のあった日数 */
  count: number
  activeDays: number
}

/**
 * 1年分のまとめ。(純粋関数)
 * today が対象年の中にあるときは、集計の終端を today にする
 * (未来の日付を含めても意味は変わらないが、「12月まで終わった年」と
 *  「まだ8月の年」を同じ顔で出すと、途中の数字を確定値と誤解させるため)。
 */
export function yearSummary(
  txs: readonly Transaction[],
  year: number,
  today: string,
  labelOf: (id: string | null) => string
): YearSummary {
  const todayYear = Number(today.slice(0, 4))
  const partial = todayYear === year
  const range: DateRange = {
    start: `${year}-01-01`,
    end: partial ? today : `${year}-12-31`,
  }

  const months: YearMonthTotal[] = Array.from({ length: 12 }, (_, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`
    const last = new Date(year, i + 1, 0).getDate()
    const monthEnd = `${key}-${String(last).padStart(2, '0')}`
    const start = `${key}-01`
    return {
      key,
      label: `${i + 1}月`,
      total: totalOwn(txs, { start, end: monthEnd < range.end ? monthEnd : range.end }),
      future: start > range.end,
    }
  })

  const recorded = months.filter((m) => !m.future && m.total > 0)
  const total = totalOwn(txs, range)
  const days = dailyTotals(txs, range)

  return {
    year,
    range,
    partial,
    total,
    partnerTotal: totalPartner(txs, range),
    monthlyAverage:
      recorded.length > 0 ? Math.round(recorded.reduce((s, m) => s + m.total, 0) / recorded.length) : 0,
    months,
    // 同額のときの並びをぶらさないため、最大は先に来た月、最小も先に来た月を採る
    maxMonth: recorded.reduce<YearMonthTotal | null>(
      (best, m) => (best === null || m.total > best.total ? m : best),
      null
    ),
    minMonth: recorded.reduce<YearMonthTotal | null>(
      (best, m) => (best === null || m.total < best.total ? m : best),
      null
    ),
    categories: rankByCategory(txs, range, labelOf),
    stores: rankByStore(txs, range),
    satisfaction: satisfactionSummary(txs, range),
    count: days.reduce((s, d) => s + d.count, 0),
    activeDays: days.filter((d) => d.count > 0).length,
  }
}
