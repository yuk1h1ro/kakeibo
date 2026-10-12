import type { ReactNode } from 'react'
import { OP_LABEL, type CalcOp, type CalcState } from '../lib/calc'
import AmountTaxKeys from './AmountTaxKeys'

/**
 * 電卓キーの読み上げ名。(純粋関数)
 *
 * 金額欄は画面に複数ある(支払い金額・彼女の負担分)。同じ「足す」が2つ並ぶと、
 * 読み上げでもテストでも、どちらの欄の足し算なのか区別が付かない。
 * 支払い金額は従来どおりの短い名前のまま、他の欄だけ欄の名前を前に付ける
 * (税込ボタンの「彼女の負担分を税込にする」と同じ付け方)。
 */
export function calcKeyLabels(fieldLabel?: string): Record<CalcOp | 'equals', string> {
  if (!fieldLabel) return { '+': '足す', '-': '引く', '×': '掛ける', equals: '計算する' }
  return {
    '+': `${fieldLabel}に足す`,
    '-': `${fieldLabel}から引く`,
    '×': `${fieldLabel}に掛ける`,
    equals: `${fieldLabel}を計算する`,
  }
}

const OPS: CalcOp[] = ['+', '-', '×']

interface Props {
  /** 対象の金額欄の状態(入力中の文字列と、保留中の式) */
  state: CalcState
  /**
   * ＋ − × ＝ の段を出すか。
   * 自前テンキーを開いている間は同じキーがパッドに出るので畳む。
   * ％と税込はパッドに無いので、こちらは常に出す
   */
  showKeys: boolean
  onOperator: (op: CalcOp) => void
  onEquals: () => void
  onPercent: () => void
  /** 税込にした結果を書き戻す */
  onApply: (next: CalcState) => void
  /** 支払い金額以外の欄で付ける。読み上げ名を欄ごとに分けるため */
  fieldLabel?: string
  /** 保留中の式の横に出す注意書き(支払い金額のマイナス警告など) */
  warning?: ReactNode
}

/**
 * 金額欄の下に付く電卓の段 (保留中の式 / ＋ − × ＝ / ％・税込)。
 *
 * 支払い金額にしか無かったものを、彼女の負担分にも同じ形で付けるために
 * 切り出した。挙動は calc.ts の同じ状態機械を通るので、欄によって
 * 計算の結果が変わることは無い。
 */
export default function AmountCalcBar({
  state,
  showKeys,
  onOperator,
  onEquals,
  onPercent,
  onApply,
  fieldLabel,
  warning,
}: Props) {
  const labels = calcKeyLabels(fieldLabel)
  return (
    <div className="calc-bar">
      <div className="calc-status" aria-live="polite">
        {state.pendingOp !== null && state.pendingValue !== null && (
          <span className="calc-pending">
            {state.pendingValue.toLocaleString('ja-JP')} {OP_LABEL[state.pendingOp]}
          </span>
        )}
        {warning}
      </div>
      {showKeys && (
        <div className="calc-keys">
          {OPS.map((op) => (
            <button
              key={op}
              type="button"
              className="calc-key"
              aria-label={labels[op]}
              onClick={() => onOperator(op)}
            >
              {OP_LABEL[op]}
            </button>
          ))}
          <button
            type="button"
            className="calc-key calc-key-equals"
            aria-label={labels.equals}
            onClick={onEquals}
          >
            ＝
          </button>
        </div>
      )}
      {/* ％と税込は、テンキーを開いている間も畳まない。
          テンキー側に同じボタンを重ねると押した結果の表示が2か所に分かれるので、
          ここ1か所に置いて、OSキーボードでも自前テンキーでも同じ場所を押させる */}
      <AmountTaxKeys
        state={state}
        onApply={onApply}
        onPercent={onPercent}
        /* 保留中の演算子が無いと ％ は何も起きないので、押す前にそう見せる */
        percentDisabled={state.pendingOp === null}
        fieldLabel={fieldLabel}
      />
    </div>
  )
}
