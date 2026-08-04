import { useRef, useState } from 'react'
import { yen } from '../lib/format'
import { compactYen, type MonthlyNetWorth } from '../lib/netWorth'

// 純資産の推移(折れ線)。既存のグラフと同じく SVG を自前で描く(外部ライブラリなし)。
//
// 支出の縦棒(VerticalBars)と分けているのは、純資産が
// 「0 をまたいでマイナスにもなる連続量」だからで、棒の高さでは表せないため。
// 0 の線を必ず引き、線と 0 の間を薄く塗ることで符号が一目で分かるようにしている。

const VB_W = 360
const PLOT_H = 120
const TOP_PAD = 24
const RIGHT_PAD = 10
const BOTTOM_PAD = 22

interface Scale {
  bottom: number
  top: number
  ticks: number[]
}

/** きりのいい目盛りを2〜5本作る。0 は必ず含める(純資産の符号が読めるように) */
function niceScale(minV: number, maxV: number): Scale {
  const lo = Math.min(0, minV)
  const hi = Math.max(0, maxV)
  const span = Math.max(hi - lo, 1000)
  const pow = Math.pow(10, Math.floor(Math.log10(span)))
  let step = pow
  for (const m of [0.25, 0.5, 1, 2, 2.5, 5, 10]) {
    step = m * pow
    const count = Math.ceil(hi / step) - Math.floor(lo / step)
    if (count >= 2 && count <= 5) break
  }
  const bottom = Math.floor(lo / step) * step
  const top = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(Math.round(v))
  return { bottom, top, ticks }
}

/** 'YYYY-MM' → 'M月'(1月だけは年が変わったと分かるように 'YY年1月') */
function monthLabel(month: string): string {
  const [y, m] = month.split('-')
  return m === '01' ? `${y.slice(2)}年1月` : `${Number(m)}月`
}

export default function NetWorthChart({ data }: { data: MonthlyNetWorth[] }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; label: string; value: number } | null>(null)

  const values = data.map((d) => d.netWorth)
  const { bottom, top, ticks } = niceScale(Math.min(...values), Math.max(...values))
  // 目盛りラベルの文字数から左余白を決める(長い数字でも軸が重ならないように)
  const labelWidth = Math.max(...ticks.map((t) => compactYen(t).length)) * 6.5 + 10
  const leftPad = Math.min(labelWidth, 70)
  const baseY = TOP_PAD + PLOT_H
  const VB_H = baseY + BOTTOM_PAD
  const plotW = VB_W - leftPad - RIGHT_PAD

  const yFor = (v: number) => baseY - ((v - bottom) / (top - bottom)) * PLOT_H
  // 点が1つだけのときは中央に置く(0除算を避ける)
  const xFor = (i: number) =>
    data.length === 1 ? leftPad + plotW / 2 : leftPad + (plotW * i) / (data.length - 1)

  const zeroY = yFor(0)
  const linePath = data.map((d, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(d.netWorth)}`).join(' ')
  const areaPath =
    data.length > 1
      ? `${linePath} L ${xFor(data.length - 1)} ${zeroY} L ${xFor(0)} ${zeroY} Z`
      : ''

  // ラベルが詰まると読めないので、点が多いときは間引く(両端と最新は必ず出す)
  const labelStep = Math.ceil(data.length / 6)

  const showTip = (e: React.MouseEvent<SVGRectElement>, d: MonthlyNetWorth, i: number) => {
    const wrap = wrapRef.current
    const svg = e.currentTarget.ownerSVGElement
    if (!wrap || !svg) return
    const wr = wrap.getBoundingClientRect()
    const sr = svg.getBoundingClientRect()
    const scale = sr.width / VB_W
    setTip({
      x: sr.left - wr.left + xFor(i) * scale,
      y: sr.top - wr.top + yFor(d.netWorth) * scale,
      label: monthLabel(d.month),
      value: d.netWorth,
    })
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg
        className="chart-svg"
        width="100%"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="img"
        aria-label="純資産の推移"
        style={{ display: 'block' }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={leftPad}
              x2={VB_W - RIGHT_PAD}
              y1={yFor(t)}
              y2={yFor(t)}
              stroke={t === 0 ? 'var(--baseline)' : 'var(--gridline)'}
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
              {compactYen(t)}
            </text>
          </g>
        ))}

        {areaPath && <path d={areaPath} fill="var(--accent-soft)" />}
        <path
          d={linePath}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {data.map((d, i) => {
          const isLast = i === data.length - 1
          const showLabel = i % labelStep === 0 || isLast
          return (
            <g key={d.month}>
              <circle
                cx={xFor(i)}
                cy={yFor(d.netWorth)}
                r={isLast ? 4 : 2.5}
                fill="var(--accent)"
              />
              {isLast && (
                <text
                  x={Math.min(xFor(i), VB_W - RIGHT_PAD - 4)}
                  y={yFor(d.netWorth) - 10}
                  textAnchor="end"
                  fontSize={11}
                  fontWeight={700}
                  fill="var(--text-secondary)"
                >
                  {compactYen(d.netWorth)}
                </text>
              )}
              {showLabel && (
                <text
                  x={xFor(i)}
                  y={baseY + BOTTOM_PAD - 6}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--text-muted)"
                >
                  {monthLabel(d.month)}
                </text>
              )}
              {/* 指で押しやすいよう、点より広いヒット領域を重ねる */}
              <rect
                x={xFor(i) - (data.length > 1 ? plotW / data.length / 2 : plotW / 2)}
                y={TOP_PAD - 12}
                width={data.length > 1 ? plotW / data.length : plotW}
                height={PLOT_H + 12}
                fill="transparent"
                onMouseEnter={(e) => showTip(e, d, i)}
                onClick={(e) => showTip(e, d, i)}
                onMouseLeave={() => setTip(null)}
              />
            </g>
          )
        })}
      </svg>

      {tip && (
        <div className="chart-tooltip" style={{ left: tip.x, top: tip.y }}>
          <div className="tt-label">{tip.label}</div>
          <div className="tt-value">
            {tip.value < 0 ? `-${yen(Math.abs(tip.value))}` : yen(tip.value)}
          </div>
        </div>
      )}
    </div>
  )
}
