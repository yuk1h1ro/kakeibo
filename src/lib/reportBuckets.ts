// ============================================================
// 日 / 週 / 月 / 年 の粒度でのバケット集計 (機能129)
//
// 既存の「月で見る」「期間で見る」は壊さない。粒度切替は
// **それ自身の窓(今日を終端とする直近N本)** を持つ独立した見方にしてある。
// 選択中の期間にバケットを合わせてしまうと、
// 「1日だけの期間を年で見る」= 棒1本、のような無意味な表示になり、
// 期間の選択と粒度の選択が互いを潰し合うため。
//
// 日付はすべて 'YYYY-MM-DD' のローカルタイム文字列で扱い、toISOString は使わない
// (report.ts / recurrence.ts と同じ方針)。
// ============================================================

import type { Transaction } from './types'
import { ownAmount } from './types'
import type { DateRange } from './report'
import { monthRange, ownExpenses } from './report'

export type Granularity = 'day' | 'week' | 'month' | 'year'

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: '日',
  week: '週',
  month: '月',
  year: '年',
}

/**
 * 粒度ごとの既定の本数。
 * iPhone の幅(棒グラフの viewBox は 360)で横スクロールせずにラベルが読める本数に
 * 抑えている(日を30本にするとラベルが潰れて読めない)。
 */
export const DEFAULT_BUCKET_COUNT: Record<Granularity, number> = {
  day: 14,
  week: 8,
  month: 12,
  year: 5,
}

// ---------- 日付ユーティリティ ----------

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isoOf(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/** 'YYYY-MM-DD' の n 日後(負なら前)。月またぎ・年またぎ・うるう年は Date に任せる */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + n)
  return isoOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())
}

/** その日を含む週の日曜日。アプリのカレンダーが日曜始まりなので週の区切りも揃える */
export function startOfWeek(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = new Date(y, m - 1, d).getDay()
  return addDays(iso, -dow)
}

/** 'YYYY-MM' の n ヶ月後(負なら前) */
export function shiftMonth(monthKey: string, n: number): string {
  const [y, m] = monthKey.split('-').map(Number)
  const dt = new Date(y, m - 1 + n, 1)
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}`
}

/** 期間内のすべての日付を昇順で返す(両端を含む)。逆順の期間は空 */
export function enumerateDates(r: DateRange): string[] {
  if (r.start > r.end) return []
  const out: string[] = []
  let cursor = r.start
  // 壊れた入力で無限ループしないよう上限を置く(10年分)
  for (let i = 0; cursor <= r.end && i < 3700; i++) {
    out.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return out
}

// ---------- 日別合計 ----------

export interface DailyTotal {
  iso: string
  total: number
  count: number
}

/**
 * 期間内の日ごとの自分の実質支出。記録が無い日も 0 として並べる。(純粋関数)
 * 累積グラフ(026)・ヒートマップ(113)・日粒度のバケットの共通土台。
 */
export function dailyTotals(txs: readonly Transaction[], r: DateRange): DailyTotal[] {
  const acc = new Map<string, { total: number; count: number }>()
  for (const t of ownExpenses(txs, r)) {
    const cur = acc.get(t.date) ?? { total: 0, count: 0 }
    cur.total += ownAmount(t)
    cur.count += 1
    acc.set(t.date, cur)
  }
  return enumerateDates(r).map((iso) => ({
    iso,
    total: acc.get(iso)?.total ?? 0,
    count: acc.get(iso)?.count ?? 0,
  }))
}

// ---------- バケット ----------

export interface Bucket {
  key: string
  label: string
  start: string
  end: string
  total: number
  count: number
}

/**
 * 粒度と終端の日付から、集計対象の区間を古い順に並べて返す。(純粋関数)
 * 終端は「今日を含む区間」なので、進行中の週・月・年は途中までの合計になる
 * (画面側でその旨を明記すること)。
 */
export function bucketRanges(
  granularity: Granularity,
  anchor: string,
  count: number
): { key: string; label: string; start: string; end: string }[] {
  const n = Math.max(1, count)
  const out: { key: string; label: string; start: string; end: string }[] = []

  if (granularity === 'day') {
    for (let i = n - 1; i >= 0; i--) {
      const d = addDays(anchor, -i)
      const [, m, day] = d.split('-').map(Number)
      // 日は本数が多く軸ラベルが潰れるので日にちだけ。月が変わる1日にだけ月を付ける
      out.push({ key: d, label: day === 1 ? `${m}/1` : String(day), start: d, end: d })
    }
    return out
  }

  if (granularity === 'week') {
    const base = startOfWeek(anchor)
    for (let i = n - 1; i >= 0; i--) {
      const start = addDays(base, -7 * i)
      const [, m, day] = start.split('-').map(Number)
      out.push({ key: start, label: `${m}/${day}`, start, end: addDays(start, 6) })
    }
    return out
  }

  if (granularity === 'month') {
    const baseKey = anchor.slice(0, 7)
    for (let i = n - 1; i >= 0; i--) {
      const key = shiftMonth(baseKey, -i)
      const r = monthRange(key)
      out.push({ key, label: `${Number(key.slice(5, 7))}月`, start: r.start, end: r.end })
    }
    return out
  }

  const baseYear = Number(anchor.slice(0, 4))
  for (let i = n - 1; i >= 0; i--) {
    const y = baseYear - i
    out.push({ key: String(y), label: `${y}年`, start: `${y}-01-01`, end: `${y}-12-31` })
  }
  return out
}

/**
 * 粒度ごとの棒グラフ用データ。(純粋関数)
 * 終端(anchor)を含む区間までを古い順に返す。記録が無い区間も 0 で並ぶ。
 */
export function bucketSeries(
  txs: readonly Transaction[],
  granularity: Granularity,
  anchor: string,
  count: number = DEFAULT_BUCKET_COUNT[granularity]
): Bucket[] {
  const ranges = bucketRanges(granularity, anchor, count)
  if (ranges.length === 0) return []
  const window: DateRange = {
    start: ranges[0].start,
    end: ranges[ranges.length - 1].end,
  }
  const buckets: Bucket[] = ranges.map((r) => ({ ...r, total: 0, count: 0 }))

  for (const t of ownExpenses(txs, window)) {
    // 区間は連続しているので、後ろから最初に start 以上になったものが該当区間
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (t.date >= buckets[i].start) {
        if (t.date <= buckets[i].end) {
          buckets[i].total += ownAmount(t)
          buckets[i].count += 1
        }
        break
      }
    }
  }
  return buckets
}
