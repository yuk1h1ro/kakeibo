// ============================================================
// 繰り返し(定期)入力の日付計算 (機能070)
//
// サーバー側の cron が使えないので、アプリを開いたときに
// 「前回生成した日の翌日〜今日」の該当日をまとめて求めて生成する。
// 重複生成すると家計が狂うため、境界の扱いはここに閉じ込めて単体テストする。
// すべてローカルタイムの 'YYYY-MM-DD' 文字列で扱い、toISOString は使わない。
// ============================================================

import { daysInMonth } from './calendar'

export type RecurrenceKind = 'monthly' | 'weekly' | 'yearly'

export interface Recurrence {
  kind: RecurrenceKind
  /** monthly / yearly の日にち (1〜31)。weekly では未使用 */
  dayOfMonth: number | null
  /** weekly の曜日 (0=日 〜 6=土)。monthly / yearly では未使用 */
  weekday: number | null
  /** yearly の月 (1〜12)。monthly / weekly では未使用 */
  monthOfYear: number | null
}

export const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'] as const

/** 壊れたデータで無限ループしないための上限。通常の運用では到達しない */
const MAX_OCCURRENCES = 2000

// ---------- 日付文字列のユーティリティ ----------

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isValidISODate(iso: string): boolean {
  const m = ISO_RE.exec(iso)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12) return false
  return d >= 1 && d <= daysInMonth(y, mo)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/** 'YYYY-MM-DD' の翌日 */
export function nextDay(isoDate: string): string {
  const m = ISO_RE.exec(isoDate)
  if (!m) return isoDate
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1)
  return iso(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/** 'YYYY-MM-DD' の曜日 (0=日 〜 6=土)。不正な文字列なら null */
export function weekdayOf(isoDate: string): number | null {
  const m = ISO_RE.exec(isoDate)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()
}

// ---------- 該当日の列挙 ----------

/**
 * 指定された日にちをその月に落とし込む。
 * 「毎月31日」を2月に適用するようなときは、その月の末日に丸める
 * (スキップすると2月だけ家賃が記録されないことになり、実態に合わないため)。
 */
function clampDayToMonth(year: number, month: number, day: number): number {
  return Math.min(day, daysInMonth(year, month))
}

function isValidRecurrence(rec: Recurrence): boolean {
  if (rec.kind === 'weekly') {
    return rec.weekday !== null && rec.weekday >= 0 && rec.weekday <= 6
  }
  if (rec.dayOfMonth === null || rec.dayOfMonth < 1 || rec.dayOfMonth > 31) return false
  if (rec.kind === 'yearly') {
    return rec.monthOfYear !== null && rec.monthOfYear >= 1 && rec.monthOfYear <= 12
  }
  return true
}

/**
 * from〜to(両端を含む)に該当する日付を昇順で返す。(純粋関数)
 * 範囲が逆・設定が不正なら空配列。
 */
export function occurrencesBetween(rec: Recurrence, from: string, to: string): string[] {
  if (!isValidISODate(from) || !isValidISODate(to)) return []
  if (from > to) return []
  if (!isValidRecurrence(rec)) return []

  const out: string[] = []
  const [fy, fm] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))]
  const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))]

  if (rec.kind === 'weekly') {
    const target = rec.weekday as number
    const startDow = weekdayOf(from)
    if (startDow === null) return []
    // from 以降で最初に該当する日まで進めてから1週間ずつ
    let cursor = from
    for (let i = (target - startDow + 7) % 7; i > 0; i--) cursor = nextDay(cursor)
    while (cursor <= to && out.length < MAX_OCCURRENCES) {
      out.push(cursor)
      for (let i = 0; i < 7; i++) cursor = nextDay(cursor)
    }
    return out
  }

  if (rec.kind === 'monthly') {
    const day = rec.dayOfMonth as number
    let y = fy
    let m = fm
    while ((y < ty || (y === ty && m <= tm)) && out.length < MAX_OCCURRENCES) {
      const candidate = iso(y, m, clampDayToMonth(y, m, day))
      if (candidate >= from && candidate <= to) out.push(candidate)
      m += 1
      if (m > 12) {
        m = 1
        y += 1
      }
    }
    return out
  }

  // yearly
  const month = rec.monthOfYear as number
  const day = rec.dayOfMonth as number
  for (let y = fy; y <= ty && out.length < MAX_OCCURRENCES; y++) {
    const candidate = iso(y, month, clampDayToMonth(y, month, day))
    if (candidate >= from && candidate <= to) out.push(candidate)
  }
  return out
}

/** 指定日以降(当日を含む)で最初に該当する日。1年以上先に無ければ null。(純粋関数) */
export function nextOccurrenceOnOrAfter(rec: Recurrence, from: string): string | null {
  if (!isValidISODate(from)) return null
  // 年次でも必ず1回は含まれるように2年分先まで見る
  const [y, m, d] = from.split('-').map(Number)
  const limit = new Date(y + 2, m - 1, d)
  const to = iso(limit.getFullYear(), limit.getMonth() + 1, limit.getDate())
  return occurrencesBetween(rec, from, to)[0] ?? null
}

// ---------- 未生成分の算出(重複生成の防止) ----------

/** 生成の判断に必要な最小限の形。ストア側の型はこれを満たす */
export interface RecurringSchedule {
  active: boolean
  recurrence: Recurrence
  /** この日から生成を始める */
  startDate: string
  /** 「この日までは生成済み」。未生成なら null */
  lastGeneratedDate: string | null
}

/**
 * まだ生成していない該当日を求める。(純粋関数)
 *
 * 開始位置は「最後に生成した日の翌日」— 同じ日を二度生成しないための要。
 * 停止中・開始日が未来・生成済みが今日以降の場合は何も返さない。
 * 端末の時計が巻き戻った場合も lastGeneratedDate > today なので空になる。
 */
export function pendingOccurrences(schedule: RecurringSchedule, today: string): string[] {
  if (!schedule.active) return []
  if (!isValidISODate(today) || !isValidISODate(schedule.startDate)) return []
  const last = schedule.lastGeneratedDate
  const fromByLast = last !== null && isValidISODate(last) ? nextDay(last) : null
  // 開始日より前には遡らない。生成済みの翌日と開始日の、遅い方から始める
  const from = fromByLast !== null && fromByLast > schedule.startDate ? fromByLast : schedule.startDate
  if (from > today) return []
  return occurrencesBetween(schedule.recurrence, from, today)
}

// ---------- 表示用 ----------

/** 「毎月25日」「毎週金曜」「毎年3月1日」の形にする。(純粋関数) */
export function describeRecurrence(rec: Recurrence): string {
  if (!isValidRecurrence(rec)) return '設定が不正です'
  if (rec.kind === 'weekly') return `毎週${WEEKDAY_NAMES[rec.weekday as number]}曜`
  if (rec.kind === 'monthly') return `毎月${rec.dayOfMonth}日`
  return `毎年${rec.monthOfYear}月${rec.dayOfMonth}日`
}
