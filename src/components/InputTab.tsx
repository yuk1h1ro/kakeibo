import { useCallback, useMemo, useRef, useState } from 'react'
import TransactionForm, { type FormPrefill } from './TransactionForm'
import { yen } from '../lib/format'
import { categoryEmoji, categoryLabel, useCategories } from '../lib/categories'
import type { Transaction } from '../lib/types'
import type { useTransactions } from '../hooks/useTransactions'

type Store = ReturnType<typeof useTransactions>

export default function InputTab({ store }: { store: Store }) {
  const [saved, setSaved] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [prefill, setPrefill] = useState<FormPrefill | undefined>(undefined)
  const [pendingPartner, setPendingPartner] = useState(0)
  // カテゴリ変更(名前・絵文字)時に「最近の記録から入力」チップを再描画するための購読
  useCategories()

  // 彼女の預かり残高 = 預かり合計 − 支出の彼女負担分合計
  const partnerBalance = store.transactions.reduce(
    (sum, t) => (t.type === 'partner_deposit' ? sum + t.amount : sum - t.partner_amount),
    0
  )
  const balanceAfter = partnerBalance - pendingPartner

  // 直近の支出から (カテゴリ, 金額, メモ) の組で重複除去して最大5件
  const recentEntries = useMemo(() => {
    const seen = new Set<string>()
    const out: Transaction[] = []
    for (const t of store.transactions) {
      if (t.type !== 'expense') continue
      const key = `${t.category ?? ''}|${t.amount}|${t.memo}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(t)
      if (out.length >= 5) break
    }
    return out
  }, [store.transactions])

  const handlePartnerAmountChange = useCallback((n: number) => setPendingPartner(n), [])

  const applyRecent = (t: Transaction) => {
    setPrefill((prev) => ({
      nonce: (prev?.nonce ?? 0) + 1,
      amount: t.amount,
      category: t.category,
      memo: t.memo,
      partner_amount: t.partner_amount,
    }))
  }

  return (
    <>
      <div className="card balance-card">
        <span className="label">彼女の預かり残高</span>
        <div className="balance-values">
          <span className={`value ${partnerBalance < 0 ? 'negative' : ''}`}>{yen(partnerBalance)}</span>
          {pendingPartner > 0 && (
            <span className="balance-after">
              差引後 <span className={balanceAfter < 0 ? 'negative' : ''}>{yen(balanceAfter)}</span>
            </span>
          )}
        </div>
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
          prefill={prefill}
          onPartnerAmountChange={handlePartnerAmountChange}
          onSubmit={async (input) => {
            await store.add(input)
            setSaved(true)
            if (timerRef.current) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => setSaved(false), 2500)
          }}
        />
      </div>

      {recentEntries.length > 0 && (
        <div className="card">
          <h2>最近の記録から入力</h2>
          <div className="recent-chips">
            {recentEntries.map((t) => (
              <button key={t.id} type="button" className="recent-chip" onClick={() => applyRecent(t)}>
                <span className="emoji">{categoryEmoji(t.category)}</span>
                <span className="recent-label">{t.memo || categoryLabel(t.category)}</span>
                <span className="recent-amount">{yen(t.amount)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
