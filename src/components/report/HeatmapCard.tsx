import { useMemo, useState } from 'react'
import type { Transaction } from '../../lib/types'
import { formatDate, formatMonth, yen } from '../../lib/format'
import { WEEKDAY_LABELS } from '../../lib/calendar'
import { HEAT_LEVELS, monthHeatmap } from '../../lib/reportHeatmap'

interface Props {
  transactions: Transaction[]
  month: string
}

/**
 * セルに入れる短い金額表記。セル幅が iPhone で 45px 前後しか無いので、
 * 千円単位に丸める。ただし千円未満は丸めると 0 になってしまうので、
 * そのときだけ円のまま出す(¥ を付けて単位の取り違えを防ぐ)。
 */
function shortAmount(v: number): string {
  if (v <= 0) return ''
  if (v < 1000) return `¥${v}`
  if (v < 10000) return `${(v / 1000).toFixed(1)}千`
  return `${Math.round(v / 1000).toLocaleString('ja-JP')}千`
}

/**
 * カレンダーのヒートマップ (機能113)。
 *
 * 履歴タブのカレンダーとは独立した表示にしてある(あちらは明細を開くための
 * 導線、こちらは「どの日に多く使ったか」を俯瞰するためのもの)。
 * 色は --accent の濃さだけで作り、各セルに金額も出す = 色が判別できなくても読める。
 */
export default function HeatmapCard({ transactions, month }: Props) {
  const heat = useMemo(() => monthHeatmap(transactions, month), [transactions, month])
  const [selected, setSelected] = useState<string | null>(null)

  const selectedCell = heat.weeks.flat().find((c) => c !== null && c.iso === selected) ?? null

  return (
    <div className="card">
      <h2>日別ヒートマップ</h2>
      <p className="muted rp-heat-caption">
        {formatMonth(month)}の使った額。色が濃い日ほど多く、金額も各日に出しています(単位は千円。
        千円未満は ¥ 表記)。
      </p>

      <div className="rp-heat-grid" role="grid" aria-label={`${formatMonth(month)}の日別支出`}>
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="rp-heat-head" aria-hidden="true">
            {w}
          </div>
        ))}
        {heat.weeks.flat().map((cell, i) =>
          cell === null ? (
            <div key={`empty-${i}`} className="rp-heat-cell rp-heat-empty" aria-hidden="true" />
          ) : (
            <button
              key={cell.iso}
              type="button"
              className={`rp-heat-cell${selected === cell.iso ? ' selected' : ''}`}
              // 濃さは inline で渡す(段階ごとにクラスを作るより、段階数の変更に強い)
              style={{ '--heat': cell.level / HEAT_LEVELS } as React.CSSProperties}
              aria-label={`${formatDate(cell.iso)} ${cell.total > 0 ? yen(cell.total) : '支出なし'}`}
              aria-pressed={selected === cell.iso}
              onClick={() => setSelected(selected === cell.iso ? null : cell.iso)}
            >
              {/* 濃さは別レイヤーの不透明度で作る。文字にまで透明度がかかると
                  金額が読めなくなるため、面と文字を分けている */}
              <span className="rp-heat-fill" aria-hidden="true" />
              <span className="rp-heat-day">{cell.day}</span>
              <span className="rp-heat-amount">{shortAmount(cell.total)}</span>
            </button>
          )
        )}
      </div>

      {/* 凡例。段階と金額の対応を出しておかないと「濃い」が何を意味するか分からない */}
      {heat.max > 0 && (
        <div className="rp-heat-legend">
          <span className="rp-heat-legend-label">少ない</span>
          {Array.from({ length: HEAT_LEVELS }, (_, i) => (
            <span
              key={i}
              className="rp-heat-swatch"
              style={{ '--heat': (i + 1) / HEAT_LEVELS } as React.CSSProperties}
              aria-hidden="true"
            />
          ))}
          <span className="rp-heat-legend-label">多い(最大 {yen(heat.max)})</span>
        </div>
      )}

      <p className="rp-heat-detail" aria-live="polite">
        {selectedCell
          ? `${formatDate(selectedCell.iso)} ${yen(selectedCell.total)}(${selectedCell.count}件)`
          : `支出のあった日 ${heat.activeDays}日・合計 ${yen(heat.total)}(日をタップすると金額が出ます)`}
      </p>
    </div>
  )
}
