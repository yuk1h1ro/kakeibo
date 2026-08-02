import { useRef, useState } from 'react'
import TransactionForm from './TransactionForm'
import { todayISO, yen } from '../lib/format'
import { ownAmount } from '../lib/types'
import type { useTransactions } from '../hooks/useTransactions'

type Store = ReturnType<typeof useTransactions>

export default function InputTab({ store }: { store: Store }) {
  const [saved, setSaved] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const today = todayISO()
  const todayTotal = store.transactions
    .filter((t) => t.date === today)
    .reduce((sum, t) => sum + ownAmount(t), 0)

  return (
    <>
      <div className="card stat-tile">
        <div className="label">今日の支出</div>
        <div className="value">{yen(todayTotal)}</div>
      </div>

      <div className="card">
        <h2>支出を記録</h2>
        {saved && (
          <p className="positive" style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            記録しました ✓
          </p>
        )}
        <TransactionForm
          fixedType="expense"
          submitLabel="記録する"
          onSubmit={async (input) => {
            await store.add(input)
            setSaved(true)
            if (timerRef.current) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => setSaved(false), 2500)
          }}
        />
      </div>
    </>
  )
}
