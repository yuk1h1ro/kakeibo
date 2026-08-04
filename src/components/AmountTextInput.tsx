import { useLayoutEffect, useRef, type MutableRefObject } from 'react'
import { applyAmountEdit, formatAmountDisplay } from '../lib/amountFormat'

interface Props {
  /** 内部状態(数字だけの文字列)。電卓・テンキーが扱う値そのもの */
  value: string
  onChange: (raw: string) => void
  /** 金額欄の実体を親から触りたいとき(フォーカス移動など)に渡す */
  inputRef?: MutableRefObject<HTMLInputElement | null>
  className?: string
  ariaLabel: string
  /** 'none' = OS のキーボードを出さない(自前テンキー使用時) */
  inputMode: 'numeric' | 'none'
  placeholder?: string
  onFocus?: () => void
  /** タップされたとき(すでにフォーカスがある場合は onFocus が来ないため別に受ける) */
  onClick?: () => void
}

/**
 * 打つそばから 1,234 と桁区切りされる金額入力欄 (機能050)。
 *
 * type="number" ではカンマを表示できず setSelectionRange も使えないので、
 * type="text" + inputMode で数字キーボードを呼ぶ形にしている。
 * 親が持つ状態はあくまで「数字だけの文字列」で、カンマは表示専用
 * (電卓 calc.ts と自前テンキーの経路は一切変わらない)。
 *
 * キャレットは「前にある数字の個数」を保存して移し替えるので、
 * カンマが増減しても指した位置がずれない。
 */
export default function AmountTextInput({
  value,
  onChange,
  inputRef,
  className,
  ariaLabel,
  inputMode,
  placeholder,
  onFocus,
  onClick,
}: Props) {
  const localRef = useRef<HTMLInputElement | null>(null)
  // 次の描画後に戻すキャレット位置。null の間は触らない(選択範囲を壊さない)
  const caretRef = useRef<number | null>(null)

  const display = formatAmountDisplay(value)

  useLayoutEffect(() => {
    const el = localRef.current
    if (!el || caretRef.current === null) return
    const pos = caretRef.current
    caretRef.current = null
    // 値が同じで再描画されなかった場合に備え、ここでも位置を確定させる
    if (el.selectionStart !== pos || el.selectionEnd !== pos) el.setSelectionRange(pos, pos)
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = e.currentTarget
    const edit = applyAmountEdit(display, el.value, el.selectionStart ?? el.value.length)
    caretRef.current = edit.caret
    // 整形後の文字列が親の状態と同じ(= 再描画されない)ときでも表示を合わせるため、
    // DOM を直接書き戻してからキャレットを置く
    el.value = edit.display
    el.setSelectionRange(edit.caret, edit.caret)
    onChange(edit.raw)
  }

  return (
    <input
      ref={(el) => {
        localRef.current = el
        if (inputRef) inputRef.current = el
      }}
      type="text"
      className={className}
      aria-label={ariaLabel}
      inputMode={inputMode}
      /* 古い iOS Safari は pattern を見て数字キーボードを選ぶ */
      pattern="[0-9,]*"
      autoComplete="off"
      placeholder={placeholder}
      value={display}
      onChange={handleChange}
      onFocus={onFocus}
      onClick={onClick}
    />
  )
}
