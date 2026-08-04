import { maskCompact, yen } from '../../lib/format'
import type { CumulativePoint } from '../../lib/reportPace'
import { computeTicks } from './ticks'

interface Props {
  /** 月の1日目から末日までの累積(未来の日も含む) */
  series: CumulativePoint[]
  /** 月末に到達してよい基準額。null なら参照線を引かない */
  baseline: number | null
  /** 経過日数(今日を含む)。0 ならまだ始まっていない */
  elapsedDays: number
  /** 月末着地の予測。null なら描かない(サンプル不足のときなど) */
  forecast: { point: number; low: number; high: number } | null
  /** 今日時点で基準を超えているか(今日の点の色に使う) */
  over: boolean
}

/**
 * 月の累積支出の折れ線に、支出ペースの参照線 (機能026) と
 * 月末着地の予測 (機能027) を重ねる。外部ライブラリは使わず SVG を自前で描く。
 *
 * 線の区別を色だけに頼らないよう、実績=実線 / 参照線=破線 / 予測=点線 と
 * 線種も変えてある(凡例にも同じ線種を出す)。
 */
export default function CumulativeLine({ series, baseline, elapsedDays, forecast, over }: Props) {
  if (series.length === 0) return null

  const n = series.length
  const VB_W = 360
  const topPad = 14
  const plotH = 130
  const baseY = topPad + plotH
  const VB_H = baseY + 20
  const rightPad = 10

  const maxValue = Math.max(
    series[n - 1].cumulative,
    baseline ?? 0,
    forecast?.high ?? 0,
    // 実績が今日までしか無い場合でも、今日の値は必ず入る
    elapsedDays > 0 ? series[elapsedDays - 1].cumulative : 0
  )
  const { top, ticks } = computeTicks(maxValue)
  // 余白は素の桁数から決める(伏字にしてもグラフの形が動かないように)
  const leftPad = top.toLocaleString('ja-JP').length * 6.5 + 14
  const plotW = VB_W - leftPad - rightPad

  const xFor = (day: number) => leftPad + (day / n) * plotW
  const yFor = (v: number) => baseY - (Math.min(v, top) / top) * plotH

  // 実績は今日まで。まだ来ていない日を 0 のまま描くと「使っていない」ではなく
  // 「そこで止まった」ように見えてしまうため
  const actualPoints = [
    `${xFor(0)},${baseY}`,
    ...series.slice(0, elapsedDays).map((p) => `${xFor(p.day)},${yFor(p.cumulative)}`),
  ].join(' ')
  const todayX = xFor(elapsedDays)
  const todayY = elapsedDays > 0 ? yFor(series[elapsedDays - 1].cumulative) : baseY

  // 横軸のラベルは 1・10・20・末日だけ(全部出すと潰れて読めない)
  const xLabels = [1, 10, 20, n].filter((d, i, arr) => arr.indexOf(d) === i && d <= n)

  const ariaLabel =
    `月の累積支出の推移。今日までの累積 ${yen(elapsedDays > 0 ? series[elapsedDays - 1].cumulative : 0)}` +
    (baseline !== null ? `、月末までの基準 ${yen(baseline)}` : '') +
    (forecast ? `、月末の予測 ${yen(forecast.point)}` : '')

  return (
    <div className="rp-chart-wrap">
      <svg
        className="chart-svg"
        width="100%"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        role="img"
        aria-label={ariaLabel}
        style={{ display: 'block' }}
      >
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
              {maskCompact(t.toLocaleString('ja-JP'))}
            </text>
          </g>
        ))}
        <line
          x1={leftPad}
          x2={VB_W - rightPad}
          y1={baseY}
          y2={baseY}
          stroke="var(--baseline)"
          strokeWidth={1}
        />

        {/* 予測の幅(今日の実績から月末の上限・下限へ広がる帯) */}
        {forecast && elapsedDays > 0 && (
          <polygon
            points={`${todayX},${todayY} ${xFor(n)},${yFor(forecast.high)} ${xFor(n)},${yFor(forecast.low)}`}
            fill="var(--accent)"
            opacity={0.14}
          />
        )}

        {/* 参照線(026): 月末に基準額へ到達する一定ペース */}
        {baseline !== null && (
          <line
            x1={xFor(0)}
            y1={baseY}
            x2={xFor(n)}
            y2={yFor(baseline)}
            stroke="var(--text-muted)"
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
        )}

        {/* 予測の中心線(027) */}
        {forecast && elapsedDays > 0 && (
          <line
            x1={todayX}
            y1={todayY}
            x2={xFor(n)}
            y2={yFor(forecast.point)}
            stroke="var(--accent)"
            strokeWidth={1.5}
            strokeDasharray="2 3"
          />
        )}

        {/* 実績 */}
        <polyline
          points={actualPoints}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {elapsedDays > 0 && (
          <circle cx={todayX} cy={todayY} r={3.5} fill={over ? 'var(--expense)' : 'var(--accent)'} />
        )}

        {xLabels.map((d) => (
          <text
            key={d}
            x={xFor(d)}
            y={baseY + 14}
            textAnchor="middle"
            fontSize={11}
            fill="var(--text-muted)"
          >
            {d}
          </text>
        ))}
      </svg>

      {/* 凡例。色が見分けられなくても線種と文字で分かるようにする */}
      <ul className="rp-legend">
        <li>
          <svg width="22" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="22" y2="4" stroke="var(--accent)" strokeWidth="2" />
          </svg>
          実績(今日まで)
        </li>
        {baseline !== null && (
          <li>
            <svg width="22" height="8" aria-hidden="true">
              <line
                x1="0"
                y1="4"
                x2="22"
                y2="4"
                stroke="var(--text-muted)"
                strokeWidth="1.5"
                strokeDasharray="6 4"
              />
            </svg>
            適正ペース(破線)
          </li>
        )}
        {forecast && (
          <li>
            <svg width="22" height="8" aria-hidden="true">
              <line
                x1="0"
                y1="4"
                x2="22"
                y2="4"
                stroke="var(--accent)"
                strokeWidth="1.5"
                strokeDasharray="2 3"
              />
            </svg>
            月末の予測(点線・帯は幅)
          </li>
        )}
      </ul>
      <p className="axis-note">横軸は日付(その月の何日か)</p>
    </div>
  )
}
