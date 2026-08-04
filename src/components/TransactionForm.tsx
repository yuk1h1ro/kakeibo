import { useEffect, useRef, useState } from 'react'
import { categoryLabel, useCategories, visualFromEmojiValue } from '../lib/categories'
import { CategoryVisualBadge } from './categoryIcons'
import { daysAgoISO, formatDate, todayISO, yen } from '../lib/format'
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
import AmountTextInput from './AmountTextInput'
import { normalizeAmountInput } from '../lib/amountFormat'
import { SATISFACTION_OPTIONS, useSatisfactionAvailable } from '../lib/satisfaction'
import {
  lookupStoreCategory,
  matchStoreSuggestions,
  useStoreCategories,
} from '../lib/storeCategories'
import type { Satisfaction, Transaction } from '../lib/types'
import { satisfactionOf } from '../lib/types'
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

// カレンダーの日付タップ(機能053)。日付だけを差し替え、他の入力には触らない
export interface DatePrefill {
  nonce: number
  date: string
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
  // 任意: 日付だけの差し替え(履歴カレンダーから「その日で入力する」)
  datePrefill?: DatePrefill
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
  datePrefill,
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

  // 感情スタンプ (機能219)。列が無い環境では導線ごと出さない
  const satisfactionAvailable = useSatisfactionAvailable()
  const [satisfaction, setSatisfaction] = useState<Satisfaction | null>(
    initial ? satisfactionOf(initial) : null
  )

  // 必須でない項目(日付・お店・メモ・彼女の負担分)は畳んでおき、
  // カテゴリ→金額の2タップ(機能051)を最短距離に保つ。
  // 編集時は「今入っている内容を確かめる」画面なので最初から開く
  const [detailsOpen, setDetailsOpen] = useState(initial !== undefined)

  // 連続保存(機能048)の手応え。通常保存では 0 に戻す
  const [streak, setStreak] = useState(0)
  const [lastSavedAmount, setLastSavedAmount] = useState(0)

  // 自前テンキー(機能052)。タッチ端末では既定で有効、PC では OS のキーボードのまま
  const keypadEnabled = useKeypadEnabled()
  const [keypadOpen, setKeypadOpen] = useState(false)
  const amountRef = useRef<HTMLInputElement | null>(null)
  // プログラムからフォーカスするとき、onFocus 経由でテンキーが開くのを抑える印
  const silentFocusRef = useRef(false)

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

  /**
   * 金額欄にフォーカスを移す (機能047)。
   * 自前テンキーが有効なときは inputMode="none" なので、フォーカスしても
   * OS のキーボードは出ない(= 画面が跳ねない)。パッドだけを開く。
   * 無効なときは OS の数値キーボードを呼ぶが、iOS はユーザー操作の延長でしか
   * 開かないので、必ずタップのハンドラの中から同期的に呼ぶこと。
   */
  const focusAmount = () => {
    const el = amountRef.current
    if (!el) return
    if (keypadEnabled) setKeypadOpen(true)
    el.focus({ preventScroll: true })
    const len = el.value.length
    el.setSelectionRange(len, len)
  }

  // 編集シートを開いた直後も金額欄に当てておく (機能047)。
  // ここはタップの延長ではないので OS キーボードは出ない。テンキーも自動では
  // 開かない — 340px の余白が入ってシートが跳ね、他の項目が見えなくなるため
  const initialFocusDone = useRef(false)
  useEffect(() => {
    if (!initial || initialFocusDone.current) return
    initialFocusDone.current = true
    const el = amountRef.current
    if (!el) return
    silentFocusRef.current = true
    el.focus({ preventScroll: true })
    el.select() // 打ち直しがそのまま置き換えになる
    silentFocusRef.current = false
  }, [initial])

