import type { MutableRefObject } from 'react'
import {
  FAVOR_OPTIONS,
  MAX_FAVOR_FROM_LENGTH,
  favorNoticeText,
  type Favor,
  type FavorKind,
} from '../../lib/favors'
import { maskAmountsIn, yen } from '../../lib/format'
import AmountTaxKeys from '../AmountTaxKeys'
import AmountTextInput from '../AmountTextInput'
import type { CalcActions } from './PartnerMoneyField'
import type { CalcField } from './useCalcField'

/** チップに出す短い名前。長い名前は 320px 幅で語の途中から折り返していた */
const SHORT_LABEL: Record<FavorKind, string> = { treat: 'おごり', discount: '割引' }

interface Props {
  kind: FavorKind | null
  /** チップを押した。外したときの片付け(額・相手を消す)は呼ぶ側 */
  onKind: (kind: FavorKind | null) => void
  /** 浮いた額の欄(自前テンキーで打つ) */
  amountField: CalcField
  amountRef: MutableRefObject<HTMLInputElement | null>
  from: string
  onFrom: (name: string) => void
  /** おごってくれた人の候補(最近ご馳走になった順) */
  treatOptions: readonly string[]
  /** いまの入力から組み立てたおごり・値引き。額が無ければ null */
  favor: Favor | null
  /** 支払い金額 */
  paidAmount: number
  /** 「支払い金額は会計の合計だった」ときに、支払いを 合計 − 浮いた額 に直す */
  onPaidWasTotal: () => void
  /** 分割中は使えない(浮いた額を内訳に割り振れないため。splits.ts) */
  disabled: boolean
  keypadEnabled: boolean
  onOpenKeypad: () => void
  calc: CalcActions
}

/**
 * おごり・割引 (favors.ts)。「この支出について」の中に、押すだけのチップとして常に出す。
 *
 * 以前は気分・タグ・分割と一緒に畳んだ中にあり、ほとんど開かれなかった。
 * 選ぶまでは1行だけで、選ぶと額と相手の欄が開き、テンキーがその欄へ向く。
 * 既定は選ばれていない状態なので、触らなければ従来どおりの記録になる。
 */
export default function FavorField({
  kind,
  onKind,
  amountField,
  amountRef,
  from,
  onFrom,
  treatOptions,
  favor,
  paidAmount,
  onPaidWasTotal,
  disabled,
  keypadEnabled,
  onOpenKeypad,
  calc,
}: Props) {
  const option = FAVOR_OPTIONS.find((o) => o.kind === kind)
  const favorAmount = Number(amountField.resolved || 0)
  return (
    <div className="favor-field">
      <div className="favor-kinds" role="group" aria-label="おごり・割引">
        {FAVOR_OPTIONS.map((o) => (
          <button
            key={o.kind}
            type="button"
            className={`favor-chip${kind === o.kind ? ' selected' : ''}`}
            aria-pressed={kind === o.kind}
            disabled={disabled}
            data-keeps-keypad=""
            onClick={() => onKind(kind === o.kind ? null : o.kind)}
          >
            <span className="favor-chip-emoji" aria-hidden="true">
              {o.emoji}
            </span>
            {SHORT_LABEL[o.kind]}
          </button>
        ))}
      </div>
      {disabled && <p className="muted">分割中は、おごり・割引は付けられません</p>}

      {kind !== null && !disabled && (
        <>
          <div className="field">
            <span>{option?.amountLabel}</span>
            <AmountTextInput
              inputRef={amountRef}
              className="keypad-field"
              ariaLabel={option?.amountLabel ?? ''}
              inputMode={keypadEnabled ? 'none' : 'numeric'}
              placeholder="0"
              value={amountField.input}
              onChange={amountField.setInput}
              onFocus={onOpenKeypad}
              onClick={onOpenKeypad}
            />
            {/* 値引き額をそのまま打つ場所なので、OS キーボードのときは税込ボタンも置く */}
            {!keypadEnabled && (
              <AmountTaxKeys
                state={amountField.state}
                onApply={(next) => calc.apply('favor', next)}
                fieldLabel="おごり・値引き額"
              />
            )}
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
          {/* 支払い金額に「会計の合計(割引前の値段)」を打っていた回のための1タップの直し。
              支払い金額は「自分が実際に出した額」なので、合計から浮いた額を引く。
              押さなければ今のまま(支払い金額 = 自分が出した額)として保存する */}
          {favor !== null && paidAmount > favorAmount && (
            <button type="button" className="btn-ghost favor-fix" onClick={onPaidWasTotal}>
              {kind === 'treat'
                ? `支払い金額 ${yen(paidAmount)} は会計の合計だった → 自分の支払いを ${yen(paidAmount - favorAmount)} に直す`
                : `支払い金額 ${yen(paidAmount)} は割引前の値段だった → ${yen(paidAmount - favorAmount)} に直す`}
            </button>
          )}
          {favor === null && <p className="muted">金額を入れると、この記録に付きます(1円以上)</p>}
        </>
      )}
    </div>
  )
}
