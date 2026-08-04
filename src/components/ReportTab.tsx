import { useMemo, useRef, useState } from 'react'
import type { Satisfaction, Transaction } from '../lib/types'
import {
  formatDate,
  formatMonth,
  monthKey,
  monthKeyOffset,
  shortMonth,
  signedYen,
  todayISO,
  yen,
} from '../lib/format'
import { categoryLabel } from '../lib/categories'
import {
  annualFromMonthly,
  annualFromRange,
  filterByRange,
  hourBandStats,
  lastYearMonth,
  monthRange,
  normalizeRange,
  rangeDays,
  rankByCategory,
  rankByStore,
  rankByTransaction,
  satisfactionSummary,
  totalOwn,
  totalPartner,
  weekdayStats,
} from '../lib/report'
import type { RankItem } from '../lib/report'
import {
  SATISFACTION_OPTIONS,
  pendingSatisfactionTargets,
  useSatisfactionAvailable,
} from '../lib/satisfaction'
import { useSwipeNav } from '../hooks/useSwipeNav'
import CategoryBars from './charts/CategoryBars'
import MonthlyTrend from './charts/MonthlyTrend'
import SatisfactionSortSheet from './SatisfactionSortSheet'
import VerticalBars from './charts/VerticalBars'

// 月表示と任意期間表示。任意期間では「前月比」「月次推移」のような
// 月を前提にした指標は意味をなさないので出さない
type PeriodMode = 'month' | 'range'
type RankKind = 'category' | 'store' | 'transaction'
type Metric = 'average' | 'total'

// 最初に見せる件数。それ以上は「もっと見る」で開く
const TOP_N = 5

interface ReportTabProps {
  transactions: Transaction[]
  /** 感情スタンプの付け直し(機能143)。列が無い環境では呼ばれない */
  onSetSatisfaction: (t: Transaction, value: Satisfaction) => Promise<void>
}

