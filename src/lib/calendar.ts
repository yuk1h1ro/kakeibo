// 日付の基礎計算と、カレンダー表示用の純粋関数。
// すべてローカルタイムで処理し、toISOString は使わない(TZずれ防止)。
//
// 月末日・曜日・月キーのずらしは report / netWorth / recurrence / historyFilter などに
// 同じ式が散らばっていたので、ここ1箇所に集めた。同じ数字が別々の式から出てくると、
// 片方だけ直したときに取り違えても気づけず、ずれるのが家計の数字になるため。
// 循環 import を避けるため、このファイルからは他の lib を import しない。

export interface CalendarDay {
  iso: string // 'YYYY-MM-DD'
  day: number // 1〜31
  dow: number // 0(日)〜6(土)
}

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

// ---------- 日付の基礎計算 ----------

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** その年月の日数。Date の「翌月0日 = 当月末日」を使うので、うるう年も正しく出る */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

/** 'YYYY-MM' の月末日を 'YYYY-MM-DD' で返す(うるう年も正しく出る) */
export function monthEndISO(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${pad2(daysInMonth(y, m))}`
}

/** 'YYYY-MM-DD' の曜日 (0=日 〜 6=土)。WEEKDAY_LABELS の添字にそのまま使える */
export function dayOfWeek(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/**
 * 月キーを offset ヶ月ずらす('YYYY-MM' → 'YYYY-MM')。
 * 日を1日に固定してから Date に渡すので、「1月31日の1ヶ月後」のような
 * 日にちのはみ出し(3月3日に飛ぶ)は起きない。年またぎは Date に任せる。
 */
export function shiftMonth(month: string, offset: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + offset, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}

// ---------- カレンダー表示 ----------

// 'YYYY-MM' の月キーから、日曜始まりの週配列(最大6週)を作る。
// 当月以外のセルは null(前後月の日付は表示しない)。
export function monthWeeks(month: string): (CalendarDay | null)[][] {
  const [y, m] = month.split('-').map(Number)
  const firstDow = dayOfWeek(`${month}-01`)
  const lastDay = daysInMonth(y, m)

  const cells: (CalendarDay | null)[] = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= lastDay; d++) {
    cells.push({
      iso: `${month}-${pad2(d)}`,
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
