import type { MutableRefObject } from 'react'
import type { CalcOp, CalcState } from '../../lib/calc'
import { yen } from '../../lib/format'
import type { Payer, ShareMode } from '../../lib/transactionDraft'
import AmountCalcBar from '../AmountCalcBar'
import AmountTaxKeys from '../AmountTaxKeys'
import AmountTextInput from '../AmountTextInput'
import StepLabel from './StepLabel'
import type { AmountTarget } from './amountTarget'
import type { CalcField } from './useCalcField'

const SHARE_OPTIONS: readonly { id: ShareMode; label: string }[] = [
  { id: 'none', label: 'なし' },
  { id: 'half', label: '半分' },
  { id: 'all', label: '全部' },
  { id: 'custom', label: '金額…' },
]

const PAYER_OPTIONS: readonly { id: Payer; label: string }[] = [
  { id: 'me', label: '自分' },
  { id: 'partner', label: '彼女' },
  { id: 'both', label: '分けて…' },
]

/** 電卓の操作。行き先(どの欄か)は呼ぶ側が名指しする */
export interface CalcActions {
  operator: (target: AmountTarget, op: CalcOp) => void
  equals: (target: AmountTarget) => void
  percent: (target: AmountTarget) => void
  apply: (target: AmountTarget, next: CalcState) => void
}

interface Props {
  stepNo?: number
  /** 金額を打ち終えたとき、テンキーの上にこの段まで見せるための目印 */
  rowRef: MutableRefObject<HTMLDivElement | null>
  shareMode: ShareMode
  onShareMode: (mode: ShareMode) => void
  /** いまの入れ方で決まる彼女の負担の額 */
  shareAmount: number
  /** 「金額…」で打つ欄 */
  customField: CalcField
  customRef: MutableRefObject<HTMLInputElement | null>
  /** 払った人を聞くか(partner_paid 列が無い古いサーバーでは聞かない) */
  payerAvailable: boolean
  payer: Payer
  onPayer: (payer: Payer) => void
  /** 「分けて…」で打つ欄 */
  paidField: CalcField
  paidRef: MutableRefObject<HTMLInputElement | null>
  partnerPaidValid: boolean
  keypadEnabled: boolean
  /** 欄をタップした(パッドをその欄へ向け直す) */
  onOpenKeypad: (target: AmountTarget) => void
  calc: CalcActions
  /** 押す前に見せる、預かり残高がどう動くか (settlementPreview) */
  preview: { changed: boolean; text: string }
}

/**
 * ④ 彼女とのお金 — 「彼女の負担」と「払った人」を同じ形の2行で聞き、結果をすぐ下に出す。
 *
 * 1件が預かり残高に効く額は「彼女が払った額 − 彼女の負担」の1式で決まる。
 * 以前はこの2つを、形の違う部品(「二人で使った」のスイッチ+欄+半分/全額、
 * 3択のチップ)で離れた場所に入れさせていて、2つで1組だと伝わらなかった。
 * 「彼女が全額」だけ押して「二人で使った」を忘れる回を黄色い警告で補っていたが、
 * その警告は正しい立て替え(自分の物を彼女が払った)でも出ていた。
 * 選んだ場所で結果が読めれば、警告は要らない。
 *
 * 保存する中身は今までと同じ2列(partner_amount / partner_paid)で、
 * どの組み合わせも記録できる(transactionDraft.ts の partnerShareAmount / partnerPaidAmount)。
 */
export default function PartnerMoneyField({
  stepNo,
  rowRef,
  shareMode,
  onShareMode,
  shareAmount,
  customField,
  customRef,
  payerAvailable,
  payer,
  onPayer,
  paidField,
  paidRef,
  partnerPaidValid,
  keypadEnabled,
  onOpenKeypad,
  calc,
  preview,
}: Props) {
  return (
    <div className="field form-step partner-money">
      <StepLabel no={stepNo}>彼女とのお金</StepLabel>

      <div className="money-line" ref={rowRef}>
        <span className="money-line-label">彼女の負担</span>
        <div className="money-chips" role="group" aria-label="彼女の負担">
          {SHARE_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`money-chip${shareMode === o.id ? ' selected' : ''}`}
              aria-pressed={shareMode === o.id}
              // 「金額…」は押すとその場でテンキーを負担の欄へ向ける
              data-keeps-keypad={o.id === 'custom' ? '' : undefined}
              onClick={() => onShareMode(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {(shareMode === 'half' || shareMode === 'all') && (
        <p className="money-sub">
          彼女の負担 {yen(shareAmount)}
          <span className="muted">(支払い金額に合わせて変わります)</span>
        </p>
      )}
      {shareMode === 'custom' && (
        <div className="field money-input">
          <AmountTextInput
            inputRef={customRef}
            className="keypad-field"
            ariaLabel="彼女の負担分"
            inputMode={keypadEnabled ? 'none' : 'numeric'}
            placeholder="彼女の負担(円)"
            value={customField.input}
            onChange={customField.setInput}
            onFocus={() => onOpenKeypad('partner')}
            onClick={() => onOpenKeypad('partner')}
          />
          {/* 自前テンキーには ＋ − × ＝ があるので、電卓の段は OS キーボードのときだけ出す
              (以前は2つ目の電卓の段が「半分」を画面の下へ押し出していた) */}
          {!keypadEnabled && (
            <AmountCalcBar
              state={customField.state}
              showKeys
              fieldLabel="彼女の負担分"
              onOperator={(op) => calc.operator('partner', op)}
              onEquals={() => calc.equals('partner')}
              onPercent={() => calc.percent('partner')}
              onApply={(next) => calc.apply('partner', next)}
            />
          )}
        </div>
      )}

      {payerAvailable && (
        <>
          <div className="money-line">
            <span className="money-line-label">払った人</span>
            <div className="money-chips" role="group" aria-label="払った人">
              {PAYER_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`money-chip${payer === o.id ? ' selected' : ''}`}
                  aria-pressed={payer === o.id}
                  data-keeps-keypad={o.id === 'both' ? '' : undefined}
                  onClick={() => onPayer(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          {payer === 'both' && (
            <div className="field money-input">
              <AmountTextInput
                inputRef={paidRef}
                className="keypad-field"
                ariaLabel="彼女が払った額"
                inputMode={keypadEnabled ? 'none' : 'numeric'}
                placeholder="彼女が払った額(円)"
                value={paidField.input}
                onChange={paidField.setInput}
                onFocus={() => onOpenKeypad('partnerPaid')}
                onClick={() => onOpenKeypad('partnerPaid')}
              />
              {!keypadEnabled && (
                <AmountTaxKeys
                  state={paidField.state}
                  onApply={(next) => calc.apply('partnerPaid', next)}
                  fieldLabel="彼女が払った額"
                />
              )}
              {!partnerPaidValid && paidField.input !== '' && (
                <p className="error-text">彼女が払った額は、支払い金額までにしてください</p>
              )}
            </div>
          )}
        </>
      )}

      <p className={`settle-preview${preview.changed ? ' is-changed' : ''}`} aria-live="polite">
        {preview.text}
      </p>
    </div>
  )
}
