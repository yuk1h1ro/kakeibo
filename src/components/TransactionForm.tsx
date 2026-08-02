import { useState } from 'react'
import { CATEGORIES } from '../lib/categories'
import { todayISO } from '../lib/format'
import type { Transaction } from '../lib/types'
import type { TransactionInput } from '../hooks/useTransactions'

interface Props {
  initial?: Transaction
  submitLabel: string
  onSubmit: (input: TransactionInput) => Promise<void>
  onDelete?: () => Promise<void>
  // 新規入力タブでは type 固定の支出フォームとして使う
  fixedType?: 'expense' | 'partner_deposit'
}

export default function TransactionForm({ initial, submitLabel, onSubmit, onDelete, fixedType }: Props) {
  const type = fixedType ?? initial?.type ?? 'expense'
  const isExpense = type === 'expense'

  const [amount, setAmount] = useState(initial ? String(initial.amount) : '')
  const [category, setCategory] = useState<string | null>(initial?.category ?? null)
  const [date, setDate] = useState(initial?.date ?? todayISO())
  const [memo, setMemo] = useState(initial?.memo ?? '')
  const [withPartner, setWithPartner] = useState((initial?.partner_amount ?? 0) > 0)
  const [partnerAmount, setPartnerAmount] = useState(
    initial && initial.partner_amount > 0 ? String(initial.partner_amount) : ''
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amountNum = Number(amount)
  const partnerNum = withPartner ? Number(partnerAmount || 0) : 0
  const valid =
    Number.isInteger(amountNum) &&
    amountNum > 0 &&
    (!isExpense || !withPartner || (Number.isInteger(partnerNum) && partnerNum >= 0 && partnerNum <= amountNum)) &&
    (!isExpense || category !== null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        date,
        type,
        amount: amountNum,
        category: isExpense ? category : null,
        memo: memo.trim(),
        partner_amount: isExpense ? partnerNum : 0,
      })
      // 新規入力時のみリセット(編集モーダルは親が閉じる)
      if (!initial) {
        setAmount('')
        setMemo('')
        setWithPartner(false)
        setPartnerAmount('')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="form-col">
      <label className="field">
        <span>{isExpense ? '支払い金額(円)' : '預かり金額(円)'}</span>
        <input
          className="amount-input"
          type="number"
          inputMode="numeric"
          min={1}
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </label>

      {isExpense && (
        <div>
          <label className="field">
            <span>カテゴリ</span>
          </label>
          <div className="category-grid">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`category-chip ${category === c.id ? 'selected' : ''}`}
                onClick={() => setCategory(c.id)}
              >
                <span className="emoji">{c.emoji}</span>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {isExpense && (
        <div className="form-col">
          <button
            type="button"
            className={`partner-toggle ${withPartner ? 'on' : ''}`}
            onClick={() => setWithPartner(!withPartner)}
          >
            <span>彼女の分もまとめて払った</span>
            <span>{withPartner ? '✓' : ''}</span>
          </button>
          {withPartner && (
            <>
              <label className="field">
                <span>彼女の負担分(円) — 預かり残高から差し引かれます</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={amountNum || undefined}
                  placeholder="0"
                  value={partnerAmount}
                  onChange={(e) => setPartnerAmount(e.target.value)}
                />
              </label>
              <div className="quick-row">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={!amountNum}
                  onClick={() => setPartnerAmount(String(Math.round(amountNum / 2)))}
                >
                  半分
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={!amountNum}
                  onClick={() => setPartnerAmount(String(amountNum))}
                >
                  全額
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <label className="field">
        <span>日付</span>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>

      <label className="field">
        <span>メモ(任意)</span>
        <input
          type="text"
          placeholder={isExpense ? '例: スーパーで買い物' : '例: 8月分の食費として'}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
      </label>

      {error && <p className="error-text">{error}</p>}

      <button className="btn-primary" disabled={!valid || busy} onClick={submit}>
        {busy ? '保存中…' : submitLabel}
      </button>

      {onDelete && (
        <button className="btn-ghost" style={{ color: 'var(--critical)' }} disabled={busy} onClick={onDelete}>
          削除する
        </button>
      )}
    </div>
  )
}
