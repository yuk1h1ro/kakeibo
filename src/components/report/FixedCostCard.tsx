import { useMemo, useState } from 'react'
import { yen } from '../../lib/format'
import { describeRecurrence } from '../../lib/recurrence'
import { isRecurringUnavailable, useRecurringRules } from '../../lib/recurringRules'
import { fixedCostSummary } from '../../lib/recurringInsights'

const TOP_N = 5

/**
 * サブスク・固定費の合計 (機能122)。
 *
 * 「定額かどうか」を記録から推測すると外れる(毎月同じ店で買い物しているだけ、
 * ということがある)。ここでは**繰り返し入力に登録済みの内容だけ**を集計する —
 * 登録内容は事実なので、金額を断定して出せる。
 */
export default function FixedCostCard() {
  const rules = useRecurringRules()
  const summary = useMemo(() => fixedCostSummary(rules), [rules])
  const [expanded, setExpanded] = useState(false)

  // 繰り返し入力そのものが使えない環境(マイグレーション未実行)では何も出さない
  if (isRecurringUnavailable()) return null

  const shown = expanded ? summary.items : summary.items.slice(0, TOP_N)

  return (
    <div className="card">
      <h2>毎月の固定費(繰り返し入力)</h2>

      {summary.items.length === 0 ? (
        <p className="muted">
          繰り返し入力にまだ登録がありません。家賃やサブスクを設定(⚙️)の「繰り返し入力」に
          登録すると、毎月いくら固定で出ていくかがここに出ます。
        </p>
      ) : (
        <>
          <p className="rp-fixed-total">
            毎月 <span className="rp-num rp-fixed-amount">{yen(summary.monthlyOwnTotal)}</span>
            <span className="rp-fixed-annual">年 約{yen(summary.annualOwnTotal)}</span>
          </p>
          {summary.monthlyOwnTotal !== summary.monthlyTotal && (
            <p className="muted">
              彼女の負担分を含めた支払い総額では 毎月 {yen(summary.monthlyTotal)}(年 約
              {yen(summary.annualTotal)})です。
            </p>
          )}

          <ul className="rp-fixed-list">
            {shown.map((item) => (
              <li key={item.id} className="rp-fixed-row">
                <span className="rp-fixed-body">
                  <span className="rp-fixed-title">{item.title}</span>
                  <span className="rp-fixed-sub">
                    {describeRecurrence(item.recurrence)}・年 約{yen(item.annualOwn)}
                  </span>
                </span>
                <span className="rp-num rp-fixed-value">{yen(item.monthlyOwn)}</span>
              </li>
            ))}
          </ul>
          {summary.items.length > TOP_N && (
            <button className="more-btn" onClick={() => setExpanded(!expanded)}>
              {expanded ? '上位5件だけ表示' : `もっと見る(全${summary.items.length}件)`}
            </button>
          )}

          <p className="caveat">
            毎週の登録は 365÷7 で、毎年の登録は 12 で割って月額に直しています。
            {summary.pausedCount > 0 && `停止中の${summary.pausedCount}件は含めていません。`}
            繰り返し入力に登録していない定額サービスは、この合計には入りません。
          </p>
        </>
      )}
    </div>
  )
}