export default function ReportTab({ transactions, onSetSatisfaction }: ReportTabProps) {
  const today = todayISO()
  const currentMonth = monthKey(today)

  const [mode, setMode] = useState<PeriodMode>('month')
  const [month, setMonth] = useState(currentMonth)
  const [rangeStart, setRangeStart] = useState(monthRange(currentMonth).start)
  const [rangeEnd, setRangeEnd] = useState(today)
  const [rankKind, setRankKind] = useState<RankKind>('category')
  const [rankExpanded, setRankExpanded] = useState(false)
  const [storeExpanded, setStoreExpanded] = useState(false)
  const [metric, setMetric] = useState<Metric>('average')
  // スワイプ・月送りの向き。CSS のスライドイン方向に使う(reduced motion 時は CSS 側で無効)
  const [navDir, setNavDir] = useState<'prev' | 'next'>('next')
  // 感情スタンプ (機能219 + 143)
  const satisfactionAvailable = useSatisfactionAvailable()
  const [showSortSheet, setShowSortSheet] = useState(false)

  const swipeRef = useRef<HTMLDivElement>(null)

  const canNext = month < currentMonth
  const isCurrentMonth = month === currentMonth
  const prevYearMonth = lastYearMonth(month)

  // 日付入力は空にできる(iOS のクリアなど)。空のままだと日数計算が壊れるので今日で補う
  const range =
    mode === 'month'
      ? monthRange(month)
      : normalizeRange(rangeStart || rangeEnd || today, rangeEnd || rangeStart || today)
  const days = rangeDays(range)

  const goMonth = (offset: number) => {
    // 未来の月には進めない(既存の制約)。スワイプからも同じ関数を通す
    if (offset > 0 && !canNext) return
    setNavDir(offset > 0 ? 'next' : 'prev')
    setMonth(monthKeyOffset(month, offset))
  }

  const jumpTo = (target: string) => {
    setNavDir(target > month ? 'next' : 'prev')
    setMonth(target)
  }

  useSwipeNav(swipeRef, {
    onPrev: () => goMonth(-1),
    onNext: () => goMonth(1),
    enabled: mode === 'month',
  })

  // 集計は純粋関数(src/lib/report.ts)に任せ、ここでは表示の組み立てだけを行う
  const stats = useMemo(() => {
    const inRangeTx = filterByRange(transactions, range)
    return {
      isEmpty: inRangeTx.length === 0,
      total: totalOwn(transactions, range),
      partner: totalPartner(transactions, range),
      categories: rankByCategory(transactions, range, categoryLabel),
      stores: rankByStore(transactions, range),
      txRank: rankByTransaction(transactions, range),
      weekdays: weekdayStats(transactions, range),
      hours: hourBandStats(transactions, range),
      satisfaction: satisfactionSummary(transactions, range),
    }
  }, [transactions, range.start, range.end])

  // 仕分けの対象は期間に関係なく「まだ付いていない支出」全部(新しい順)
  const sortTargets = useMemo(
    () => (satisfactionAvailable ? pendingSatisfactionTargets(transactions) : []),
    [transactions, satisfactionAvailable]
  )

  // 前月比は月表示のときだけ意味を持つ
  const prevTotal = useMemo(
    () => (mode === 'month' ? totalOwn(transactions, monthRange(monthKeyOffset(month, -1))) : 0),
    [transactions, mode, month]
  )
  const delta = stats.total - prevTotal

  // 選択月まで直近6ヶ月の推移(月表示のみ)
  const trendData = useMemo(() => {
    if (mode !== 'month') return []
    return Array.from({ length: 6 }, (_, i) => {
      const key = monthKeyOffset(month, i - 5)
      return {
        label: shortMonth(key),
        value: totalOwn(transactions, monthRange(key)),
        isCurrent: key === month,
      }
    })
  }, [transactions, mode, month])

  // 年換算。月表示は12倍、任意期間は1日あたり×365(期間の長さに依存しない目安)
  const annualOf = (value: number) =>
    mode === 'month' ? annualFromMonthly(value) : annualFromRange(value, days)

  const rankItems: RankItem[] =
    rankKind === 'category'
      ? stats.categories
      : rankKind === 'store'
        ? stats.stores
        : stats.txRank
  const shownRank = rankExpanded ? rankItems : rankItems.slice(0, TOP_N)

  const shownStores = storeExpanded ? stats.stores : stats.stores.slice(0, TOP_N)

  // 「今月の」「2026年7月の」「この期間の」— 振り返りの文章に使う
  const periodLabel =
    mode === 'range' ? 'この期間' : isCurrentMonth ? '今月' : formatMonth(month)

  const weekdayData = stats.weekdays.map((d) => ({
    label: d.label,
    value: metric === 'average' ? d.average : d.total,
  }))
  const hourData = stats.hours.bands.map((b) => ({
    label: `${b.start}`,
    value: metric === 'average' ? b.average : b.total,
  }))
  const emphasizeMax = (data: { label: string; value: number }[]) => {
    const max = Math.max(...data.map((d) => d.value), 0)
    // 全部0のときにどれかを強調すると誤解を招くので、0より大きいときだけ印をつける
    return data.map((d) => ({ ...d, emphasis: max > 0 && d.value === max }))
  }

  // 121: カテゴリ別・店別の上位項目には年換算を副次的に添える。
  // 1件ごとの明細は繰り返し出ていく支出とは限らないので、年換算は出さない
  const rankSub = (item: RankItem, index: number) => {
    if (rankKind === 'transaction') {
      const t = stats.txRank[index]
      return `${formatDate(t.date)}・${categoryLabel(t.category)}`
    }
    return `${item.count}件・年 約${yen(annualOf(item.total))}`
  }

  return (
    <>
      {/* 期間の切り替え(月 / 任意期間) */}
      <div className="seg" role="group" aria-label="集計期間の種類">
        <button
          className={mode === 'month' ? 'active' : ''}
          aria-pressed={mode === 'month'}
          onClick={() => setMode('month')}
        >
          月で見る
        </button>
        <button
          className={mode === 'range' ? 'active' : ''}
          aria-pressed={mode === 'range'}
          onClick={() => setMode('range')}
        >
          期間で見る
        </button>
      </div>

      {mode === 'month' ? (
        <>
          <div className="month-nav">
            <button onClick={() => goMonth(-1)} aria-label="前の月">
              ←
            </button>
            {isCurrentMonth ? (
              // 今月を見ているときは押しても何も起きないので、ボタンにはしない
              <span className="title">{formatMonth(month)}</span>
            ) : (
              <button className="month-jump" onClick={() => jumpTo(currentMonth)}>
                <span className="title">{formatMonth(month)}</span>
                <span className="jump-hint">タップで今月へ</span>
              </button>
            )}
            <button onClick={() => goMonth(1)} disabled={!canNext} aria-label="次の月">
              →
            </button>
          </div>
          <div className="month-quick">
            <button className="btn-ghost" onClick={() => jumpTo(prevYearMonth)}>
              去年の同月({formatMonth(prevYearMonth)})
            </button>
          </div>
        </>
      ) : (
        <div className="card range-picker">
          <label className="field">
            <span>開始日</span>
            <input
              type="date"
              value={rangeStart}
              max={today}
              onChange={(e) => setRangeStart(e.target.value)}
            />
          </label>
          <label className="field">
            <span>終了日</span>
            <input
              type="date"
              value={rangeEnd}
              max={today}
              onChange={(e) => setRangeEnd(e.target.value)}
            />
          </label>
          <p className="muted range-summary">
            {formatDate(range.start)} 〜 {formatDate(range.end)}({days}日間)
          </p>
        </div>
      )}

      {/* スワイプ判定はこの外側の要素に付ける(中身は月ごとに差し替わるため) */}
      <div ref={swipeRef} className="report-swipe">
        <div
          key={mode === 'month' ? month : 'range'}
          className={`report-body slide-${navDir}`}
        >
          {stats.isEmpty ? (
            <div className="card empty-state">
              <p className="empty-title">この期間の記録はありません</p>
              <p className="muted">
                {mode === 'month'
                  ? `${formatMonth(month)}に記録された支出はまだありません。`
                  : '期間を変えるか、入力タブから記録してみてください。'}
              </p>
            </div>
          ) : (
            <>
              <div className="stat-row">
                <div className="card stat-tile">
                  <div className="label">
                    {mode === 'range'
                      ? '期間の支出'
                      : isCurrentMonth
                        ? '今月の支出'
                        : `${formatMonth(month)}の支出`}
                  </div>
                  <div className="value">{yen(stats.total)}</div>
                  {mode === 'month' && (
                    <div
                      className={`delta ${delta > 0 ? 'negative' : delta < 0 ? 'positive' : ''}`}
                    >
                      前月比 {signedYen(delta)}
                    </div>
                  )}
                  <div className="annual-note">年 約{yen(annualOf(stats.total))}</div>
                </div>
                <div className="card stat-tile">
                  <div className="label">彼女立替分</div>
                  <div className="value">{yen(stats.partner)}</div>
                  <div className="delta">預かり残高から差引</div>
                </div>
              </div>

              <div className="card">
                <h2>カテゴリ別支出</h2>
                <CategoryBars
                  data={stats.categories.map((c) => ({ label: c.label, value: c.total }))}
                />
              </div>

              {/* 109: お店(店名)別の集計 */}
              <div className="card">
                <h2>お店別支出</h2>
                <CategoryBars
                  ariaLabel="お店別支出"
                  data={shownStores.map((s) => ({ label: s.label, value: s.total }))}
                />
                {stats.stores.length > TOP_N && (
                  <button
                    className="more-btn"
                    onClick={() => setStoreExpanded(!storeExpanded)}
                  >
                    {storeExpanded ? '上位5件だけ表示' : `もっと見る(全${stats.stores.length}件)`}
                  </button>
                )}
              </div>

              {/* 112: 支出上位ランキング(カテゴリ / お店 / 1件ごと) */}
              <div className="card">
                <h2>支出上位ランキング</h2>
                <div className="seg seg-sm" role="group" aria-label="ランキングの切り口">
                  {(
                    [
                      ['category', 'カテゴリ別'],
                      ['store', 'お店別'],
                      ['transaction', '1件ごと'],
                    ] as [RankKind, string][]
                  ).map(([kind, label]) => (
                    <button
                      key={kind}
                      className={rankKind === kind ? 'active' : ''}
                      aria-pressed={rankKind === kind}
                      onClick={() => {
                        setRankKind(kind)
                        setRankExpanded(false)
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {shownRank.length === 0 ? (
                  <p className="muted">支出がありません</p>
                ) : (
                  <ol className="rank-list">
                    {shownRank.map((item, i) => (
                      <li key={item.key} className="rank-row">
                        <span className="rank-no">{i + 1}</span>
                        <span className="rank-body">
                          <span className="rank-label">{item.label}</span>
                          <span className="rank-sub">{rankSub(item, i)}</span>
                        </span>
                        <span className="rank-amount">{yen(item.total)}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {rankItems.length > TOP_N && (
                  <button className="more-btn" onClick={() => setRankExpanded(!rankExpanded)}>
                    {rankExpanded ? '上位5件だけ表示' : `もっと見る(全${rankItems.length}件)`}
                  </button>
                )}
              </div>

              {/* 117: 曜日別・時間帯別 */}
              <div className="card">
                <h2>曜日別の支出</h2>
                <div className="seg seg-sm" role="group" aria-label="曜日別・時間帯別の表示単位">
                  <button
                    className={metric === 'average' ? 'active' : ''}
                    aria-pressed={metric === 'average'}
                    onClick={() => setMetric('average')}
                  >
                    1日あたり平均
                  </button>
                  <button
                    className={metric === 'total' ? 'active' : ''}
                    aria-pressed={metric === 'total'}
                    onClick={() => setMetric('total')}
                  >
                    合計
                  </button>
                </div>
                <VerticalBars ariaLabel="曜日別の支出" data={emphasizeMax(weekdayData)} />
              </div>

              <div className="card">
                <h2>時間帯別の支出</h2>
                {/* 取引は日付しか持たないため、ここだけは「入力した時刻」の代用であることを明記する */}
                <p className="caveat">
                  記録した時刻(アプリに入力した時刻)をもとにした目安です。支出した時刻そのものではありません。
                  {stats.hours.unknownCount > 0 &&
                    `記録時刻が分からない${stats.hours.unknownCount}件は除いています。`}
                </p>
                <VerticalBars ariaLabel="時間帯別の支出(記録時刻ベース)" data={emphasizeMax(hourData)} />
                <p className="axis-note">横軸は時刻(日本時間・4時間ごと)</p>
              </div>

              {mode === 'month' && (
                <div className="card">
                  <h2>月次推移(直近6ヶ月)</h2>
                  <MonthlyTrend data={trendData} />
                </div>
              )}
            </>
          )}

          {/* 219 + 143: 感情スタンプの振り返り。既存のカードには手を触れず末尾に足す。
              曜日は date から正確に出せるが、時間帯は出さない
              (created_at は「記録した時刻」で、支出した時刻ではないため) */}
          {satisfactionAvailable &&
            (stats.satisfaction.stampedCount > 0 || sortTargets.length > 0) && (
              <div className="card sat-card">
                <h2>気分の振り返り</h2>
                {stats.satisfaction.regretCount > 0 ? (
                  <>
                    <p className="sat-lead">
                      {periodLabel}の後悔支出{' '}
                      <span className="sat-strong">
                        {stats.satisfaction.regretCount}件・{yen(stats.satisfaction.regretTotal)}
                      </span>
                    </p>
                    {stats.satisfaction.worstWeekday && (
                      <p className="sat-sub">
                        後悔が多いのは{' '}
                        <span className="sat-strong">
                          {stats.satisfaction.worstWeekday.label}曜日
                        </span>
                        ({stats.satisfaction.worstWeekday.count}件・
                        {yen(stats.satisfaction.worstWeekday.total)})
                      </p>
                    )}
                  </>
                ) : (
                  <p className="sat-lead">{periodLabel}に「後悔」は付いていません</p>
                )}

                {stats.satisfaction.stampedCount > 0 && (
                  <ul className="sat-counts">
                    {SATISFACTION_OPTIONS.map((o) => (
                      <li key={o.value} className="sat-count">
                        <span className="sat-count-emoji" aria-hidden="true">
                          {o.emoji}
                        </span>
                        <span className="sat-count-label">{o.label}</span>
                        <span className="sat-count-value">
                          {stats.satisfaction.counts[o.value]}件
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {sortTargets.length > 0 && (
                  <button className="btn-ghost sat-sort-btn" onClick={() => setShowSortSheet(true)}>
                    まだ気分が付いていない{sortTargets.length}件を仕分ける
                  </button>
                )}
                <p className="caveat">
                  曜日は記録の日付から出しています。支出した時刻は持っていないため、時間帯は出していません。
                </p>
              </div>
            )}
        </div>
      </div>

      {showSortSheet && (
        <SatisfactionSortSheet
          targets={sortTargets}
          onAssign={onSetSatisfaction}
          onClose={() => setShowSortSheet(false)}
        />
      )}
    </>
  )
}
