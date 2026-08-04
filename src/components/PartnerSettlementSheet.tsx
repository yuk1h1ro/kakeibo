import { useState } from 'react'
import AmountTextInput from './AmountTextInput'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { todayISO, yen } from '../lib/format'
import { balanceWording } from '../lib/partnerBalance'
import type { TransactionInput } from '../hooks/useTransactions'
import '../ledger.css'

// ============================================================
// 預かり金の「返金」「現金で受け取り」「手動調整」 (機能012)
//
// 3つとも **必ず履歴に残る1件の記録** として保存する。あとから
// 「なぜ残高が変わったのか」を追えることが、この預かり金の信頼の担保なので、
// 残高だけをこっそり書き換える操作は用意しない(調整も記録として残す)。
//
// 種別の対応:
//   返す           → partner_refund  (残高 −)
//   現金で受け取り → partner_deposit (残高 +。既存の「預かり」と同じ意味なので
//                                     専用の型は作らない。詳しくは types.ts)
//   調整           → partner_adjust  (残高 ±。amount が符号つき)
// ============================================================

type Mode = 'refund' | 'receive' | 'adjust'

interface ModeDef {
  id: Mode
  label: string
  /** 見出しの下に出す1行 */
  hint: string
  amountLabel: string
  memoPlaceholder: string
  submitLabel: string
}

const MODES: readonly ModeDef[] = [
  {
    id: 'refund',
    label: '返す',
    hint: '余った預かり金を彼女に返したときに記録します',
    amountLabel: '返した金額(円)',
    memoPlaceholder: '例: 8月末に現金で返した',
    submitLabel: '返金を記録',
  },
  {
    id: 'receive',
    label: '受け取る',
    hint: '彼女から現金を受け取ったときに記録します(預かりと同じ扱いです)',
    amountLabel: '受け取った金額(円)',
    memoPlaceholder: '例: 立て替え分を現金でもらった',
    submitLabel: '受け取りを記録',
  },
  {
    id: 'adjust',
    label: '調整',
    hint: '数え間違いなどのズレを直します。理由も一緒に残ります',
    amountLabel: '調整する金額(円)',
    memoPlaceholder: '例: 7/3 の割り勘の計算違いを修正',
    submitLabel: '調整を記録',
  },
]

interface Props {
  /** いまの預かり残高。操作後の残高を出すために受け取る */
  balance: number
  onSubmit: (input: TransactionInput) => Promise<void>
  onClose: () => void
}

export default function PartnerSettlementSheet({ balance, onSubmit, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('refund')
  // 調整だけは向きを選ばせる(符号を数字に埋めさせない — 打ち間違いのもと)
  const [adjustSign, setAdjustSign] = useState<1 | -1>(1)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayISO())
  const [memo, setMemo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBodyScrollLock()

  const def = MODES.find((m) => m.id === mode) ?? MODES[0]
  const amountNum = Number(amount || 0)
  const valid = Number.isInteger(amountNum) && amountNum > 0 && !busy

  // 残高への影響額(符号つき)
  const impact = mode === 'refund' ? -amountNum : mode === 'receive' ? amountNum : adjustSign * amountNum
  const after = balance + impact
  const afterWording = balanceWording(after)

  const submit = async () => {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        date,
        type: mode === 'refund' ? 'partner_refund' : mode === 'receive' ? 'partner_deposit' : 'partner_adjust',
        // 調整だけは符号つきで保存する(残高への影響がそのまま amount)
        amount: mode === 'adjust' ? adjustSign * amountNum : amountNum,
        category: null,
        memo: memo.trim(),
        store: '',
        partner_amount: 0,
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>預かりの精算</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <div className="settle-modes" role="group" aria-label="操作の種類">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`settle-mode${mode === m.id ? ' selected' : ''}`}
              aria-pressed={mode === m.id}
              onClick={() => {
                setMode(m.id)
                setError(null)
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="muted settle-hint">{def.hint}</p>

        {mode === 'adjust' && (
          <div className="field">
            <span>どちらに直しますか</span>
            <div className="settle-modes" role="group" aria-label="調整の向き">
              <button
                type="button"
                className={`settle-mode${adjustSign === 1 ? ' selected' : ''}`}
                aria-pressed={adjustSign === 1}
                onClick={() => setAdjustSign(1)}
              >
                残高を増やす
              </button>
              <button
                type="button"
                className={`settle-mode${adjustSign === -1 ? ' selected' : ''}`}
                aria-pressed={adjustSign === -1}
                onClick={() => setAdjustSign(-1)}
              >
                残高を減らす
              </button>
            </div>
          </div>
        )}

        <div className="field">
          <span>{def.amountLabel}</span>
          <AmountTextInput
            ariaLabel={def.amountLabel}
            inputMode="numeric"
            placeholder="0"
            value={amount}
            onChange={setAmount}
          />
        </div>

        <div className="field">
          <span>日付</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <label className="field">
          <span>{mode === 'adjust' ? '理由(あとで見返すために書いておくと安心です)' : 'メモ(任意)'}</span>
          <input
            type="text"
            placeholder={def.memoPlaceholder}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </label>

        {amountNum > 0 && (
          <p className="settle-preview" aria-live="polite">
            この記録のあと: <strong>{yen(afterWording.magnitude)}</strong>({afterWording.title})
          </p>
        )}

        {error && <p className="error-text">{error}</p>}

        <button className="btn-primary" disabled={!valid} onClick={() => void submit()}>
          {busy ? '保存中…' : def.submitLabel}
        </button>
        <p className="muted settle-note">
          どの操作も履歴に1件の記録として残ります(あとから編集・削除もできます)。
          日付・金額と、ここに書いた{mode === 'adjust' ? '理由' : 'メモ'}は
          <strong>共有リンクの画面にも表示されます</strong>
          — 残高が動いた理由を彼女からも追えるようにするためです
        </p>
      </div>
    </div>
  )
}
