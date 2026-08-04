import { Fragment } from 'react'
import { OP_LABEL, type CalcOp } from '../lib/calc'

interface Props {
  /** 保留中の式(例: 350 ＋)。無ければ null */
  pending: { value: number; op: CalcOp } | null
  onDigits: (digits: string) => void
  onBackspace: () => void
  onOperator: (op: CalcOp) => void
  onEquals: () => void
  onClear: () => void
  onDone: () => void
}

const DIGIT_ROWS: string[][] = [
  ['7', '8', '9'],
  ['4', '5', '6'],
  ['1', '2', '3'],
]

// 各数字行の右端に置く機能キー(1行目だけ削除、以降は演算子)
const SIDE_KEYS: { op: CalcOp; label: string }[] = [
  { op: '+', label: '足す' },
  { op: '-', label: '引く' },
]

/**
 * 金額入力用の自前テンキー (機能052)。
 *
 * OS のキーボードは1キーが小さく、＋ − × も無いので、
 * 演算子まで含めた1枚のキーパッドとして画面下部に固定する。
 * 数字も演算子も calc.ts の同じ状態機械を通すので、挙動は従来の電卓バーと同じ。
 *
 * onPointerDown で既定動作を止めているのは、キーを押しても金額欄の
 * フォーカスが外れないようにするため(外れるとパッドが閉じてしまう)。
 */
export default function AmountKeypad({
  pending,
  onDigits,
  onBackspace,
  onOperator,
  onEquals,
  onClear,
  onDone,
}: Props) {
  return (
    <div
      className="keypad-dock"
      onPointerDown={(e) => e.preventDefault()}
      role="group"
      aria-label="金額入力のテンキー"
    >
      <div className="keypad-status" aria-live="polite">
        {pending && (
          <span className="calc-pending">
            {pending.value.toLocaleString('ja-JP')} {OP_LABEL[pending.op]}
          </span>
        )}
      </div>
      <div className="keypad-grid">
        {DIGIT_ROWS.map((row, i) => (
          <Fragment key={row.join('')}>
            {row.map((d) => (
              <button key={d} type="button" className="keypad-key" onClick={() => onDigits(d)}>
                {d}
              </button>
            ))}
            {i === 0 ? (
              <button
                type="button"
                className="keypad-key keypad-fn"
                aria-label="1文字消す"
                onClick={onBackspace}
              >
                ⌫
              </button>
            ) : (
              <button
                type="button"
                className="keypad-key keypad-fn"
                aria-label={SIDE_KEYS[i - 1].label}
                onClick={() => onOperator(SIDE_KEYS[i - 1].op)}
              >
                {OP_LABEL[SIDE_KEYS[i - 1].op]}
              </button>
            )}
          </Fragment>
        ))}

        <button type="button" className="keypad-key keypad-wide" onClick={() => onDigits('0')}>
          0
        </button>
        <button type="button" className="keypad-key" onClick={() => onDigits('00')}>
          00
        </button>
        <button
          type="button"
          className="keypad-key keypad-fn"
          aria-label="掛ける"
          onClick={() => onOperator('×')}
        >
          {OP_LABEL['×']}
        </button>

        <button
          type="button"
          className="keypad-key keypad-wide keypad-fn"
          aria-label="金額をクリア"
          onClick={onClear}
        >
          C
        </button>
        <button
          type="button"
          className="keypad-key keypad-equals"
          aria-label="計算する"
          onClick={onEquals}
        >
          ＝
        </button>
        <button type="button" className="keypad-key keypad-done" onClick={onDone}>
          完了
        </button>
      </div>
    </div>
  )
}
