import { useState } from 'react'
import { resolveForSubmit, type CalcOp, type CalcState } from '../../lib/calc'

type Pending = { pendingValue: number | null; pendingOp: CalcOp | null }

// 同じ入れ物を使い回す。式が無いときに片付けても、描き直しが起きない
const NO_PENDING: Pending = { pendingValue: null, pendingOp: null }

/**
 * 電卓つきの金額欄1つぶんの状態 (支払い金額・彼女の負担分)。
 *
 * 「入力中の文字列」と「保留中の式(値と演算子)」を分けて持つ。
 * 欄ごとに別々に持つのは、片方で打ちかけた式がもう片方の金額に混ざると、
 * 保存される金額が黙って変わってしまうため。
 *
 * resolved は ＝ の押し忘れに備えて保留中の式を評価した値。保存される額・
 * 残高の見込み・保存できるかの判定は、どれもこの1つの値を見る。
 */
export function useCalcField(initialInput: string) {
  const [input, setInput] = useState(initialInput)
  const [pending, setPending] = useState<Pending>(NO_PENDING)
  const state: CalcState = { input, pendingValue: pending.pendingValue, pendingOp: pending.pendingOp }

  return {
    /** 入力中の文字列(数字だけ) */
    input,
    /** 手で打った文字列を入れる。保留中の式はそのまま(続けて ＝ を押せる) */
    setInput,
    state,
    resolved: resolveForSubmit(state).input,
    /** 電卓の状態機械(calc.ts)が返した次の状態をそのまま入れる */
    apply(next: CalcState) {
      setInput(next.input)
      setPending({ pendingValue: next.pendingValue, pendingOp: next.pendingOp })
    },
    /** 「半分」「全額」のように値を直接入れる。打ちかけの式は捨てる */
    setDirect(raw: string) {
      setInput(raw)
      setPending(NO_PENDING)
    },
    /** 打ちかけの式だけを捨てる(入力中の文字列は残す) */
    clearPending() {
      setPending(NO_PENDING)
    },
  }
}

export type CalcField = ReturnType<typeof useCalcField>
