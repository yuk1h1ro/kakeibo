import { SATISFACTION_OPTIONS } from '../../lib/satisfaction'
import type { Satisfaction } from '../../lib/types'

/** 機能219: 感情スタンプ。1タップで押せて、もう一度押すと未入力に戻せる */
export default function SatisfactionField({
  value,
  onChange,
}: {
  value: Satisfaction | null
  onChange: (value: Satisfaction | null) => void
}) {
  return (
    <div className="field">
      <span>この支出の気分(任意)</span>
      <div className="stamp-row" role="group" aria-label="この支出の気分">
        {SATISFACTION_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`stamp-btn ${value === o.value ? 'selected' : ''}`}
            aria-pressed={value === o.value}
            onClick={() => onChange(value === o.value ? null : o.value)}
          >
            <span className="stamp-emoji" aria-hidden="true">
              {o.emoji}
            </span>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
