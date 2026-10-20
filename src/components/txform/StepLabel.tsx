import type { ReactNode } from 'react'

/**
 * 主線の段の見出し(「1 カテゴリ」「2 お店」…)。
 * 番号は支出のときだけ出す — 預かり・返金・調整は段が少なく、番号が飛ぶと
 * かえって「どこか抜けている」ように読めるため(no を渡さなければ出ない)。
 */
export default function StepLabel({ no, children }: { no?: number; children: ReactNode }) {
  return (
    <span className="step-label">
      {no !== undefined && (
        <span className="step-no" aria-hidden="true">
          {no}
        </span>
      )}
      {children}
    </span>
  )
}
