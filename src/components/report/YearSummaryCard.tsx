import { useMemo, useState } from 'react'
import type { Transaction } from '../../lib/types'
import { formatDate, yen } from '../../lib/format'
import { categoryLabel } from '../../lib/categories'
import { yearSummary } from '../../lib/reportYear'
import { SATISFACTION_OPTIONS, useSatisfactionAvailable } from '../../lib/satisfaction'
import VerticalBars from '../charts/VerticalBars'

interface Props {
  transactions: Transaction[]
  /** 見ている月('YYYY-MM')。その年をまとめる */
  month: string
  today: string
}

const TOP_N = 5

/**
 * 年の1年まとめ (機能123)。
 *
 * 常時開いておくとレポートが長くなりすぎるので、既定は畳んでおき、
 * 見たいときだけ開く。中身は既存の集計を年で束ね直したものだけで、
 * 新しい計算式は増やしていない(同じ数字が2通りの出方をしないように)。
 */
export default function YearSummaryCard({ transactions, month, today }: Props) {
  const [open, setOpen] = useState(false)
  const year = Number(month.slice(0, 4))
  const satisfactionAvailable = useSatisfactionAvailable()

  const summary = useMemo(
    () => (open ? yearSummary(transactions, year, today, categoryLabel) : null),
    [open, transactions, year, today]
  )

  return (
    <div className="card">
      <h2>{year}年のまとめ</h2>
      {!open || summary === null ? (
        <button className="btn-ghost rp-year-open" onClick={() => setOpen(true)}>
          {year}年の1年分を見る
        </button>
      ) : (
        <>
          <p className="rp-year-total">
            <span className="rp-num rp-year-amount">{yen(summary.total)}</span>
            <span className="rp-year-sub">
              {summary.partial
                ? `${formatDate(summary.range.end)}までの途中集計`
                : `${year}年の合計`}
            </span>
          </p>
          <ul className="rp-year-stats">
            <li>
              <span className="rp-year-stat-label">記録のある月の平均</span>
              <span className="rp-num">{yen(summary.monthlyAverage)}</span>
            </li>
            <li>
              <span className="rp-year-stat-label">いちばん多い月</span>
              <span className="rp-num">
                {summary.maxMonth ? `${summary.maxMonth.label} ${yen(summary.maxMonth.total)}` : '—'}
              </span>
            </li>
            <li>
              <span className="rp-year-stat-label">いちばん少ない月</span>
              <span className="rp-num">
                {summary.minMonth ? `${summary.minMonth.label} ${yen(summary.minMonth.total)}` : '—'}
              </span>
            </li>
            <li>
              <span className="rp-year-stat-label">記録した件数</span>
              <span className="rp-num">
                {summary.count}件・{summary.activeDays}日
              </span>
            </li>
            <li>
              {/* 「立替」は支払者を決めつけた言い方だった(誰が払ったかによらず彼女の負担分) */}
              <span className="rp-year-stat-label">彼女の負担分</span>
              <span className="rp-num">{yen(summary.partnerTotal)}</span>
            </li>
          </ul>

          <h3 className="rp-year-h3">月別の推移</h3>
          <VerticalBars
            ariaLabel={`${year}年の月別支出`}
            data={summary.months.map((m) => ({
              label: m.label,
              value: m.total,
              emphasis: m.key === month,
            }))}
          />

          <h3 className="rp-year-h3">カテゴリ上位</h3>
          {summary.categories.length === 0 ? (
            <p className="muted">支出がありません</p>
          ) : (
            <ol className="rank-list">
              {summary.categories.slice(0, TOP_N).map((c, i) => (
                <li key={c.key} className="rank-row">
                  <span className="rank-no">{i + 1}</span>
                  <span className="rank-body">
                    <span className="rank-label">{c.label}</span>
                    <span className="rank-sub">{c.count}件</span>
                  </span>
                  <span className="rank-amount">{yen(c.total)}</span>
                </li>
              ))}
            </ol>
          )}

          <h3 className="rp-year-h3">お店上位</h3>
          {summary.stores.length === 0 ? (
            <p className="muted">支出がありません</p>
          ) : (
            <ol className="rank-list">
              {summary.stores.slice(0, TOP_N).map((s, i) => (
                <li key={s.key} className="rank-row">
                  <span className="rank-no">{i + 1}</span>
                  <span className="rank-body">
                    <span className="rank-label">{s.label}</span>
                    <span className="rank-sub">{s.count}件</span>
                  </span>
                  <span className="rank-amount">{yen(s.total)}</span>
                </li>
              ))}
            </ol>
          )}

          {satisfactionAvailable && summary.satisfaction.stampedCount > 0 && (
            <>
              <h3 className="rp-year-h3">気分の内訳</h3>
              <ul className="sat-counts">
                {SATISFACTION_OPTIONS.map((o) => (
                  <li key={o.value} className="sat-count">
                    <span className="sat-count-emoji" aria-hidden="true">
                      {o.emoji}
                    </span>
                    <span className="sat-count-label">{o.label}</span>
                    <span className="sat-count-value">
                      {summary.satisfaction.counts[o.value]}件
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted">
                後悔 {summary.satisfaction.regretCount}件・{yen(summary.satisfaction.regretTotal)}
              </p>
            </>
          )}

          <button className="more-btn" onClick={() => setOpen(false)}>
            まとめを閉じる
          </button>
        </>
      )}
    </div>
  )
}
