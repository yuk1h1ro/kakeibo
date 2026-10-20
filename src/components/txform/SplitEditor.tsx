import type { Category } from '../../lib/categories'
import { maskAmountsIn, yen } from '../../lib/format'
import {
  splitTotal,
  MAX_SPLIT_PARTS,
  MIN_SPLIT_PARTS,
  type SplitPart,
  type SplitValidation,
} from '../../lib/splits'
import AmountTextInput from '../AmountTextInput'
import { splitTarget, type AmountTarget, type SplitField } from './amountTarget'

interface Props {
  parts: readonly SplitPart[]
  categories: readonly Category[]
  /** 分割を開いたときに「上段の入力をどう扱ったか」を伝える1行 */
  notice: string | null
  validation: SplitValidation | null
  /** 支払い金額(内訳の合計と並べて見せる) */
  amount: number
  keypadEnabled: boolean
  /** 欄に出す文字列。打ちかけの式があればその途中の文字列 */
  inputOf: (target: AmountTarget) => string
  onCategory: (index: number, category: string | null) => void
  /** 手で打ち直した */
  onInput: (index: number, field: SplitField, raw: string) => void
  onOpenKeypad: (target: AmountTarget) => void
  onRemove: (index: number) => void
  onAdd: () => void
  onClose: () => void
}

/**
 * 機能096: 分割の内訳。1回の会計をカテゴリごとの独立した記録として残す。
 * 内訳の金額・負担分もパッドの電卓で足し引きできる。行が多くなるので
 * ＋ − × ＝ の段は置かず、パッドだけで扱う(PC では設定でテンキーをオンにすると使える)
 */
export default function SplitEditor({
  parts,
  categories,
  notice,
  validation,
  amount,
  keypadEnabled,
  inputOf,
  onCategory,
  onInput,
  onOpenKeypad,
  onRemove,
  onAdd,
  onClose,
}: Props) {
  return (
    <div className="split-block">
      <p className="muted">内訳ごとに1件ずつ記録します。上のカテゴリではなく、下の内訳のカテゴリで残ります</p>
      {notice && (
        // 目隠し (機能169) 中は、ここに出る金額も伏せる
        <p className="split-notice">{maskAmountsIn(notice)}</p>
      )}
      {parts.map((p, i) => (
        <div className="split-part" key={i}>
          <div className="split-part-head">
            <span>内訳 {i + 1}</span>
            {parts.length > MIN_SPLIT_PARTS && (
              <button type="button" className="btn-ghost" onClick={() => onRemove(i)}>
                削除
              </button>
            )}
          </div>
          <select
            className="split-cat-select"
            aria-label={`内訳 ${i + 1} のカテゴリ`}
            value={p.category ?? ''}
            onChange={(e) => onCategory(i, e.target.value === '' ? null : e.target.value)}
          >
            <option value="">カテゴリを選ぶ</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {(['amount', 'partnerAmount'] as const).map((field) => {
            const target = splitTarget(i, field)
            return (
              <AmountTextInput
                key={field}
                className="keypad-field"
                ariaLabel={`内訳 ${i + 1} の${field === 'amount' ? '金額' : '彼女の負担分'}`}
                inputMode={keypadEnabled ? 'none' : 'numeric'}
                placeholder={field === 'amount' ? '金額' : '彼女の負担分(任意)'}
                value={inputOf(target)}
                onChange={(v) => onInput(i, field, v)}
                onFocus={() => onOpenKeypad(target)}
                onClick={() => onOpenKeypad(target)}
              />
            )
          })}
        </div>
      ))}
      <p className={`split-remaining${validation && !validation.ok ? ' is-off' : ''}`} aria-live="polite">
        内訳の合計 {yen(splitTotal(parts))} / 支払い {yen(amount || 0)}
        {/* 目隠し (機能169) 中は、残りの金額も伏せる。
            すぐ上の合計だけ伏せて残額が見えていては意味がない */}
        {validation?.message ? ` — ${maskAmountsIn(validation.message)}` : ' — そろっています'}
      </p>
      <div className="split-actions">
        <button type="button" className="btn-ghost" disabled={parts.length >= MAX_SPLIT_PARTS} onClick={onAdd}>
          内訳を足す
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          分割をやめる
        </button>
      </div>
    </div>
  )
}
