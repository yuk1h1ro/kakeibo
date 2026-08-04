// ============================================================
// 年月ピッカー (機能130)
//
// 何年も遡るのに ← を連打させない。既存の月送りは残したまま、
// 見出しの年月を押すとこのシートが開く(覚え直しが要らない足し方)。
// 記録がある月には点を打って、どこまで遡れるかを目で分かるようにする。
// ============================================================

import { useState } from 'react'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { formatMonth, monthKey } from '../lib/format'
import { monthCells, monthsWithRecords, selectableYears } from '../lib/monthJump'

interface Props {
  /** 表示中の月 ('YYYY-MM') */
  month: string
  /** 記録のある日付(選べる年と点の判定に使う) */
  txDates: readonly string[]
  todayIso: string
  onSelect: (month: string) => void
  onClose: () => void
}

export default function MonthPickerSheet({ month, txDates, todayIso, onSelect, onClose }: Props) {
  useBodyScrollLock()
  const years = selectableYears(txDates, todayIso)
  const [year, setYear] = useState(() => Number(month.slice(0, 4)))
  const withRecords = monthsWithRecords(txDates)
  const cells = monthCells(year, todayIso, withRecords)
  const currentMonth = monthKey(todayIso)

  const minYear = years[years.length - 1]
  const maxYear = years[0]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>年月を選ぶ</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <div className="hist-year-nav">
          <button
            onClick={() => setYear((y) => y - 1)}
            disabled={year <= minYear}
            aria-label="前の年"
          >
            ←
          </button>
          <span className="hist-year-label">{year}年</span>
          <button
            onClick={() => setYear((y) => y + 1)}
            disabled={year >= maxYear}
            aria-label="次の年"
          >
            →
          </button>
        </div>

        <div className="hist-month-grid">
          {cells.map((c) => {
            const cls = [
              c.key === month ? 'is-selected' : '',
              c.key === currentMonth ? 'is-current' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                key={c.key}
                className={cls}
                disabled={c.disabled}
                aria-label={formatMonth(c.key)}
                aria-pressed={c.key === month}
                onClick={() => {
                  onSelect(c.key)
                  onClose()
                }}
              >
                {c.month}月
                {c.hasRecords && <span className="hist-month-dot" aria-hidden="true" />}
              </button>
            )
          })}
        </div>

        <p className="muted" style={{ marginTop: 12 }}>
          点が付いている月には記録があります
        </p>
      </div>
    </div>
  )
}
