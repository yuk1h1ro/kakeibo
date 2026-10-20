import {
  FAVOR_OPTIONS,
  MAX_FAVOR_FROM_LENGTH,
  favorNoticeText,
  type Favor,
  type FavorKind,
} from '../../lib/favors'
import { maskAmountsIn } from '../../lib/format'
import AmountTaxKeys from '../AmountTaxKeys'
import AmountTextInput from '../AmountTextInput'

interface Props {
  kind: FavorKind | null
  onKind: (kind: FavorKind | null) => void
  /** 浮いた額(数字だけの文字列) */
  amountInput: string
  onAmountInput: (raw: string) => void
  from: string
  onFrom: (name: string) => void
  /** おごってくれた人の候補(最近ご馳走になった順) */
  treatOptions: readonly string[]
  /** いまの入力から組み立てたおごり・値引き。額が無ければ null */
  favor: Favor | null
  /** 支払い金額(「本来いくらだったか」の説明に使う) */
  paidAmount: number
}

/**
 * おごり・値引き (favors.ts)。
 * 「割引券で無料になった」「ご馳走になった」回を、支出を膨らませずに残す。
 * 既定は選ばれていない状態なので、開いても何も押さなければ従来どおり。
 */
export default function FavorField({
  kind,
  onKind,
  amountInput,
  onAmountInput,
  from,
  onFrom,
  treatOptions,
  favor,
  paidAmount,
}: Props) {
  const option = FAVOR_OPTIONS.find((o) => o.kind === kind)
  return (
    <div className="field favor-field">
      <span>おごり・値引き(任意)</span>
      <div className="favor-kinds" role="group" aria-label="おごり・値引き">
        {FAVOR_OPTIONS.map((o) => (
          <button
            key={o.kind}
            type="button"
            className={`favor-chip${kind === o.kind ? ' selected' : ''}`}
            aria-pressed={kind === o.kind}
            onClick={() => {
              // もう一度押すと「無し」に戻る(気分スタンプと同じ操作感)。
              // 外したときに額と相手も消すのは、選び直したときに
              // 前の相手の名前が残っていると事実が入れ替わるため
              if (kind === o.kind) {
                onKind(null)
                onAmountInput('')
                onFrom('')
                return
              }
              onKind(o.kind)
              if (o.kind === 'discount') onFrom('')
            }}
          >
            <span className="favor-chip-emoji" aria-hidden="true">
              {o.emoji}
            </span>
            {o.label}
          </button>
        ))}
      </div>

      {kind !== null && (
        <>
          <div className="field">
            <span>{option?.amountLabel}</span>
            <AmountTextInput
              ariaLabel={option?.amountLabel ?? ''}
              inputMode="numeric"
              placeholder="0"
              value={amountInput}
              onChange={onAmountInput}
            />
            {/* 値引き額をそのまま打つ場所なので、
                ここにも税込ボタンを置く(電卓はこの欄に無いので ％ は出ない) */}
            <AmountTaxKeys
              state={{ input: amountInput, pendingValue: null, pendingOp: null }}
              onApply={(next) => onAmountInput(next.input)}
              fieldLabel="おごり・値引き額"
            />
          </div>

          {/* おごってくれた人。**この欄がこの機能の本体**。
              誰にご馳走になったかが残っていないと、お礼もお返しもできない。
              値引き(相手のいない好意)のときは出さない */}
          {kind === 'treat' && (
            <div className="field">
              <span>おごってくれた人(任意・{MAX_FAVOR_FROM_LENGTH}文字まで)</span>
              <input
                type="text"
                aria-label="おごってくれた人"
                placeholder="例: 田中 / 部長 / 先輩"
                value={from}
                autoComplete="off"
                maxLength={MAX_FAVOR_FROM_LENGTH}
                onChange={(e) => onFrom(e.target.value)}
              />
              {treatOptions.length > 0 && (
                <div className="tag-chips">
                  {treatOptions.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={`tag-chip${from === name ? ' is-on' : ''}`}
                      onClick={() => onFrom(from === name ? '' : name)}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 「本来いくらで、自分はいくら払うのか」を保存する前に読めるようにする。
              目隠し (機能169) 中は金額を伏せる */}
          {favor !== null && (
            <p className="favor-notice" aria-live="polite">
              {maskAmountsIn(favorNoticeText(favor, paidAmount > 0 ? paidAmount : 0))}
            </p>
          )}
          {favor === null && <p className="muted">金額を入れると、この記録に付きます(1円以上)</p>}
        </>
      )}
    </div>
  )
}
