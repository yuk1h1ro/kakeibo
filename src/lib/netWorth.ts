// ============================================================
// 純資産(資産合計 − 負債合計)の集計 (機能101)
//
// report.ts と同じ方針で、UI からも Supabase からも切り離した純粋関数だけを置く。
// React にも DOM にも依存しないのでテストが書ける。
//
// 設計の前提:
// - 金額はすべて「円」の整数。小数を一切持たないので丸め誤差が出ない
//   (グラフの目盛りラベルだけは表示のために丸めるが、値そのものは触らない)。
// - 負債は「残債」を正の数で持ち、純資産を出すときにだけ符号を反転する。
//   入力欄で符号を意識せずに済み、「残債 -50,000 円」のような二重否定を避けられる。
// - 残高は「スナップショット」(その日にいくらだったか)であって取引ではない。
//   月1回程度の記録を想定しているので、記録が無い日は直前の記録を持ち越す。
//   持ち越さないと「入力しなかった月だけ純資産が0に落ちる」グラフになってしまう。
// ============================================================

import type { AssetDef, BalanceSnapshot } from './assets'
import { monthEndISO, shiftMonth } from './calendar'

/** ある基準日時点の純資産 */
export interface NetWorthPoint {
  /** 基準日 'YYYY-MM-DD' */
  asOf: string
  totalAssets: number
  totalLiabilities: number
  /** 資産合計 − 負債合計。マイナスにもなる */
  netWorth: number
}

/** 資産1件の「基準日時点の残高」と「その資産の前回記録からの増減」 */
export interface AssetRow {
  asset: AssetDef
  /** 基準日時点の残高。まだ一度も記録していなければ null */
  balance: number | null
  /** その資産の前回記録からの増減。比較できる記録が無ければ null */
  delta: number | null
  /** 採用した残高を記録した日。まだ記録が無ければ null */
  recordedOn: string | null
}

// ---------- 日付ユーティリティ ----------
// 'YYYY-MM-DD' は辞書順と時系列が一致するので、比較は文字列のままで行う
// (Date にすると TZ でずれるため、report.ts と同じく必要なときだけ組み立てる)。

/** 'YYYY-MM' の月キー */
export function monthOf(iso: string): string {
  return iso.slice(0, 7)
}

/** 日数の差(from → to)。夏時間の無い日本でも安全側に倒して UTC で引く */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number)
  const [y2, m2, d2] = to.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

// ---------- 残高の解決 ----------

/**
 * b のほうが a より新しい記録か。
 * 同じ日に何度も更新したときは作成時刻の遅いほうを採用する
 * (DB 側は (asset_id, as_of) の一意制約で上書きしているが、
 *  キャッシュや取得順の都合で同じ日の行が複数並ぶことがあるため、
 *  集計側でも「同日は後勝ち」を保証しておく)。
 */
function isNewer(b: BalanceSnapshot, a: BalanceSnapshot): boolean {
  if (b.asOf !== a.asOf) return b.asOf > a.asOf
  return b.createdAt >= a.createdAt
}

/** 基準日以前で最も新しい残高。1件も無ければ null */
export function latestBalanceAsOf(
  balances: readonly BalanceSnapshot[],
  assetId: string,
  asOf: string
): BalanceSnapshot | null {
  let best: BalanceSnapshot | null = null
  for (const b of balances) {
    if (b.assetId !== assetId || b.asOf > asOf) continue
    if (best === null || isNewer(b, best)) best = b
  }
  return best
}

/** その資産の記録を古い順に並べる(同日は後勝ちで1件に畳む) */
export function balanceHistory(
  balances: readonly BalanceSnapshot[],
  assetId: string
): BalanceSnapshot[] {
  const byDate = new Map<string, BalanceSnapshot>()
  for (const b of balances) {
    if (b.assetId !== assetId) continue
    const cur = byDate.get(b.asOf)
    if (!cur || isNewer(b, cur)) byDate.set(b.asOf, b)
  }
  return [...byDate.values()].sort((x, y) => (x.asOf < y.asOf ? -1 : x.asOf > y.asOf ? 1 : 0))
}

/** 集計に使う資産(アーカイブ済みは除く)。表示順もここで固定する */
export function activeAssets(assets: readonly AssetDef[]): AssetDef[] {
  return assets
    .filter((a) => !a.archived)
    .sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name, 'ja'))
}

// ---------- 純資産 ----------

/**
 * 基準日時点の純資産。
 * 記録がまだ無い資産は 0 として扱う(「持っているが未記録」を勝手に推測しない)。
 */
export function netWorthAt(
  assets: readonly AssetDef[],
  balances: readonly BalanceSnapshot[],
  asOf: string
): NetWorthPoint {
  let totalAssets = 0
  let totalLiabilities = 0
  for (const a of activeAssets(assets)) {
    const snap = latestBalanceAsOf(balances, a.id, asOf)
    if (!snap) continue
    if (a.kind === 'liability') totalLiabilities += snap.balance
    else totalAssets += snap.balance
  }
  return { asOf, totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities }
}

/** 残高を記録した日(アーカイブ済みの資産は除く)を古い順・重複なしで返す */
export function recordDates(
  assets: readonly AssetDef[],
  balances: readonly BalanceSnapshot[]
): string[] {
  const alive = new Set(activeAssets(assets).map((a) => a.id))
  const dates = new Set<string>()
  for (const b of balances) if (alive.has(b.assetId)) dates.add(b.asOf)
  return [...dates].sort()
}