  const chooseCategory = (id: string) => {
    setCategory(id)
    setAutoCategory(null) // 手で選び直したので、以降は自動選択の表示を出さない
    // 機能051(カテゴリ→金額)と機能047(金額に自動フォーカス)の両立点。
    // 入力タブを開いた瞬間ではなく「カテゴリを押した瞬間」に金額へ移す。
    // すでに金額を打ったあとの選び直しでは動かさない(キーボードが再度出て画面が跳ねる)
    if (amount === '' && calc.pendingOp === null) focusAmount()
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
      // 「保存して続ける」は次の1件をそのまま打つためのボタンなので、閉じない
      if (
        target === amountRef.current ||
        target.closest('.keypad-dock') ||
        target.closest('.save-continue')
      ) {
        return
      }
      setKeypadOpen(false)
    }
    document.addEventListener('click', onDocumentClick)
    return () => document.removeEventListener('click', onDocumentClick)
  }, [keypadOpen])

  // 外部プリフィル適用(日付は prefill.date があるときだけ更新)
  useEffect(() => {
    if (!prefill) return
    setCalc(EMPTY_CALC) // 計算途中の状態が混ざらないようにリセット
    setAmount(prefill.amount > 0 ? String(prefill.amount) : '')
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
    // 畳んだままだと入った内容(お店・メモ・彼女の負担分)が見えないので開く
    if (prefill.store !== '' || prefill.memo !== '' || prefill.partner_amount > 0 || prefill.date) {
      setDetailsOpen(true)
    }
    // applyLearnedCategory は学習内容のスナップショットに依存するだけなので依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  // カレンダーから渡された日付を反映する(機能053)。他の入力には触らない。
  // 今日以外の日付で入力することになるので、確認できるよう詳細を開く
  useEffect(() => {
    if (!datePrefill) return
    setDate(datePrefill.date)
    if (datePrefill.date !== todayISO()) setDetailsOpen(true)
  }, [datePrefill])

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

  // 畳んでいる間も中身が分かるようにする(特に日付が今日でないとき)
  const dateShortLabel =
    dateChips.find((c) => c.value === date)?.label ?? formatDate(date)
  const detailSummary = [
    dateShortLabel,
    store.trim(),
    memo.trim(),
    withPartner && partnerNum > 0 ? `彼女 ${yen(partnerNum)}` : '',
  ]
    .filter((s) => s !== '')
    .join('・')

  /**
   * 保存する。continueAfter = true のときは画面を閉じずに次の1件へ進む(機能048)。
   * 日付とカテゴリは残し、その1件ごとに変わる項目(金額・お店・メモ・彼女の負担分・
   * 感情スタンプ)だけを空にする。
   */
  const submit = async (continueAfter: boolean) => {
    // 続けて入力するときは、保存を待つ前にフォーカスを確保しておく。
    // iOS は「タップの延長」でしか OS キーボードを開かないので、
    // await のあとに focus してもキーボードが出ない
    if (continueAfter && !initial) focusAmount()
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
        // 列が無い環境では送らない(同期が止まらないように)
        ...(isExpense && satisfactionAvailable ? { satisfaction } : {}),
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
        setSatisfaction(null)
        if (continueAfter) {
          setStreak((n) => n + 1)
          setLastSavedAmount(amountNum)
          // 保存の間に別の要素へフォーカスが移っていても金額欄に戻す
          amountRef.current?.focus({ preventScroll: true })
        } else {
          setStreak(0)
          setDetailsOpen(false)
          setKeypadOpen(false)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="form-col">
      {/* 機能051: カテゴリ → 金額の順に並べる(最短2タップ+数字で保存まで届く) */}
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

      <div className="field">
        <span>{isExpense ? '支払い金額(円)' : '預かり金額(円)'}</span>
        <div className="amount-row">
          <AmountTextInput
            inputRef={amountRef}
            className={`amount-input ${amountNum < 0 ? 'negative' : ''}`}
            ariaLabel={isExpense ? '支払い金額' : '預かり金額'}
            /* テンキー使用中も readOnly にはしない — 貼り付け・選択を殺さず、
               OS のキーボードだけを呼ばないようにする */
            inputMode={keypadEnabled ? 'none' : 'numeric'}
            placeholder="0"
            value={amount}
            onChange={setAmount}
            onFocus={() => {
              if (silentFocusRef.current) return
              if (keypadEnabled) setKeypadOpen(true)
            }}
            // すでにフォーカスがある(編集シートを開いた直後など)ときは
            // onFocus が来ないので、タップでも開けるようにしておく
            onClick={() => keypadEnabled && setKeypadOpen(true)}
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

      {/* 機能219: 感情スタンプ。1タップで押せて、もう一度押すと未入力に戻せる */}
      {isExpense && satisfactionAvailable && (
        <div className="field">
          <span>この支出の気分(任意)</span>
          <div className="stamp-row" role="group" aria-label="この支出の気分">
            {SATISFACTION_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`stamp-btn ${satisfaction === o.value ? 'selected' : ''}`}
                aria-pressed={satisfaction === o.value}
                onClick={() => setSatisfaction(satisfaction === o.value ? null : o.value)}
              >
                <span className="stamp-emoji" aria-hidden="true">
                  {o.emoji}
                </span>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 必須でない項目は畳む。畳んだままでも中身が要約で分かるようにする */}
      <div className="detail-block">
        <button
          type="button"
          className="detail-toggle"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen(!detailsOpen)}
        >
          <span className="detail-toggle-label">日付・お店・メモ{isExpense ? '・彼女の分' : ''}</span>
          <span className="detail-toggle-summary">{detailSummary}</span>
          <span className="detail-toggle-caret" aria-hidden="true">
            {detailsOpen ? '▲' : '▼'}
          </span>
        </button>

        {detailsOpen && (
          <div className="form-col detail-body">
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
                    <div className="field">
                      <span>彼女の負担分(円) — 預かり残高から差し引かれます</span>
                      <AmountTextInput
                        ariaLabel="彼女の負担分"
                        inputMode="numeric"
                        placeholder="0"
                        value={partnerAmount}
                        onChange={setPartnerAmount}
                      />
                    </div>
                    <div className="quick-row">
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={!amountNum}
                        onClick={() =>
                          setPartnerAmount(normalizeAmountInput(String(Math.round(amountNum / 2))))
                        }
                      >
                        半分
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={!amountNum}
                        onClick={() => setPartnerAmount(normalizeAmountInput(String(amountNum)))}
                      >
                        全額
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      {/* 機能048: 主は「記録する」、副が「保存して続ける」 */}
      <div className="save-row">
        {!initial && (
          <button
            type="button"
            className="btn-secondary save-continue"
            disabled={!valid || busy}
            onClick={() => void submit(true)}
          >
            保存して続ける
          </button>
        )}
        <button className="btn-primary save-main" disabled={!valid || busy} onClick={() => void submit(false)}>
          {busy ? '保存中…' : submitLabel}
        </button>
      </div>

      {streak > 0 && (
        <p className="streak-note" aria-live="polite">
          続けて{streak}件記録しました(最後は {yen(lastSavedAmount)})
        </p>
      )}

      {onDelete && (
        <button className="btn-ghost" style={{ color: 'var(--expense)' }} disabled={busy} onClick={onDelete}>
          削除する
        </button>
      )}
    </div>
  )
}
