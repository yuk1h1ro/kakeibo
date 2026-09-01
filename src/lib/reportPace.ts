// ============================================================
// 支出ペースの参照線 (機能026) と 月末着地の予測 (機能027)
//
// 026 は「今日時点でここまでなら適正」を示す線。基準額は
//   1. 端末に保存した月の予算(明示的に設定されていればそれを最優先)
//   2. 直近3ヶ月のうち、記録のある月の平均支出(予算未設定のときの代用)
// の順で決める。どちらも無い(過去に記録が無い)ときは線を引かない —
// 根拠の無い基準を勝手にでっち上げると、それ自体が誤った判断材料になるため。
//
// 027 は予測。**サンプルが少ないうちは出さない**。出すときも点ではなく幅で出し、
// 「何日分の実績から出したか」を必ず添えられるよう、根拠を戻り値に含める。
// ============================================================

import type { Transaction } from './types'
import type { DateRange } from './report'
import { monthRange, rangeDays, totalOwn } from './report'
import { dailyTotals } from './reportBuckets'
import { shiftMonth } from './calendar'

// ---------- 026: 累積と基準線 ----------

export interface CumulativePoint {
  iso: string
  /** 月の何日目か(1始まり)。参照線の傾きを出すのに使う */
  day: number
  /** その日までの累積(自分の実質支出) */
  cumulative: number
  /** その日単体の支出 */
  amount: number
  /** 今日より後の日か(当月を見ているときだけ true になりうる) */
  future: boolean
}

/**
 * 期間の累積支出。(純粋関数)
 * today が期間内にあるときは、それより後の日を future=true として区別する
 * (まだ来ていない日の累積を実績として描くと「使っていない」ことが
 *  「使い切った」ように見えてしまうため、画面側では実績線を today で止める)。
 */
export function cumulativeSeries(
  txs: readonly Transaction[],
  r: DateRange,
  today: string
): CumulativePoint[] {
  let running = 0
  return dailyTotals(txs, r).map((d, i) => {
    running += d.total
    return {
      iso: d.iso,
      day: i + 1,
      cumulative: running,
      amount: d.total,
      future: d.iso > today,
    }
  })
}

export type PaceBaselineSource = 'budget' | 'average'

export interface PaceBaseline {
  /** 月末までに使ってよい額 */
  amount: number
  source: PaceBaselineSource
  /** source==='average' のとき、平均に使った月数(根拠の表示に使う) */
  monthsUsed: number
}

/** 平均の算出に遡る月数。3ヶ月なら季節変動に飲まれず、直近の生活実態にも追随する */
export const AVERAGE_LOOKBACK_MONTHS = 3

/**
 * 基準額を決める。(純粋関数)
 * 予算が設定されていればそれ。無ければ直近 lookback ヶ月のうち
 * **記録のある月だけ**の平均(記録の無い月を 0 として混ぜると平均が不当に下がる)。
 * どちらも無ければ null(= 線を引かない)。
 */
export function resolvePaceBaseline(
  txs: readonly Transaction[],
  month: string,
  budget: number | null,
  lookback: number = AVERAGE_LOOKBACK_MONTHS
): PaceBaseline | null {
  if (budget !== null && budget > 0) {
    return { amount: budget, source: 'budget', monthsUsed: 0 }
  }
  const totals: number[] = []
  for (let i = 1; i <= lookback; i++) {
    const key = shiftMonth(month, -i)
    const total = totalOwn(txs, monthRange(key))
    if (total > 0) totals.push(total)
  }
  if (totals.length === 0) return null
  const sum = totals.reduce((a, b) => a + b, 0)
  return {
    amount: Math.round(sum / totals.length),
    source: 'average',
    monthsUsed: totals.length,
  }
}

export interface PaceStatus {
  /** 今日時点の「ここまでなら適正」な額 */
  expected: number
  /** 今日時点の実績 */
  actual: number
  /** 実績 - 適正。正なら使いすぎ */
  diff: number
  /** 経過日数(今日を含む) */
  elapsedDays: number
  /** 期間の日数 */
  totalDays: number
}

/**
 * 今日時点の適正額と実績の比較。(純粋関数)
 * 参照線は「月末に基準額へ到達する一定ペース」= 基準額 × 経過日数 ÷ 月の日数。
 * 実際の支出は月初・月末に偏るが、偏りの仮定を置くほど根拠が弱くなるので
 * いちばん説明のつく直線にしてある。
 */