export interface NetWorthChange {
  current: NetWorthPoint
  /** 前回記録した日の純資産。比較できる記録が無ければ null */
  previous: NetWorthPoint | null
  /** 前回からの増減。previous が無ければ null */
  delta: number | null
  /** 最後に残高を記録した日 */
  lastRecordedOn: string | null
  /** 最後の記録から何日経ったか。記録が無ければ null */
  daysSinceLastRecord: number | null
}

/**
 * 今日時点の純資産と、前回記録した日からの増減。
 * 「前回」は日付が違う直近の記録日なので、同じ日に何度更新しても増減はぶれない。
 */
export function netWorthChange(
  assets: readonly AssetDef[],
  balances: readonly BalanceSnapshot[],
  today: string
): NetWorthChange {
  const dates = recordDates(assets, balances).filter((d) => d <= today)
  const last = dates.length > 0 ? dates[dates.length - 1] : null
  const prev = dates.length > 1 ? dates[dates.length - 2] : null
  const current = netWorthAt(assets, balances, today)
  const previous = prev ? netWorthAt(assets, balances, prev) : null
  return {
    current,
    previous,
    delta: previous ? current.netWorth - previous.netWorth : null,
    lastRecordedOn: last,
    daysSinceLastRecord: last ? daysBetween(last, today) : null,
  }
}

export interface MonthlyNetWorth extends NetWorthPoint {
  /** 'YYYY-MM' */
  month: string
}

/**
 * 月末時点の純資産の推移。
 * 最初の記録がある月から今月まで(最大 maxMonths ヶ月)を、記録の無い月も
 * 直前の残高を持ち越して埋める。月1回の記録でも線が途切れないようにするため。
 */
export function monthlyNetWorthSeries(
  assets: readonly AssetDef[],
  balances: readonly BalanceSnapshot[],
  today: string,
  maxMonths = 12
): MonthlyNetWorth[] {
  const dates = recordDates(assets, balances)
  if (dates.length === 0) return []
  const firstMonth = monthOf(dates[0])
  // 未来日で記録された残高があっても、その月まで伸ばして見えるようにする
  const lastMonth = [monthOf(today), monthOf(dates[dates.length - 1])].sort().pop() as string
  const startFloor = shiftMonth(lastMonth, -(maxMonths - 1))
  const start = firstMonth > startFloor ? firstMonth : startFloor

  const out: MonthlyNetWorth[] = []
  for (let m = start; m <= lastMonth; m = shiftMonth(m, 1)) {
    const point = netWorthAt(assets, balances, monthEndISO(m))
    out.push({ month: m, ...point })
    // 想定外の入力で無限ループにならないよう上限を切る
    if (out.length >= maxMonths) break
  }
  return out
}

/** 資産・負債の一覧(基準日時点の残高と前回比つき) */
export function assetRows(
  assets: readonly AssetDef[],
  balances: readonly BalanceSnapshot[],
  asOf: string
): AssetRow[] {
  return activeAssets(assets).map((asset) => {
    const history = balanceHistory(balances, asset.id).filter((b) => b.asOf <= asOf)
    const last = history.length > 0 ? history[history.length - 1] : null
    const prev = history.length > 1 ? history[history.length - 2] : null
    return {
      asset,
      balance: last ? last.balance : null,
      delta: last && prev ? last.balance - prev.balance : null,
      recordedOn: last ? last.asOf : null,
    }
  })
}

// ---------- 入力・表示のための純粋関数 ----------

// 残高の桁数の上限。1兆円(13桁)を超える入力は打ち間違いとみなす。
// Number.MAX_SAFE_INTEGER(約9千兆)よりずっと小さいので、整数のまま安全に扱える。
const MAX_BALANCE_DIGITS = 13

/**
 * 入力欄の文字列を残高(円・整数)に直す。(純粋関数)
 * - カンマ・空白・「円」などの余分な文字は捨てる(貼り付け対策)
 * - 全角数字は半角に寄せる
 * - 先頭に - があればマイナス(証券のマイナス評価や、払いすぎた負債のため)
 * - 空欄・数字が1つも無い場合は null(= 未入力。0 とは区別する)
 */
export function parseBalanceInput(text: string): number | null {
  const s = text.normalize('NFKC')
  const negative = /^\s*[-−]/.test(s)
  const digits = s.replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '').slice(0, MAX_BALANCE_DIGITS)
  if (digits === '') return null
  const n = Number(digits)
  return negative ? -n : n
}

/** 残高を入力欄用の3桁区切り文字列にする。(純粋関数) */
export function formatBalanceInput(value: number | null): string {
  if (value === null) return ''
  const negative = value < 0
  const grouped = Math.abs(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return negative ? `-${grouped}` : grouped
}

/**
 * グラフの目盛り用の短い表記。(純粋関数)
 * 桁が大きいと軸ラベルが場所を食って横に溢れるので、1万円以上は「万」でまとめる。
 * 表示専用で、集計に使う値は常に円の整数のまま。
 */
export function compactYen(value: number): string {
  if (Math.abs(value) < 10_000) return value.toLocaleString('ja-JP')
  const man = Math.round(value / 10_000)
  return `${man.toLocaleString('ja-JP')}万`
}
