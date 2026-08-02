import { yen } from '../../lib/format'

interface Datum {
  label: string
  value: number
}

// 11pxフォントでのおおよそのテキスト幅(px)。CJKは全角として見積もる
function estTextWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    w += ch.codePointAt(0)! > 0x2000 ? 11 : 6.5
  }
  return w
}

export default function CategoryBars({ data }: { data: Datum[] }) {
  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value)

  if (sorted.length === 0) {
    return <p className="muted">支出がありません</p>
  }

  const VB_W = 360
  const BAR_H = 20
  const GAP = 10

  const labelW = Math.min(Math.max(...sorted.map((d) => estTextWidth(d.label))), 110) + 10
  const valueW = Math.max(...sorted.map((d) => estTextWidth(yen(d.value)))) + 8
  const x0 = labelW
  const maxBarW = Math.max(VB_W - labelW - valueW, 40)
  const maxV = Math.max(...sorted.map((d) => d.value))
  const VB_H = sorted.length * (BAR_H + GAP) - GAP

  return (
    <svg
      className="chart-svg"
      width="100%"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      role="img"
      aria-label="カテゴリ別支出"
      style={{ display: 'block' }}
    >
      {sorted.map((d, i) => {
        const y = i * (BAR_H + GAP)
        const w = Math.max((d.value / maxV) * maxBarW, 2)
        const r = Math.min(4, w)
        // データ側(右端)のみ4px角丸、ベースライン側(左)は直角
        const path =
          `M ${x0} ${y}` +
          ` L ${x0 + w - r} ${y}` +
          ` Q ${x0 + w} ${y} ${x0 + w} ${y + r}` +
          ` L ${x0 + w} ${y + BAR_H - r}` +
          ` Q ${x0 + w} ${y + BAR_H} ${x0 + w - r} ${y + BAR_H}` +
          ` L ${x0} ${y + BAR_H} Z`
        return (
          <g key={d.label}>
            <text
              x={x0 - 8}
              y={y + BAR_H / 2}
              textAnchor="end"
              dominantBaseline="central"
              fontSize={11}
              fill="var(--text-secondary)"
            >
              {d.label}
            </text>
            <path d={path} fill="var(--accent)" />
            <text
              x={x0 + w + 6}
              y={y + BAR_H / 2}
              dominantBaseline="central"
              fontSize={11}
              fill="var(--text-secondary)"
            >
              {yen(d.value)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
