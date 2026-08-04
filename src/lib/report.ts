// レポート画面の集計ロジック(純粋関数)。
// UI から切り離してテストできるよう、React にも DOM にも依存させない。
// 日付は 'YYYY-MM-DD' の文字列で扱い、Date は「曜日」「日数差」を出すときだけ
// ローカルタイムで組み立てて使う(toISOString を使うと TZ でずれるため)。

import type { Satisfaction, Transaction } from './types'
import { ownAmount, satisfactionOf } from './types'
import { WEEKDAY_LABELS } from './calendar'

/** 両端を含む期間 */
export interface DateRange {
  start: string // 'YYYY-MM-DD'
  end: string // 'YYYY-MM-DD'
}

/** 店名が空の記録をまとめる見出し */
export const NO_STORE_LABEL = '店名なし'

// ---------- 期間 ----------

/** 'YYYY-MM' の月キーからその月全体の期間を作る */
export function monthRange(month: string): DateRange {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y, m, 0).getDate() // 翌月0日 = 当月末日(うるう年も正しく出る)
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` }
}

/** 開始・終了が逆でも破綻しないよう並べ替える(日付入力は自由に触れるため) */
export function normalizeRange(start: string, end: string): DateRange {
  return start <= end ? { start, end } : { start: end, end: start }
}

/**
 * 1年前の同じ月キー。月の数字はそのままなので、うるう年の2月から遡っても
 * 「2月」に着地する(日数は monthRange 側が月ごとに正しく出す)。
 */
export function lastYearMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${y - 1}-${String(m).padStart(2, '0')}`
}

export function inRange(iso: string, r: DateRange): boolean {
  return iso >= r.start && iso <= r.end
}

/** 期間の日数(両端を含む)。1日あたり平均や年換算の分母に使う */
export function rangeDays(r: DateRange): number {
  const [y1, m1, d1] = r.start.split('-').map(Number)
  const [y2, m2, d2] = r.end.split('-').map(Number)
  // 夏時間の無い日本でも安全側に倒して UTC の一日=86400000ms で差を取る
  const diff = Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)
  return Math.max(Math.round(diff / 86_400_000) + 1, 1)
}

/** 'YYYY-MM-DD' の曜日(0=日) */
export function dayOfWeek(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

/** 期間内の取引(種別を問わない) */
export function filterByRange(txs: readonly Transaction[], r: DateRange): Transaction[] {
  return txs.filter((t) => inRange(t.date, r))
}

/** 期間内で自分が実際に負担した支出のみ(彼女が全額負担した行は 0 円なので除く) */
export function ownExpenses(txs: readonly Transaction[], r: DateRange): Transaction[] {
  return txs.filter((t) => t.type === 'expense' && inRange(t.date, r) && ownAmount(t) > 0)
}

/** 期間内の自分の実質支出の合計 */
export function totalOwn(txs: readonly Transaction[], r: DateRange): number {
  return filterByRange(txs, r).reduce((sum, t) => sum + ownAmount(t), 0)
}

/** 期間内の彼女負担分の合計 */
export function totalPartner(txs: readonly Transaction[], r: DateRange): number {
  return filterByRange(txs, r)
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.partner_amount, 0)
}

// ---------- ランキング(カテゴリ別・お店別・1件ごと) ----------

export interface RankItem {
  key: string // 同着の並びを安定させるための一意キー
  label: string
  total: number
  count: number
}

