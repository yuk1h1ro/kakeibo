import { useEffect, useRef, useState } from 'react'
import { categoryLabel, useCategories, visualFromEmojiValue } from '../lib/categories'
import { CategoryVisualBadge } from './categoryIcons'
import { daysAgoISO, todayISO } from '../lib/format'
import {
  EMPTY_CALC,
  OP_LABEL,
  clearAll,
  pressBackspace,
  pressDigits,
  pressEquals,
  pressOperator,
  resolveForSubmit,
  type CalcOp,
  type CalcState,
} from '../lib/calc'
import { useKeypadEnabled } from '../lib/keypadSettings'
import AmountKeypad from './AmountKeypad'
import {
  lookupStoreCategory,
  matchStoreSuggestions,
  useStoreCategories,
} from '../lib/storeCategories'
import type { Transaction } from '../lib/types'
import type { TransactionInput } from '../hooks/useTransactions'

// 「最近の記録から入力」などの外部プリフィル。nonce が変わるたびに適用される(日付は現在の選択を維持)
export interface FormPrefill {
  nonce: number
  amount: number
  category: string | null
  memo: string
  store: string
  partner_amount: number
  // 任意: 指定があるときだけ日付も更新する(レシート読み取り用。「最近の記録から入力」は渡さない)
  date?: string
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
  const [store, setStore] = useState(initial?.store ?? '')
  const [withPartner, setWithPartner] = useState((initial?.partner_amount ?? 0) > 0)
  const [partnerAmount, setPartnerAmount] = useState(
    initial && initial.partner_amount > 0 ? String(initial.partner_amount) : ''
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 金額入力の簡易電卓(保留中の値と演算子)。数字は入力欄か自前テンキーから入る
  const [calc, setCalc] = useState<{ pendingValue: number | null; pendingOp: CalcOp | null }>({
    pendingValue: null,
    pendingOp: null,
  })

  // 自前テンキー(機能052)。タッチ端末では既定で有効、PC では OS のキーボードのまま
  const keypadEnabled = useKeypadEnabled()
  const [keypadOpen, setKeypadOpen] = useState(false)
  const amountRef = useRef<HTMLInputElement | null>(null)

  // 店名からのカテゴリ自動選択(機能067+075)
  const learned = useStoreCategories()
  const [storeFocused, setStoreFocused] = useState(false)
  // 自動で入ったカテゴリを黙って使わせないための1行。ユーザーが選び直したら消す
  const [autoCategory, setAutoCategory] = useState<string | null>(null)

  const suggestions = storeFocused ? matchStoreSuggestions(learned, store) : []

  // 店名から学習済みのカテゴリを当てる。すでに選ばれているときは尊重する
  const applyLearnedCategory = (name: string, current: string | null): void => {
    if (current !== null) return
    const found = lookupStoreCategory(learned, name)
    if (found === null) return
    setCategory(found)
    setAutoCategory(found)
  }

  const chooseCategory = (id: string) => {
    setCategory(id)
    setAutoCategory(null) // 手で選び直したので、以降は自動選択の表示を出さない
  }

  // 編集モーダルの対象が変わったら計算途中の状態を持ち越さない
  useEffect(() => {
    setCalc(EMPTY_CALC)
  }, [initial])

  // テンキーの高さぶんの余白を本文に持たせる(保存ボタンがパッドの下に隠れないように)
  useEffect(() => {
    if (!keypadOpen) return
    document.body.classList.add('keypad-open')
    return () => document.body.classList.remove('keypad-open')
  }, [keypadOpen])

  // 金額欄・テンキー以外を触ったら閉じる。
  // blur ではなく click で閉じるのは、押した相手の onClick が先に走るようにするため
  // (先に閉じると余白が消えてボタンが指の下からずれることがある)
  useEffect(() => {
    if (!keypadOpen) return
    const onDocumentClick = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof HTMLElement)) return
      if (target === amountRef.current || target.closest('.keypad-dock')) return
      setKeypadOpen(false)
    }
    document.addEventListener('click', onDocumentClick)
    return () => document.removeEventListener('click', onDocumentClick)
  }, [keypadOpen])

  // 外部プリフィル適用(日付は prefill.date があるときだけ更新)
  useEffect(() => {
    if (!prefill) return
    setCalc(EMPTY_CALC) // 計算途中の状態が混ざらないようにリセット
    setAmount(String(prefill.amount))
    if (prefill.date) setDate(prefill.date)
    setMemo(prefill.memo)
    setStore(prefill.store)
    setWithPartner(prefill.partner_amount > 0)
    setPartnerAmount(prefill.partner_amount > 0 ? String(prefill.partner_amount) : '')
    // レシート読み取りのように店名だけ入ってくる場合も、手入力と同じ経路でカテゴリを補う
    setCategory(prefill.category)
    setAutoCategory(null)
    if (prefill.category === null && prefill.store !== '') {
      applyLearnedCategory(prefill.store, null)
    }
    // applyLearnedCategory は学習内容のスナップショットに依存するだけなので依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  const calcState: CalcState = { input: amount, pendingValue: calc.pendingValue, pendingOp: calc.pendingOp }
  // ＝ の押し忘れに備え、保留中の計算を評価した値を「確定した金額」として扱う
  const resolvedAmount = resolveForSubmit(calcState).input
  const amountNum = Number(resolvedAmount)
  const partnerNum = withPartner ? Number(partnerAmount || 0) : 0

  const runOperator = (op: CalcOp) => {
    const next = pressOperator(calcState, op)
    setAmount(next.input)
    setCalc({ pendingValue: next.pendingValue, pendingOp: next.pendingOp })
  }

  const runEquals = () => {
    const next = pressEquals(calcState)
    setAmount(next.input)
    setCalc({ pendingValue: next.pendingValue, pendingOp: next.pendingOp })
  }

  const runClear = () => {
    const next = clearAll()
    setAmount(next.input)
    setCalc({ pendingValue: next.pendingValue, pendingOp: next.pendingOp })
  }

  // テンキーの数字も演算子と同じ状態機械を通す(挙動を1本に保つため)
  const runDigits = (digits: string) => {
    setAmount(pressDigits(calcState, digits).input)
  }

  const runBackspace = () => {
    setAmount(pressBackspace(calcState).input)
  }

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

  const dateChips = [
    { label: '今日', value: daysAgoISO(0) },
    { label: '昨日', value: daysAgoISO(1) },
    { label: '一昨日', value: daysAgoISO(2) },
  ]

  const submit = async () => {
    // 保留中の計算があれば評価してから保存する(＝の押し忘れ対策)。画面にも結果を反映
    if (calc.pendingOp !== null) {
      setAmount(resolvedAmount)
      setCalc(EMPTY_CALC)
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        date,
        type,
        amount: amountNum,
        category: isExpense ? category : null,
        memo: memo.trim(),
        store: isExpense ? store.trim() : '',
        partner_amount: isExpense ? partnerNum : 0,
      })
      // 新規入力時のみリセット(編集モーダルは親が閉じる)
      if (!initial) {
        setAmount('')
        setCalc(EMPTY_CALC)
        setMemo('')
        setStore('')
        setWithPartner(false)
        setPartnerAmount('')
        setAutoCategory(null)
        setKeypadOpen(false)
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
            ref={amountRef}
            className={`amount-input ${amountNum < 0 ? 'negative' : ''}`}
            type="number"
            /* テンキー使用中も readOnly にはしない — 貼り付け・選択を殺さず、
               OS のキーボードだけを呼ばないようにする */
            inputMode={keypadEnabled ? 'none' : 'numeric'}
            min={1}
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onFocus={() => keypadEnabled && setKeypadOpen(true)}
          />
          <button type="button" className="amount-clear" aria-label="金額をクリア" onClick={runClear}>
            C
          </button>
        </div>
        <div className="calc-bar">
          <div className="calc-status" aria-live="polite">
            {calc.pendingOp !== null && calc.pendingValue !== null && (
              <span className="calc-pending">
                {calc.pendingValue.toLocaleString('ja-JP')} {OP_LABEL[calc.pendingOp]}
              </span>
            )}
            {amountNum < 0 && <span className="calc-warn">マイナスの金額は保存できません</span>}
          </div>
          {/* テンキーを開いている間は同じ演算子が下に出るので、こちらは畳む */}
          {!keypadOpen && (
            <div className="calc-keys">
              <button type="button" className="calc-key" aria-label="足す" onClick={() => runOperator('+')}>
                ＋
              </button>
              <button type="button" className="calc-key" aria-label="引く" onClick={() => runOperator('-')}>
                −
              </button>
              <button type="button" className="calc-key" aria-label="掛ける" onClick={() => runOperator('×')}>
                ×
              </button>
              <button
                type="button"
                className="calc-key calc-key-equals"
                aria-label="計算する"
                onClick={runEquals}
              >
                ＝
              </button>
            </div>
          )}
        </div>
      </div>

      {keypadEnabled && keypadOpen && (
        <AmountKeypad
          pending={
            calc.pendingOp !== null && calc.pendingValue !== null
              ? { value: calc.pendingValue, op: calc.pendingOp }
              : null
          }
          onDigits={runDigits}
          onBackspace={runBackspace}
          onOperator={runOperator}
          onEquals={runEquals}
          onClear={runClear}
          onDone={() => {
            setKeypadOpen(false)
            // フォーカスが金額欄に残ったままだと、もう一度タップしても開き直せない
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
          }}
        />
      )}

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
                onClick={() => chooseCategory(c.id)}
              >
                <CategoryVisualBadge visual={visualFromEmojiValue(c.emoji)} size={34} />
                {c.label}
              </button>
            ))}
          </div>
          {autoCategory !== null && category === autoCategory && (
            <p className="muted auto-category-note">
              前回このお店で選んだ「{categoryLabel(autoCategory)}」にしました(違うときは選び直してください)
            </p>
          )}
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
            <span className="toggle-check">{withPartner ? '✓' : ''}</span>
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

      {isExpense && (
        <div className="field store-field">
          <span>お店(任意)</span>
          <input
            type="text"
            aria-label="お店"
            placeholder="例: セブンイレブン"
            value={store}
            autoComplete="off"
            onChange={(e) => setStore(e.target.value)}
            onFocus={() => setStoreFocused(true)}
            onBlur={() => {
              setStoreFocused(false)
              // 候補を選ばずに打ち切った場合も、同じ店名を知っていればカテゴリを補う
              applyLearnedCategory(store, category)
            }}
          />
          {suggestions.length > 0 && (
            <ul className="store-suggestions">
              {suggestions.map((s) => (
                <li key={s.storeKey}>
                  <button
                    type="button"
                    className="store-suggestion"
                    // blur より先に確定させたいので mousedown/pointerdown で拾う
                    onPointerDown={(e) => {
                      e.preventDefault()
                      setStore(s.storeName)
                      setStoreFocused(false)
                      setCategory(s.category)
                      setAutoCategory(s.category)
                    }}
                  >
                    <span className="store-suggestion-name">{s.storeName}</span>
                    <span className="store-suggestion-cat">{categoryLabel(s.category)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
        <button className="btn-ghost" style={{ color: 'var(--expense)' }} disabled={busy} onClick={onDelete}>
          削除する
        </button>
      )}
    </div>
  )
}
