import { useMemo, useState } from 'react'
import type { Transaction } from '../lib/types'
import { ownAmount } from '../lib/types'
import { formatDate, formatMonth, monthKey, monthKeyOffset, todayISO, yen } from '../lib/format'
import { categoryLabel, resolveCategoryVisual } from '../lib/categories'
import { CategoryVisualBadge } from './categoryIcons'
import type { useTransactions } from '../hooks/useTransactions'
import { WEEKDAY_LABELS, defaultSelectedDate, monthWeeks } from '../lib/calendar'
import '../calendar.css'

type Store = ReturnType<typeof useTransactions>

interface Props {
  store: Store
  onEdit: (t: Transaction) => void
}

interface DaySummary {
  own: number
  deposit: number
}

export default function HistoryTab({ store, onEdit }: Props) {
  const today = todayISO()
  const currentMonth = monthKey(today)
  const [month, setMonth] = useState(currentMonth)
  const [selected, setSelected] = useState(today)
  const canNext = month < currentMonth

  const changeMonth = (offset: number) => {
    const next = monthKeyOffset(month, offset)
    setMonth(next)
    setSelected(
      defaultSelectedDate(
        next,
        store.transactions.map((t) => t.date),
        today
      )
    )
  }

  const monthTx = useMemo(
    () => store.transactions.filter((t) => monthKey(t.date) === month),
    [store.transactions, month]
  )

  // 日ごとの集計: 自分の実質支出合計と預かり合計
  const byDay = useMemo(() => {
    const map = new Map<string, DaySummary>()
    for (const t of monthTx) {
      const entry = map.get(t.date) ?? { own: 0, deposit: 0 }
      if (t.type === 'partner_deposit') {
        entry.deposit += t.amount
      } else {
        entry.own += ownAmount(t)
      }
      map.set(t.date, entry)
    }
    return map
  }, [monthTx])

  const expenseTotal = monthTx.reduce((sum, t) => sum + ownAmount(t), 0)
  const depositTotal = monthTx
    .filter((t) => t.type === 'partner_deposit')
    .reduce((sum, t) => sum + t.amount, 0)

  const weeks = useMemo(() => monthWeeks(month), [month])

  const dayTx = monthTx.filter((t) => t.date === selected)
  const dayTotal = dayTx.reduce((sum, t) => sum + ownAmount(t), 0)

  return (
    <>
      <div className="month-nav">
        <button onClick={() => changeMonth(-1)} aria-label="前の月">
          ←
        </button>
        <span className="title">{formatMonth(month)}</span>
        <button onClick={() => changeMonth(1)} disabled={!canNext} aria-label="次の月">
          →
        </button>
      </div>

      <div className="card month-summary">
        <div className="ms-item">
          <span className="ms-label">支出</span>
          <span className="ms-value ms-expense">{yen(expenseTotal)}</span>
        </div>
        <div className="ms-divider" />
        <div className="ms-item">
          <span className="ms-label">預かり</span>
          <span className="ms-value ms-income">{yen(depositTotal)}</span>
        </div>
      </div>

      <div className="card cal-card">
        <div className="cal-weekdays">
          {WEEKDAY_LABELS.map((w, i) => (
            <span key={w} className={i === 0 ? 'cal-sun' : i === 6 ? 'cal-sat' : undefined}>
              {w}
            </span>
          ))}
        </div>
        <div className="cal-grid">
          {weeks.flat().map((cell, i) => {
            if (cell === null) {
              return <span key={`empty-${i}`} className="cal-cell cal-empty" />
            }
            const summary = byDay.get(cell.iso)
            const isToday = cell.iso === today
            const isSelected = cell.iso === selected
            const amountText =
              summary && summary.own > 0 ? summary.own.toLocaleString('ja-JP') : null
            const cls = [
              'cal-cell',
              isToday ? 'cal-today' : '',
              isSelected ? 'cal-selected' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={cell.iso}
                className={cls}
                onClick={() => setSelected(cell.iso)}
                aria-label={`${formatDate(cell.iso)}を選択`}
                aria-pressed={isSelected}
              >
                <span className="cal-day">{cell.day}</span>
                {amountText !== null && (
                  <span
                    className={`cal-amount${amountText.length > 6 ? ' cal-amount-long' : ''}`}
                  >
                    {amountText}
                  </span>
                )}
                {summary && summary.deposit > 0 && <span className="cal-dot" />}
              </button>
            )
          })}
        </div>
      </div>

      <div className="card">
        <div className="cal-day-heading">
          <span>{formatDate(selected)}</span>
          <span className="cal-day-total">合計 {yen(dayTotal)}</span>
        </div>
        {dayTx.length === 0 ? (
          <p className="cal-day-empty">この日の記録はありません</p>
        ) : (
          dayTx.map((t) => <TxRow key={t.id} tx={t} onEdit={onEdit} />)
        )}
      </div>
    </>
  )
}

function TxRow({ tx, onEdit }: { tx: Transaction; onEdit: (t: Transaction) => void }) {
  const isDeposit = tx.type === 'partner_deposit'
  const visual = isDeposit
    ? ({ kind: 'icon', icon: 'wallet' } as const)
    : resolveCategoryVisual(tx.category)
  // タイトルの優先順位: お店 → メモ → カテゴリ名
  const title = isDeposit ? '彼女から預かり' : tx.store || tx.memo || categoryLabel(tx.category)

  const subParts: string[] = []
  if (isDeposit) {
    if (tx.memo) subParts.push(tx.memo)
  } else {
    // タイトルがお店のときはメモをサブ行に併記
    if (tx.store && tx.memo) subParts.push(tx.memo)
    if (tx.store || tx.memo) subParts.push(categoryLabel(tx.category))
    if (tx.partner_amount > 0) subParts.push(`うち彼女分 ${yen(tx.partner_amount)}`)
  }

  return (
    <button className="tx-row" onClick={() => onEdit(tx)}>
      <CategoryVisualBadge visual={visual} size={34} />
      <span className="tx-body">
        <span className="tx-title" style={{ display: 'block' }}>
          {title}
        </span>
        {subParts.length > 0 && (
          <span className="tx-sub" style={{ display: 'block' }}>
            {subParts.join(' ・ ')}
          </span>
        )}
      </span>
      <span className={`tx-amount ${isDeposit ? 'positive' : ''}`}>
        {isDeposit ? `+${yen(tx.amount)}` : `-${yen(ownAmount(tx))}`}
      </span>
    </button>
  )
}
