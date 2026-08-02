import { useState } from 'react'
import type { Transaction } from '../lib/types'
import { ownAmount } from '../lib/types'
import { formatMonth, monthKey, monthKeyOffset, shortMonth, signedYen, todayISO, yen } from '../lib/format'
import { categoryLabel } from '../lib/categories'
import CategoryBars from './charts/CategoryBars'
import MonthlyTrend from './charts/MonthlyTrend'

export default function ReportTab({ transactions }: { transactions: Transaction[] }) {
  const currentMonth = monthKey(todayISO())
  const [month, setMonth] = useState(currentMonth)
  const canNext = month < currentMonth

  const ownTotalOf = (key: string) =>
    transactions
      .filter((t) => monthKey(t.date) === key)
      .reduce((sum, t) => sum + ownAmount(t), 0)

  const monthTx = transactions.filter((t) => monthKey(t.date) === month)
  const total = monthTx.reduce((sum, t) => sum + ownAmount(t), 0)
  const prevTotal = ownTotalOf(monthKeyOffset(month, -1))
  const delta = total - prevTotal

  const partnerTotal = monthTx
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.partner_amount, 0)

  // カテゴリ別(自分の実質支出ベース)
  const byCategory = new Map<string | null, number>()
  for (const t of monthTx) {
    if (t.type !== 'expense') continue
    const own = ownAmount(t)
    if (own <= 0) continue
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + own)
  }
  const categoryData = [...byCategory.entries()]
    .map(([id, value]) => ({ label: categoryLabel(id), value }))
    .sort((a, b) => b.value - a.value)

  // 選択月まで直近6ヶ月の推移
  const trendData = Array.from({ length: 6 }, (_, i) => {
    const key = monthKeyOffset(month, i - 5)
    return { label: shortMonth(key), value: ownTotalOf(key), isCurrent: key === month }
  })

  return (
    <>
      <div className="month-nav">
        <button onClick={() => setMonth(monthKeyOffset(month, -1))} aria-label="前の月">
          ←
        </button>
        <span className="title">{formatMonth(month)}</span>
        <button
          onClick={() => setMonth(monthKeyOffset(month, 1))}
          disabled={!canNext}
          aria-label="次の月"
        >
          →
        </button>
      </div>

      <div className="stat-row">
        <div className="card stat-tile">
          <div className="label">今月の支出</div>
          <div className="value">{yen(total)}</div>
          <div className={`delta ${delta > 0 ? 'negative' : delta < 0 ? 'positive' : ''}`}>
            前月比 {signedYen(delta)}
          </div>
        </div>
        <div className="card stat-tile">
          <div className="label">彼女立替分</div>
          <div className="value">{yen(partnerTotal)}</div>
          <div className="delta">預かり残高から差引</div>
        </div>
      </div>

      <div className="card">
        <h2>カテゴリ別支出</h2>
        <CategoryBars data={categoryData} />
      </div>

      <div className="card">
        <h2>月次推移(直近6ヶ月)</h2>
        <MonthlyTrend data={trendData} />
      </div>
    </>
  )
}
