import { yen } from '../../lib/format'

interface Datum {
  label: string
  value: number
  /**
   * 押せる行にするときの値(onPick に渡される)。
   * 表示名ではなく集計のキーを渡すためにある — お店別では「店名なし」の行だけ
   * 表示名とキーが違い、その行は絞り込む先が無いので pickKey を渡さない。
   */
  pickKey?: string
}

// 11pxフォントでのおおよそのテキスト幅(px)。CJKは全角として見積もる
function estTextWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    w += ch.codePointAt(0)! > 0x2000 ? 11 : 6.5
  }
  return w
}

// カテゴリ別だけでなくお店別の集計でも使うため、読み上げ用のラベルは差し替えられるようにした。
// onPick を渡すと、pickKey を持つ行だけが押せるようになる(お店別 → その店の履歴へ)。
// 渡さなければ従来どおり role="img" の静止画のまま(カテゴリ別の見え方は変わらない)。
export default function CategoryBars({
  data,
  ariaLabel = 'カテゴリ別支出',
  onPick,
}: {
  data: Datum[]
  ariaLabel?: string
  onPick?: (pickKey: string) => void
}) {
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

  const pickKeyOf = (d: Datum) => (onPick && d.pickKey ? d.pickKey : null)
  const anyPickable = sorted.some((d) => pickKeyOf(d) !== null)

  return (
    <svg
      className="chart-svg"
      width="100%"
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      // 押せる行があるときは中身が読み上げ対象になるので img(1枚の絵)ではなくする
      role={anyPickable ? 'group' : 'img'}
      aria-label={ariaLabel}
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
        const pick = pickKeyOf(d)
        return (
          <g
            key={d.label}
            className={pick !== null ? 'bar-pickable' : undefined}
            role={pick !== null ? 'button' : undefined}
            tabIndex={pick !== null ? 0 : undefined}
            aria-label={pick !== null ? `${d.label} の履歴を見る` : undefined}
            onClick={pick !== null ? () => onPick!(pick) : undefined}
            onKeyDown={
              pick !== null
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onPick!(pick)
                    }
                  }
                : undefined
            }
          >
            {/* 指で押せる帯。棒だけだと短い行が押しにくいので、行の幅いっぱいを当たりにする */}
            {pick !== null && (
              <rect x={0} y={y - GAP / 2} width={VB_W} height={BAR_H + GAP} fill="transparent" />
            )}
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