// 同額のときに並びがブレると「順位が入れ替わった」ように見えるので、
// 金額 → 件数 → キーの順で必ず決まる比較にする(localeCompare は環境差があるため使わない)
function compareRank(a: RankItem, b: RankItem): number {
  if (b.total !== a.total) return b.total - a.total
  if (b.count !== a.count) return b.count - a.count
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

// お店別・カテゴリ別の共通処理。束ねるキーと表示名の付け方だけを差し替える
function rankBy(
  txs: readonly Transaction[],
  r: DateRange,
  keyOf: (t: Transaction) => string,
  labelOf: (key: string) => string
): RankItem[] {
  const acc = new Map<string, RankItem>()
  for (const t of ownExpenses(txs, r)) {
    const key = keyOf(t)
    const item = acc.get(key) ?? { key, label: labelOf(key), total: 0, count: 0 }
    item.total += ownAmount(t)
    item.count += 1
    acc.set(key, item)
  }
  return [...acc.values()].sort(compareRank)
}

/** お店(店名)別の集計。store が空の記録は「店名なし」に束ねる */
export function rankByStore(txs: readonly Transaction[], r: DateRange): RankItem[] {
  return rankBy(
    txs,
    r,
    (t) => t.store.trim(),
    (key) => (key === '' ? NO_STORE_LABEL : key)
  )
}

/** カテゴリ別の集計。表示名の解決は呼び出し側(カテゴリ設定を持つ層)に任せる */
export function rankByCategory(
  txs: readonly Transaction[],
  r: DateRange,
  labelOf: (id: string | null) => string
): RankItem[] {
  return rankBy(
    txs,
    r,
    (t) => t.category ?? '',
    (key) => labelOf(key === '' ? null : key)
  )
}

export interface TxRankItem extends RankItem {
  date: string
  store: string
  memo: string
  category: string | null
}

/** 1件ごとの高額順。同額なら新しい記録を先に出す(直近の出費のほうが関心が高い) */
export function rankByTransaction(txs: readonly Transaction[], r: DateRange): TxRankItem[] {
  return ownExpenses(txs, r)
    .map((t) => ({
      key: t.id,
      label: t.store.trim() || t.memo.trim() || NO_STORE_LABEL,
      total: ownAmount(t),
      count: 1,
      date: t.date,
      store: t.store.trim(),
      memo: t.memo.trim(),
      category: t.category,
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total
      if (b.date !== a.date) return b.date < a.date ? -1 : 1
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
    })
}

// ---------- 曜日別 ----------

export interface WeekdayStat {
  dow: number // 0=日
  label: string // '日'〜'土'
  total: number
  days: number // 期間内にその曜日が何日あったか
  average: number // 1日あたり平均(その曜日が0日なら0)
}

/** 曜日別の合計と1日あたり平均。日付から正確に出せる */
export function weekdayStats(txs: readonly Transaction[], r: DateRange): WeekdayStat[] {
  const totals = new Array(7).fill(0) as number[]
  for (const t of ownExpenses(txs, r)) {
    totals[dayOfWeek(t.date)] += ownAmount(t)
  }

  // 期間内の曜日の出現回数。開始曜日から順に数えれば日付を1日ずつ作らなくて済む
  const counts = new Array(7).fill(0) as number[]
  const startDow = dayOfWeek(r.start)
  const days = rangeDays(r)
  for (let i = 0; i < days; i++) counts[(startDow + i) % 7] += 1

  return totals.map((total, dow) => ({
    dow,
    label: WEEKDAY_LABELS[dow],
    total,
    days: counts[dow],
    average: counts[dow] > 0 ? Math.round(total / counts[dow]) : 0,
  }))
}

// ---------- 時間帯別 ----------
// 注意: 取引は日付しか持たず「支出した時刻」は分からない。ここで使う created_at は
// 「アプリに入力した時刻」なので、あくまで目安。画面側でもその旨を明記すること。

/** 時間帯の刻み(時間)。4時間×6本ならスマホ幅でもラベルが潰れない */
export const HOUR_BAND_SIZE = 4

export interface HourBandStat {
  start: number // 帯の開始時刻(0,4,8,...)
  label: string // '0-4時'
  total: number
  count: number
  average: number // 1日あたり平均(期間の日数で割る。各帯は1日に1回来るため)
}

export interface HourBandResult {
  bands: HourBandStat[]
  /** 記録時刻が読み取れず集計から外した件数(古い行など) */
  unknownCount: number
}

/**
 * created_at(UTC の ISO 文字列)から日本時間の「時」を取り出す。
 * Date の文字列解釈はブラウザ差があるので自前で解析し、
 * タイムゾーン指定が無い文字列は UTC とみなす(Supabase の timestamptz は UTC で返る)。
 */
export function jstHour(createdAt: string | null | undefined): number | null {
  if (!createdAt) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(
    createdAt.trim()
  )
  if (!m) return null
  const hour = Number(m[4])
  const minute = Number(m[5])
  let offsetMin = 0 // 文字列自身のUTCからのずれ(分)
  const tz = m[7]
  if (tz && tz !== 'Z') {
    const sign = tz[0] === '-' ? -1 : 1
    const digits = tz.slice(1).replace(':', '')
    offsetMin = sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)))
  }
  // いったんUTCの分に直してから +9時間(JST)。日をまたいでも 24 で丸めれば時だけは正しい
  const utcMinutes = hour * 60 + minute - offsetMin
  const jstMinutes = ((utcMinutes + 9 * 60) % 1440 + 1440) % 1440
  return Math.floor(jstMinutes / 60)
}

