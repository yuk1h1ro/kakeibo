import TransactionForm from './TransactionForm'
import type { Transaction } from '../lib/types'
import { formatDate, yen } from '../lib/format'
import { categoryEmoji, categoryLabel } from '../lib/categories'
import type { useTransactions } from '../hooks/useTransactions'

type Store = ReturnType<typeof useTransactions>

interface Props {
  store: Store
  onEdit: (t: Transaction) => void
}

export default function PartnerTab({ store, onEdit }: Props) {
  const balance = store.transactions.reduce((sum, t) => {
    if (t.type === 'partner_deposit') return sum + t.amount
    return sum - t.partner_amount
  }, 0)

  const balanceText = balance < 0 ? `-${yen(Math.abs(balance))}` : yen(balance)

  // 預かり(+)と、支出のうち彼女負担分の差引(-)。新しい順(storeが日付降順)
  const movements = store.transactions.filter(
    (t) => t.type === 'partner_deposit' || (t.type === 'expense' && t.partner_amount > 0)
  )

  return (
    <>
      <div className="card">
        <h2>彼女の預かり残高</h2>
        <div className={`hero-value ${balance < 0 ? 'negative' : ''}`}>{balanceText}</div>
        {balance < 0 && <p className="muted">立て替え超過です</p>}
      </div>

      <div className="card">
        <h2>預かりを記録</h2>
        <TransactionForm
          fixedType="partner_deposit"
          submitLabel="預かりを記録"
          onSubmit={async (input) => {
            await store.add(input)
          }}
        />
      </div>

      <div className="card">
        <h2>動きの履歴</h2>
        {movements.length === 0 ? (
          <p className="muted">記録がありません</p>
        ) : (
          movements.map((t) => <MovementRow key={t.id} tx={t} onEdit={onEdit} />)
        )}
      </div>
    </>
  )
}

function MovementRow({ tx, onEdit }: { tx: Transaction; onEdit: (t: Transaction) => void }) {
  const isDeposit = tx.type === 'partner_deposit'
  const emoji = isDeposit ? '💰' : categoryEmoji(tx.category)
  const title = isDeposit ? '彼女から預かり' : tx.memo || categoryLabel(tx.category)

  const subParts: string[] = [formatDate(tx.date)]
  if (isDeposit) {
    if (tx.memo) subParts.push(tx.memo)
  } else if (tx.memo) {
    subParts.push(categoryLabel(tx.category))
  }

  return (
    <button className="tx-row" onClick={() => onEdit(tx)}>
      <span className="tx-emoji">{emoji}</span>
      <span className="tx-body">
        <span className="tx-title" style={{ display: 'block' }}>
          {title}
        </span>
        <span className="tx-sub" style={{ display: 'block' }}>
          {subParts.join(' ・ ')}
        </span>
      </span>
      <span className={`tx-amount ${isDeposit ? 'positive' : ''}`}>
        {isDeposit ? `+${yen(tx.amount)}` : `-${yen(tx.partner_amount)}`}
      </span>
    </button>
  )
}
