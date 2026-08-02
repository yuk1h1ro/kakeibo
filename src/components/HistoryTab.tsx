import { useState } from 'react'
import type { Transaction } from '../lib/types'
import { ownAmount } from '../lib/types'
import { formatDate, formatMonth, monthKey, monthKeyOffset, todayISO, yen } from '../lib/format'
import { categoryEmoji, categoryLabel } from '../lib/categories'
import type { useTransactions } from '../hooks/useTransactions'

type Store = ReturnType<typeof useTransactions>

interface Props {
  store: Store
  onEdit: (t: Transaction) => void
}

export default function HistoryTab({ store, onEdit }: Props) {
  const currentMonth = monthKey(todayISO())
  const [month, setMonth] = useState(currentMonth)
  const canNext = month < currentMonth

  const monthTx = store.transactions.filter((t) => monthKey(t.date) === month)

  // 既に日付降順・作成降順で並んでいるので、順に日付でグループ化する
  const groups: { date: string; items: Transaction[] }[] = []
  for (const t of monthTx) {
    const last = groups[groups.length - 1]
    if (last && last.date === t.date) {
      last.items.push(t)
    } else {
      groups.push({ date: t.date, items: [t] })
    }
  }

  const expenseTotal = monthTx.reduce((sum, t) => sum + ownAmount(t), 0)
  const depositTotal = monthTx
    .filter((t) => t.type === 'partner_deposit')
    .reduce((sum, t) => sum + t.amount, 0)

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

      <div className="card stat-tile">
        <div className="label">支出合計</div>
        <div className="value">{yen(expenseTotal)}</div>
        {depositTotal > 0 && <div className="delta">彼女からの預かり +{yen(depositTotal)}</div>}
      </div>

      {monthTx.length === 0 ? (
        <div className="card">
          <p className="muted">記録がありません</p>
        </div>
      ) : (
        <div className="card">
          {groups.map((g) => (
            <div key={g.date}>
              <div className="tx-group-date">{formatDate(g.date)}</div>
              {g.items.map((t) => (
                <TxRow key={t.id} tx={t} onEdit={onEdit} />
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function TxRow({ tx, onEdit }: { tx: Transaction; onEdit: (t: Transaction) => void }) {
  const isDeposit = tx.type === 'partner_deposit'
  const emoji = isDeposit ? '💰' : categoryEmoji(tx.category)
  const title = isDeposit ? '彼女から預かり' : tx.memo || categoryLabel(tx.category)

  const subParts: string[] = []
  if (isDeposit) {
    if (tx.memo) subParts.push(tx.memo)
  } else {
    if (tx.memo) subParts.push(categoryLabel(tx.category))
    if (tx.partner_amount > 0) subParts.push(`うち彼女分 ${yen(tx.partner_amount)}`)
  }

  return (
    <button className="tx-row" onClick={() => onEdit(tx)}>
      <span className="tx-emoji">{emoji}</span>
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