/** 時間帯別(記録時刻ベース)の合計と1日あたり平均 */
export function hourBandStats(txs: readonly Transaction[], r: DateRange): HourBandResult {
  const bandCount = 24 / HOUR_BAND_SIZE
  const totals = new Array(bandCount).fill(0) as number[]
  const counts = new Array(bandCount).fill(0) as number[]
  let unknownCount = 0

  for (const t of ownExpenses(txs, r)) {
    const h = jstHour(t.created_at)
    if (h === null) {
      unknownCount += 1
      continue
    }
    const band = Math.floor(h / HOUR_BAND_SIZE)
    totals[band] += ownAmount(t)
    counts[band] += 1
  }

  const days = rangeDays(r)
  return {
    bands: totals.map((total, i) => {
      const start = i * HOUR_BAND_SIZE
      return {
        start,
        label: `${start}-${start + HOUR_BAND_SIZE}時`,
        total,
        count: counts[i],
        average: Math.round(total / days),
      }
    }),
    unknownCount,
  }
}

// ---------- 感情スタンプ (機能219 + 143) ----------
// 曜日は date から正確に出せる。時間帯は出さない —
// created_at は「記録した時刻」であって「支出した時刻」ではないため。

export interface RegretWeekday {
  dow: number // 0=日
  label: string
  count: number
  total: number
}

export interface SatisfactionSummary {
  /** スタンプ別の件数(未設定を含む) */
  counts: Record<Satisfaction | 'unset', number>
  regretCount: number
  regretTotal: number
  /** スタンプが付いている支出の件数(0 なら振り返りを出す意味がない) */
  stampedCount: number
  /** 後悔がいちばん多い曜日。後悔が1件も無ければ null */
  worstWeekday: RegretWeekday | null
}

/** 期間内の支出を感情スタンプで集計する。金額は自分の実質支出で数える */
export function satisfactionSummary(
  txs: readonly Transaction[],
  r: DateRange
): SatisfactionSummary {
  const counts: Record<Satisfaction | 'unset', number> = {
    good: 0,
    neutral: 0,
    regret: 0,
    unset: 0,
  }
  let regretTotal = 0
  const byDow: RegretWeekday[] = WEEKDAY_LABELS.map((label, dow) => ({
    dow,
    label,
    count: 0,
    total: 0,
  }))

  for (const t of ownExpenses(txs, r)) {
    const s = satisfactionOf(t)
    counts[s ?? 'unset'] += 1
    if (s !== 'regret') continue
    regretTotal += ownAmount(t)
    const d = byDow[dayOfWeek(t.date)]
    d.count += 1
    d.total += ownAmount(t)
  }

  // 件数 → 金額 → 曜日順で必ず決まる比較にする(同数のときに並びがブレないように)
  const worst = byDow
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count || b.total - a.total || a.dow - b.dow)[0]

  return {
    counts,
    regretCount: counts.regret,
    regretTotal,
    stampedCount: counts.good + counts.neutral + counts.regret,
    worstWeekday: worst ?? null,
  }
}

// ---------- 年換算 ----------

/** 月額の年換算。月表示のときは素直に12倍するのが実感に合う */
export function annualFromMonthly(monthlyTotal: number): number {
  return monthlyTotal * 12
}

/** 任意期間の年換算。1日あたりに直して365倍する(期間の長さに依存しない目安) */
export function annualFromRange(total: number, days: number): number {
  if (days <= 0) return 0
  return Math.round((total / days) * 365)
}
