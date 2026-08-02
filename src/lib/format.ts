export function yen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`
}

export function signedYen(n: number): string {
  return n >= 0 ? `+${yen(n)}` : `-${yen(Math.abs(n))}`
}

// 'YYYY-MM-DD' → 'M月D日(曜)'
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const day = new Date(y, m - 1, d).getDay()
  const wd = ['日', '月', '火', '水', '木', '金', '土'][day]
  return `${m}月${d}日(${wd})`
}

// ローカルタイムの今日を 'YYYY-MM-DD' で返す
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ローカルタイムで n 日前の日付を 'YYYY-MM-DD' で返す(タイムゾーンのずれを避けるため年月日から組み立てる)
export function daysAgoISO(n: number): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 'YYYY-MM' 形式の月キー
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${y}年${m}月`
}

export function shortMonth(key: string): string {
  return `${Number(key.split('-')[1])}月`
}

// 現在月から n ヶ月前の月キー
export function monthKeyOffset(base: string, offset: number): string {
  const [y, m] = base.split('-').map(Number)
  const d = new Date(y, m - 1 + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
