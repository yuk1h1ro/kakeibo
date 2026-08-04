import { useRef, useState } from 'react'
import { yen } from '../../lib/format'

export interface VerticalDatum {
  label: string
  value: number
  /** 強調表示(棒の上に金額を出す)。選択中の月や最大値の目印に使う */
  emphasis?: boolean
}

// きりのいい目盛り(2〜4本)を計算する
function computeTicks(maxValue: number): { top: number; ticks: number[] } {
  const max = Math.max(maxValue, 1000)
  const pow = Math.pow(10, Math.floor(Math.log10(max)))
  for (const m of [0.25, 0.5, 1, 2, 2.5, 5]) {
    const step = m * pow
    const count = Math.ceil(max / step)
    if (count >= 2 && count <= 4) {
      const ticks: number[] = []
      for (let i = 1; i <= count; i++) ticks.push(step * i)
      return { top: step * count, ticks }
    }
  }
  return { top: max, ticks: [max / 2, max] }
}

/**
 * 縦棒グラフ。月次推移・曜日別・時間帯別で見た目を揃えるため、
 * ラベルと値の配列だけを受け取る汎用の描画に切り出してある(外部ライブラリは使わない)。
 */
export default function VerticalBars({
  data,
  ariaLabel,
}: {
  data: VerticalDatum[]
  ariaLabel: string
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; label: string; value: number } | null>(
    null
  )

  const maxV = Math.max(...data.map((d) => d.value), 0)
  const { top, ticks } = computeTicks(maxV)

  const VB_W = 360
  const leftPad = top.toLocaleString('ja-JP').length * 6.5 + 14
  const rightPad = 8
  const topPad = 22
  const plotH = 120
  const baseY = topPad + plotH
  const VB_H = baseY + 22
  const plotW = VB_W - leftPad - rightPad
  const slotW = plotW / data.length
  const barW = Math.min(24, slotW * 0.6)

  const yFor = (v: number) => baseY - (v / top) * plotH

  const showTip = (
    e: React.MouseEvent<SVGRectElement>,
    d: VerticalDatum,
    cx: number,
    barTopY: number
  ) => {
    const wrap = wrapRef.current
    const svg = e.currentTarget.ownerSVGElement
    if (!wrap || !svg) return
    const wr = wrap.getBoundingClientRect()
    const sr = svg.getBoundingClientRect()
    const scale = sr.width / VB_W
    setTip({
      x: sr.left - wr.left + cx * scale,
      y: sr.top - wr.top + barTopY * scale,
      label: d.label,
      value: d.value,
    })
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg
        className="chart-svg"
        width="100%"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="img"
        aria-label={ariaLabel}
        style={{ display: 'block' }}
      >
        {/* 水平グリッド線と目盛りラベル */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={leftPad}
              x2={VB_W - rightPad}
              y1={yFor(t)}
              y2={yFor(t)}
              stroke="var(--gridline)"
              strokeWidth={1}
            />
            <text
              x={leftPad - 6}
              y={yFor(t)}
              textAnchor="end"
              dominantBaseline="central"
              fontSize={11}
              fill="var(--text-muted)"
            >
              {t.toLocaleString('ja-JP')}
            </text>
          </g>
        ))}
        <text
          x={leftPad - 6}
          y={baseY}
          textAnchor="end"
          dominantBaseline="central"
          fontSize={11}
          fill="var(--text-muted)"
        >
          0
        </text>

        {/* ベースライン */}
        <line
          x1={leftPad}
          x2={VB_W - rightPad}
          y1={baseY}
          y2={baseY}
          stroke="var(--baseline)"
          strokeWidth={1}
        />

        {data.map((d, i) => {
          const cx = leftPad + slotW * i + slotW / 2
          const x = cx - barW / 2
          const yTop = yFor(d.value)
          const h = baseY - yTop
          const r = Math.min(4, barW / 2, h)
          // 上端のみ4px角丸、ベースラインは直角
          const path =
            `M ${x} ${baseY}` +
            ` L ${x} ${yTop + r}` +
            ` Q ${x} ${yTop} ${x + r} ${yTop}` +
            ` L ${x + barW - r} ${yTop}` +
            ` Q ${x + barW} ${yTop} ${x + barW} ${yTop + r}` +
            ` L ${x + barW} ${baseY} Z`
          return (
            <g key={d.label}>
              {h > 0 && <path d={path} fill="var(--accent)" />}
              {d.emphasis && (
                <text
                  x={cx}
                  y={yTop - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill="var(--text-secondary)"
                >
                  {yen(d.value)}
                </text>
              )}
              <text
                x={cx}
                y={baseY + 15}
                textAnchor="middle"
                fontSize={11}
                fill="var(--text-muted)"
              >
                {d.label}
              </text>
              {/* 棒より大きいスロット全幅のヒット領域 */}
              <rect
                x={leftPad + slotW * i}
                y={topPad - 12}
                width={slotW}
                height={plotH + 12}
                fill="transparent"
                onMouseEnter={(e) => showTip(e, d, cx, yTop)}
                onClick={(e) => showTip(e, d, cx, yTop)}
                onMouseLeave={() => setTip(null)}
              />
            </g>
          )
        })}
      </svg>

      {tip && (
        <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }}>
          <div className="tt-label">{tip.label}</div>
          <div className="tt-value">{yen(tip.value)}</div>
        </div>
      )}
    </div>
  )
}