export function paceStatus(
  series: readonly CumulativePoint[],
  baselineAmount: number,
  today: string
): PaceStatus | null {
  if (series.length === 0) return null
  const totalDays = series.length
  // 今日が期間より後(過去の月を見ている)なら、月末時点での比較になる
  const idx = series.findIndex((p) => p.iso === today)
  const elapsedDays = idx >= 0 ? idx + 1 : today > series[series.length - 1].iso ? totalDays : 0
  if (elapsedDays === 0) return null // 期間がまだ始まっていない
  const expected = Math.round((baselineAmount * elapsedDays) / totalDays)
  const actual = series[elapsedDays - 1].cumulative
  return { expected, actual, diff: actual - expected, elapsedDays, totalDays }
}

// ---------- 027: 月末着地の予測 ----------

/** これだけ日数が経っていないと予測を出さない(月初の数日は誤差が大きすぎる) */
export const FORECAST_MIN_ELAPSED_DAYS = 7
/** 支出のあった日がこれだけ無いと予測を出さない(1〜2日の買い物では傾向が読めない) */
export const FORECAST_MIN_ACTIVE_DAYS = 3

export type ForecastSkipReason =
  | 'not-current-month' // 過去・未来の月は実績が確定しているので予測しない
  | 'too-early' // 経過日数が足りない
  | 'few-records' // 支出のあった日が少ない
  | 'month-end' // 残り日数が無い(=実績がそのまま着地)

export interface ForecastUnavailable {
  available: false
  reason: ForecastSkipReason
  elapsedDays: number
  activeDays: number
}

export interface ForecastResult {
  available: true
  /** 中心の見込み額(100円単位に丸め) */
  point: number
  /** 見込みの幅(下限・上限。100円単位に丸め) */
  low: number
  high: number
  /** 現時点の実績 */
  actual: number
  /** 1日あたりの平均(経過日数で割った額) */
  dailyAverage: number
  elapsedDays: number
  remainingDays: number
  /** 支出のあった日数(根拠として表示する) */
  activeDays: number
}

export type Forecast = ForecastResult | ForecastUnavailable

function roundTo100(n: number): number {
  return Math.round(n / 100) * 100
}

/**
 * 月末着地の予測。(純粋関数)
 *
 * 「経過日数の1日あたり平均が残りの日も続いたら」という単純な外挿。
 * 難しいモデルを置いても根拠を説明できないので、いちばん素直な形にしている。
 *
 * 幅は、経過日数の日別支出のばらつき(標準偏差)から
 *   残り日数分の合計の標準偏差 = sd × √(残り日数)
 * を求め、その約2倍(95%の目安)を上下に取る。下限は実績を下回らない
 * (すでに使った額より少なく着地することはありえないため)。
 *
 * 出さない条件は ForecastSkipReason のとおり。断定を避けるため、
 * 画面側では必ず「予測」と明記し、この幅とともに表示すること。
 */
export function monthEndForecast(
  txs: readonly Transaction[],
  month: string,
  today: string
): Forecast {
  const r = monthRange(month)
  const isCurrentMonth = today >= r.start && today <= r.end
  const days = dailyTotals(txs, r)
  const elapsed = isCurrentMonth ? days.findIndex((d) => d.iso === today) + 1 : days.length
  const activeDays = days.slice(0, Math.max(elapsed, 0)).filter((d) => d.total > 0).length

  if (!isCurrentMonth) {
    return { available: false, reason: 'not-current-month', elapsedDays: elapsed, activeDays }
  }
  const remaining = days.length - elapsed
  if (remaining <= 0) {
    return { available: false, reason: 'month-end', elapsedDays: elapsed, activeDays }
  }
  if (elapsed < FORECAST_MIN_ELAPSED_DAYS) {
    return { available: false, reason: 'too-early', elapsedDays: elapsed, activeDays }
  }
  if (activeDays < FORECAST_MIN_ACTIVE_DAYS) {
    return { available: false, reason: 'few-records', elapsedDays: elapsed, activeDays }
  }

  const elapsedTotals = days.slice(0, elapsed).map((d) => d.total)
  const actual = elapsedTotals.reduce((a, b) => a + b, 0)
  const mean = actual / elapsed
  const variance = elapsedTotals.reduce((a, v) => a + (v - mean) ** 2, 0) / elapsed
  const margin = 1.96 * Math.sqrt(variance) * Math.sqrt(remaining)
  const point = actual + mean * remaining

  return {
    available: true,
    point: roundTo100(point),
    low: Math.max(roundTo100(point - margin), roundTo100(actual)),
    high: roundTo100(point + margin),
    actual,
    dailyAverage: Math.round(mean),
    elapsedDays: elapsed,
    remainingDays: remaining,
    activeDays,
  }
}

/** 月の日数(参照線の説明文に使う)。rangeDays の再実装を避けるための薄い包み */
export function daysInMonthOf(month: string): number {
  return rangeDays(monthRange(month))
}
