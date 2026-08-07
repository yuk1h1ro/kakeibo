import { useState } from 'react'
import { TAX_RATES, pressTax, taxNoticeText, type CalcState, type TaxApplied } from '../lib/calc'

interface Props {
  /**
   * 対象の金額欄の状態。電卓を持たない欄(彼女の負担分など)は
   * input だけを詰めて渡す(pendingValue / pendingOp は null)。
   */
  state: CalcState
  /** 税込にした結果を書き戻す。保留中の計算は解決済みなので、そのまま反映してよい */
  onApply: (next: CalcState) => void
  /** ％キーも出すか(電卓のある金額欄だけ)。押したときの遷移は親が持つ */
  onPercent?: () => void
  /** ％が効かない状態(保留中の演算子が無い)ことを、押す前に見せる */
  percentDisabled?: boolean
  /** 金額欄は画面に複数あるので、読み上げ名を欄ごとに分ける */
  fieldLabel?: string
}

/**
 * ％と「税込にする」 (機能043 の続き)。
 *
 * 利用者の要望は「小数点は要らない、%計算(とくに消費税)ができればいい」だった。
 * 消費税は買うたびに掛かるのに、＋ と × を組み合わせて 1000 × 110 ％ と打つのは
 * 毎回の手数が多い。なので日本の2つの税率(標準10% / 軽減8%)をそれぞれ
 * 1タップのボタンにしている。
 *
 * ---- 置き場所 ----
 * 電卓バーの1段目(＋ − × ＝)には足さず、その下の段に分けている。
 * 1段に7つ並べると 320px 幅で1キーが40px を切り、押し間違える。
 * 金額欄のすぐ下に置いているのは「いちばん使うのは金額を打った直後」だから。
 *
 * ---- 押した結果を見せる ----
 * 黙って数字だけが変わると打ち間違いと区別が付かないので、
 * 「1,000 → 税込 1,100(10%)」と押す前の額を並べて出す。
 * この行は金額欄の値が変わると自動で消える(state.input と結果を突き合わせるだけ)。
 * 目隠し(機能169)中も伏せない — すぐ上の金額欄が生の数字を出している以上、
 * ここだけ伏せても隠したことにならず、押した結果が読めなくなるだけのため。
 */
export default function AmountTaxKeys({
  state,
  onApply,
  onPercent,
  percentDisabled,
  fieldLabel,
}: Props) {
  const [applied, setApplied] = useState<TaxApplied | null>(null)

  // 押したあと金額欄が動いたら説明は用済み。状態を持ち回さず突き合わせで決める
  const notice = applied !== null && state.input === String(applied.after) ? taxNoticeText(applied) : ''

  const prefix = fieldLabel ? `${fieldLabel}を` : ''

  const run = (rate: (typeof TAX_RATES)[number]) => {
    const next = pressTax(state, rate)
    if (next === null) return
    setApplied(next)
    onApply(next.state)
  }

  return (
    <div
      className="percent-block"
      /* 押しても金額欄のフォーカスが外れないようにする(外れると自前テンキーが閉じる)。
         AmountKeypad と同じ理由・同じ手当て */
      onPointerDown={(e) => e.preventDefault()}
    >
      <div className={`percent-row${onPercent ? ' has-percent' : ''}`}>
        {onPercent && (
          <button
            type="button"
            className="calc-key"
            aria-label="パーセント"
            disabled={percentDisabled}
            onClick={onPercent}
          >
            ％
          </button>
        )}
        {TAX_RATES.map((rate) => (
          <button
            key={rate}
            type="button"
            className="calc-key tax-key"
            aria-label={`${prefix}税込にする(${rate}%)`}
            /* 押せない状態(空欄・0円)を押す前に見せる。押してから無反応より分かる */
            disabled={pressTax(state, rate) === null}
            onClick={() => run(rate)}
          >
            税込 +{rate}%
          </button>
        ))}
      </div>
      <p className="tax-notice" aria-live="polite">
        {notice}
      </p>
    </div>
  )
}
