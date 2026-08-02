// カレンダー表示用の純粋関数(format.ts は変更禁止のためここに置く)
// すべてローカルタイムで処理し、toISOString は使わない(TZずれ防止)

export interface CalendarDay {
  iso: string // 'YYYY-MM-DD'
  day: number // 1〜31
  dow: number // 0(日)〜6(土)
}

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

// 'YYYY-MM' の月キーから、日曜始まりの週配列(最大6週)を作る。
// 当月以外のセルは null(前後月の日付は表示しない)。
export function monthWeeks(month: string): (CalendarDay | null)[][] {
  const [y, m] = month.split('-').map(Number)
  const firstDow = new Date(y, m - 1, 1).getDay()
  const daysInMonth = new Date(y, m, 0).getDate()

  const cells: (CalendarDay | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      iso: `${month}-${String(d).padStart(2, '0')}`,
      day: d,
      dow: (firstDow + d - 1) % 7,
    })
  }
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks: (CalendarDay | null)[][] = []
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }
  return weeks
}

// 月切替時の初期選択日: 当月なら今日、他の月なら記録のある最も新しい日、なければ1日
export function defaultSelectedDate(
  month: string,
  txDates: readonly string[],
  todayIso: string
): string {
  if (todayIso.slice(0, 7) === month) return todayIso
  let latest: string | null = null
  for (const d of txDates) {
    if (d.slice(0, 7) === month && (latest === null || d > latest)) latest = d
  }
  return latest ?? `${month}-01`
}
