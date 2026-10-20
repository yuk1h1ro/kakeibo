import type { MutableRefObject } from 'react'
import { normalizeAmountInput } from '../../lib/amountFormat'
import type { CalcOp, CalcState } from '../../lib/calc'
import type { Payer } from '../../lib/transactionDraft'
import AmountCalcBar from '../AmountCalcBar'
import AmountTextInput from '../AmountTextInput'
import type { CalcField } from './useCalcField'

interface Props {
  withPartner: boolean
  /** 「二人で使った」を押した。外したときの片付けは呼ぶ側 */
  onToggle: () => void
  payer: Payer
  field: CalcField
  inputRef: MutableRefObject<HTMLInputElement | null>
  keypadEnabled: boolean
  keypadOpen: boolean
  /** この欄をタップした(パッドをこちらへ向け直す) */
  onOpenKeypad: () => void
  onOperator: (op: CalcOp) => void
  onEquals: () => void
  onPercent: () => void
  onApply: (next: CalcState) => void
  /** 「半分」「全額」の元になる支払い金額 */
  amount: number
}

/** 「二人で使った」と、彼女の負担分 */
export default function PartnerShareField({
  withPartner,
  onToggle,
  payer,
  field,
  inputRef,
  keypadEnabled,
  keypadOpen,
  onOpenKeypad,
  onOperator,
  onEquals,
  onPercent,
  onApply,
  amount,
}: Props) {
  return (
    <div className="form-col">
      {/* 「まとめて払った」ではなく「二人で使った」。
          下に「支払った人」(機能018)があり、彼女が全額払った回も記録できる。
          名前が「払った」だと、そのときオンにするのが日本語として変になる。
          このトグルが言いたいのは「誰が払ったか」ではなく
          「この支出に彼女の分が入っているか」なので、出来事の側を書く。
          おごった回もオンにして負担分を 0 にできる(0 は有効な値) */}
      <button type="button" className={`partner-toggle ${withPartner ? 'on' : ''}`} onClick={onToggle}>
        <span>二人で使った</span>
        <span className="toggle-check">{withPartner ? '✓' : ''}</span>
      </button>
      {withPartner && (
        <>
          <div className="field">
            <span>
              彼女の負担分(円)
              {/* 彼女が払った回は「差し引かれる」とは限らない(下の支払った人の説明に任せる) */}
              {payer === 'me' && ' — 預かり残高から差し引かれます'}
            </span>
            {/* 支払い金額と同じ電卓が使える。
                「彼女が頼んだ 1,280 と 450」のように、レシートの何行かを
                足して負担分を出す場面が多いので、アプリの外の電卓に
                行き来しなくて済むようにする。パッドは支払い金額と共有で、
                この欄をタップするとこちらに向き直る */}
            <AmountTextInput
              inputRef={inputRef}
              ariaLabel="彼女の負担分"
              inputMode={keypadEnabled ? 'none' : 'numeric'}
              placeholder="0"
              value={field.input}
              onChange={field.setInput}
              onFocus={onOpenKeypad}
              onClick={onOpenKeypad}
            />
            <AmountCalcBar
              state={field.state}
              showKeys={!keypadOpen}
              fieldLabel="彼女の負担分"
              onOperator={onOperator}
              onEquals={onEquals}
              onPercent={onPercent}
              onApply={onApply}
            />
          </div>
          <div className="quick-row">
            <button
              type="button"
              className="btn-ghost"
              disabled={!amount}
              onClick={() => field.setDirect(normalizeAmountInput(String(Math.round(amount / 2))))}
            >
              半分
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={!amount}
              onClick={() => field.setDirect(normalizeAmountInput(String(amount)))}
            >
              全額
            </button>
          </div>
        </>
      )}
    </div>
  )
}
