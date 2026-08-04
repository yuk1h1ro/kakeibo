import { useState } from 'react'
import type { Transaction } from '../../lib/types'
import { formatMonth, yen } from '../../lib/format'
import { monthRange } from '../../lib/report'
import {
  AVERAGE_LOOKBACK_MONTHS,
  FORECAST_MIN_ACTIVE_DAYS,
  FORECAST_MIN_ELAPSED_DAYS,
  cumulativeSeries,
  monthEndForecast,
  paceStatus,
  resolvePaceBaseline,
} from '../../lib/reportPace'
import { parseBudget, setMonthlyBudget, useMonthlyBudget } from '../../lib/monthlyBudget'
import CumulativeLine from '../charts/CumulativeLine'

interface Props {
  transactions: Transaction[]
  /** 'YYYY-MM'。月表示のときだけ使う(任意期間では「月末」という概念が無いため) */
  month: string
  today: string
}

/**
 * 支出ペースの参照線 (機能026) と 月末着地の予測 (機能027)。
 *
 * 「使いすぎを止める」ための中核なので、グラフのすぐ下に
 * 「今日時点の目安といくら違うか」を文章でも出す(グラフを読まなくても分かるように)。
 * 予測は断定を避け、必ず幅と根拠(何日ぶんの実績か)を添える。
 */
export default function PaceCard({ transactions, month, today }: Props) {
  const budget = useMonthlyBudget()
  const [editingBudget, setEditingBudget] = useState(false)
  const [budgetDraft, setBudgetDraft] = useState(budget === null ? '' : String(budget))

  const series = cumulativeSeries(transactions, monthRange(month), today)
  const baseline = resolvePaceBaseline(transactions, month, budget)
  const status = baseline ? paceStatus(series, baseline.amount, today) : null
  const forecast = monthEndForecast(transactions, month, today)
  const over = status !== null && status.diff > 0

  const saveBudget = () => {
    setMonthlyBudget(parseBudget(budgetDraft))
    setEditingBudget(false)
  }

  const baselineNote =
    baseline === null
      ? null
      : baseline.source === 'budget'
        ? `基準は設定した予算 ${yen(baseline.amount)}。月末にちょうど使い切る一定ペースで引いています。`
        : `基準は直近${AVERAGE_LOOKBACK_MONTHS}ヶ月のうち記録のある${baseline.monthsUsed}ヶ月の平均 ${yen(baseline.amount)}(予算が未設定のため過去の平均を代わりに使っています)。`

  return (
    <>
      <div className="card">
        <h2>支出ペース</h2>

        {baseline === null ? (
          <p className="muted rp-pace-empty">
            参照線の基準にできるものがまだありません(予算が未設定で、直近
            {AVERAGE_LOOKBACK_MONTHS}ヶ月にも記録がありません)。予算を決めると線を引けます。
          </p>
        ) : (
          <>
            <CumulativeLine
              series={series}
              baseline={baseline.amount}
              elapsedDays={status?.elapsedDays ?? 0}
              forecast={forecast.available ? forecast : null}
              over={over}
            />
            {status && (
              <p className="rp-pace-lead">
                {status.elapsedDays}日目まで:実績{' '}
                <span className="rp-num">{yen(status.actual)}</span> / 目安{' '}
                <span className="rp-num">{yen(status.expected)}</span>
                <span className={`rp-pace-diff ${over ? 'over' : 'under'}`}>
                  {over
                    ? `${yen(status.diff)} 使いすぎ`
                    : status.diff === 0
                      ? 'ちょうど目安どおり'
                      : `${yen(-status.diff)} 余裕あり`}
                </span>
              </p>
            )}
            <p className="caveat">{baselineNote}</p>
          </>
        )}

        {/* 予算の設定。参照線の根拠を自分で決められるようにする(端末ごとに保存) */}
        {editingBudget ? (
          <div className="rp-budget">
            <label className="rp-budget-label" htmlFor="rp-budget-input">
              1ヶ月の予算(円・空にすると過去の平均を使います)
            </label>
            <input
              id="rp-budget-input"
              className="rp-budget-input"
              type="number"
              inputMode="numeric"
              min={0}
              placeholder="例: 80000"
              value={budgetDraft}
              onChange={(e) => setBudgetDraft(e.target.value)}
            />
            <div className="rp-budget-actions">
              <button className="btn-primary rp-budget-save" onClick={saveBudget}>
                保存する
              </button>
              <button
                className="btn-ghost rp-budget-cancel"
                onClick={() => {
                  setBudgetDraft(budget === null ? '' : String(budget))
                  setEditingBudget(false)
                }}
              >
                キャンセル
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn-ghost rp-budget-open"
            onClick={() => {
              setBudgetDraft(budget === null ? '' : String(budget))
              setEditingBudget(true)
            }}
          >
            {budget === null ? '予算を設定する' : `予算 ${yen(budget)} を変更する`}
          </button>
        )}
      </div>

      {/* 027: 予測。過去の月には出さない(実績が確定しているため) */}
      {!(forecast.available === false && forecast.reason === 'not-current-month') && (
        <div className="card">
          <h2>月末の着地(予測)</h2>
          {forecast.available ? (
            <>
              <p className="rp-forecast-value">
                <span className="rp-forecast-tag">予測</span>
                <span className="rp-num rp-forecast-point">およそ {yen(forecast.point)}</span>
              </p>
              <p className="rp-forecast-range">
                幅の目安 <span className="rp-num">{yen(forecast.low)}</span> 〜{' '}
                <span className="rp-num">{yen(forecast.high)}</span>
              </p>
              <p className="caveat">
                {formatMonth(month)}1日〜{forecast.elapsedDays}日の{forecast.elapsedDays}日分(うち
                支出のあった日 {forecast.activeDays}日・1日あたり平均{' '}
                {yen(forecast.dailyAverage)})の実績が、残り{forecast.remainingDays}
                日も同じように続いた場合の計算です。実際の金額とは異なります。
              </p>
            </>
          ) : (
            <p className="muted">
              {forecast.reason === 'too-early'
                ? `まだ${forecast.elapsedDays}日分の実績しかないため、予測は出していません(${FORECAST_MIN_ELAPSED_DAYS}日以上経ってから出します)。`
                : forecast.reason === 'few-records'
                  ? `支出のあった日が${forecast.activeDays}日しかないため、予測は出していません(${FORECAST_MIN_ACTIVE_DAYS}日以上から出します)。`
                  : '今日で月末です。予測ではなく上の実績をご覧ください。'}
            </p>
          )}
        </div>
      )}
    </>
  )
}
