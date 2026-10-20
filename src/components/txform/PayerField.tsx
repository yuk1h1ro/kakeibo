import { yen } from '../../lib/format'
import type { Payer } from '../../lib/transactionDraft'
import AmountTaxKeys from '../AmountTaxKeys'
import AmountTextInput from '../AmountTextInput'

const PAYER_OPTIONS: readonly { id: Payer; label: string }[] = [
  { id: 'me', label: '自分が全額' },
  { id: 'partner', label: '彼女が全額' },
  { id: 'both', label: '分けて払った' },
]

interface Props {
  payer: Payer
  onPayer: (payer: Payer) => void
  /** 「分けて払った」ときに打つ、彼女が払った額(数字だけの文字列) */
  partnerPaidInput: string
  onPartnerPaidInput: (raw: string) => void
  /** 彼女が実際に払った額(partnerPaidAmount) */
  partnerPaid: number
  partnerPaidValid: boolean
  /** 彼女の負担分(「二人で使った」がオフなら 0) */
  partnerAmount: number
  withPartner: boolean
}

/**
 * 機能018: 誰が払ったか。既定の「自分が全額」は今までの前提そのものなので、
 * 触らなければ手数は増えない。彼女の分の続きなので、そのすぐ下に置く。
 */
export default function PayerField({
  payer,
  onPayer,
  partnerPaidInput,
  onPartnerPaidInput,
  partnerPaid,
  partnerPaidValid,
  partnerAmount,
  withPartner,
}: Props) {
  return (
    <div className="field">
      <span>支払った人</span>
      <div className="payer-row" role="group" aria-label="支払った人">
        {PAYER_OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            className={`payer-chip${payer === o.id ? ' selected' : ''}`}
            aria-pressed={payer === o.id}
            onClick={() => onPayer(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {payer === 'both' && (
        <>
          <div className="field">
            <span>そのうち彼女が払った額(円)</span>
            <AmountTextInput
              ariaLabel="彼女が払った額"
              inputMode="numeric"
              placeholder="0"
              value={partnerPaidInput}
              onChange={onPartnerPaidInput}
            />
            <AmountTaxKeys
              state={{ input: partnerPaidInput, pendingValue: null, pendingOp: null }}
              onApply={(next) => onPartnerPaidInput(next.input)}
              fieldLabel="彼女が払った額"
            />
          </div>
          {!partnerPaidValid && partnerPaidInput !== '' && (
            <p className="error-text">彼女が払った額は、支払い金額までにしてください</p>
          )}
        </>
      )}
      {payer !== 'me' && (
        <p className="muted payer-note">
          {`彼女が払った ${yen(partnerPaid || 0)} と負担分 ${yen(partnerAmount)} の差が、預かり残高に反映されます`}
        </p>
      )}
      {/* 「支払った人」と「二人で使った」は別々のスイッチなので、片方だけ押すと
          意図と逆に残高が動く。彼女がおごってくれた夕食で「彼女が全額」だけ押し、
          「二人で使った」を忘れると、総額がまるごと「彼女に返すお金」として
          残高に足される(彼女の分の差し引きが 0 になるため)。押せなくはしない —
          「自分ひとりの買い物を彼女が立て替えてくれた」も正しい使い方なので */}
      {payer !== 'me' && !withPartner && partnerPaid > 0 && (
        <p className="payer-warn" role="note">
          {`「二人で使った」がオフなので、彼女の負担は 0円 として扱われ、彼女が払った ${yen(partnerPaid)} がまるごと預かり残高に足されます。` +
            '彼女の分も含まれる会計なら、上の「二人で使った」をオンにして負担分を入れてください。'}
        </p>
      )}
    </div>
  )
}
