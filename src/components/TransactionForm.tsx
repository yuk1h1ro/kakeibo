import { useEffect, useState } from 'react'
import { useCategories } from '../lib/categories'
import { daysAgoISO, todayISO } from '../lib/format'
import type { Transaction } from '../lib/types'
import type { TransactionInput } from '../hooks/useTransactions'

// 「最近の記録から入力」などの外部プリフィル。nonce が変わるたびに適用される(日付は現在の選択を維持)
export interface FormPrefill {
  nonce: number
  amount: number
  category: string | null
  memo: string
  partner_amount: number
}

interface Props {
  initial?: Transaction
  submitLabel: string
  onSubmit: (input: TransactionInput) => Promise<void>
  onDelete?: () => Promise<void>
  // 新規入力タブでは type 固定の支出フォームとして使う
  fixedType?: 'expense' | 'partner_deposit'
  // 任意: 外部からのプリフィル(編集モーダルでは使わない)
  prefill?: FormPrefill
  // 任意: 「彼女の負担分」の現在入力値を親に通知(トグルOFF・非支出時は 0)
  onPartnerAmountChange?: (amount: number) => void
}

const AMOUNT_STEPS = [10000, 5000, 1000, 500, 100, 10]

export default function TransactionForm({
  initial,
  submitLabel,
  onSubmit,
  onDelete,
  fixedType,
  prefill,
  onPartnerAmountChange,
}: Props) {
  const type = fixedType ?? initial?.type ?? 'expense'
  const isExpense = type === 'expense'
  const categories = useCategories()

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

  // 外部プリフィル適用(日付は触らない)
  useEffect(() => {
    if (!prefill) return
    setAmount(String(prefill.amount))
    setCategory(prefill.category)
    setMemo(prefill.memo)
    setWithPartner(prefill.partner_amount > 0)
    setPartnerAmount(prefill.partner_amount > 0 ? String(prefill.partner_amount) : '')
  }, [prefill])

  const amountNum = Number(amount)
  const partnerNum = withPartner ? Number(partnerAmount || 0) : 0

  // 彼女の負担分の入力値を親に通知(残高カードの「差引後」表示用)
  useEffect(() => {
    if (!onPartnerAmountChange) return
    const n = isExpense && withPartner ? Number(partnerAmount || 0) : 0
    onPartnerAmountChange(Number.isFinite(n) && n > 0 ? n : 0)
  }, [isExpense, withPartner, partnerAmount, onPartnerAmountChange])

  const valid =
    Number.isInteger(amountNum) &&
    amountNum > 0 &&
    (!isExpense || !withPartner || (Number.isInteger(partnerNum) && partnerNum >= 0 && partnerNum <= amountNum)) &&
    (!isExpense || category !== null)

  const addAmount = (step: number) => {
    const cur = Number(amount)
    const base = amount !== '' && Number.isFinite(cur) ? cur : 0
    setAmount(String(base + step))
  }

  const dateChips = [
    { label: '今日', value: daysAgoISO(0) },
    { label: '昨日', value: daysAgoISO(1) },
    { label: '一昨日', value: daysAgoISO(2) },
  ]

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
      <div className="field">
        <span>{isExpense ? '支払い金額(円)' : '預かり金額(円)'}</span>
        <div className="amount-row">
          <input
            className="amount-input"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button
            type="button"
            className="amount-clear"
            aria-label="金額をクリア"
            onClick={() => setAmount('')}
          >
            C
          </button>
        </div>
        <div className="amount-pad">
          {AMOUNT_STEPS.map((step) => (
            <button key={step} type="button" className="pad-btn" onClick={() => addAmount(step)}>
              +{step.toLocaleString('ja-JP')}
            </button>
          ))}
        </div>
      </div>

      {isExpense && (
        <div>
          <label className="field">
            <span>カテゴリ</span>
          </label>
          <div className="category-grid">
            {categories.map((c) => (
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

      <div className="field">
        <span>日付</span>
        <div className="date-quick">
          {dateChips.map((c) => (
            <button
              key={c.label}
              type="button"
              className={`date-chip ${date === c.value ? 'selected' : ''}`}
              onClick={() => setDate(c.value)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

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
