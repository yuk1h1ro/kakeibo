import StepLabel from './StepLabel'

interface Props {
  date: string
  onDate: (date: string) => void
  /** 1タップで選べる日付(今日・昨日・一昨日) */
  chips: readonly { label: string; value: string }[]
  /** 主線の段の番号。支出のときだけ渡す */
  stepNo?: number
}

/**
 * 5. 日付。ほとんどの場合は「今日」のままなので、いちばん下にあっても手数は増えない。
 * 畳まずに出しているので、選ばれている日はスクロールすれば必ず見える
 */
export default function DateStep({ date, onDate, chips, stepNo }: Props) {
  return (
    <div className="field form-step">
      <StepLabel no={stepNo}>日付</StepLabel>
      <div className="date-quick">
        {chips.map((c) => (
          <button
            key={c.label}
            type="button"
            className={`date-chip ${date === c.value ? 'selected' : ''}`}
            onClick={() => onDate(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <input type="date" value={date} onChange={(e) => onDate(e.target.value)} />
    </div>
  )
}
