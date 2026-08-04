import { useMemo, useState } from 'react'
import type { Transaction } from '../../lib/types'
import { formatDate, formatMonth, yen } from '../../lib/format'
import {
  DEFAULT_BUCKET_COUNT,
  GRANULARITY_LABELS,
  bucketSeries,
  type Granularity,
} from '../../lib/reportBuckets'
import VerticalBars from '../charts/VerticalBars'

interface Props {
  transactions: Transaction[]
  /** 集計の終端。選択中の期間の終わり(未来なら今日)を渡す */
  anchor: string
}

const ORDER: Granularity[] = ['day', 'week', 'month', 'year']

/**
 * 日 / 週 / 月 / 年 の粒度切替 (機能129)。
 *
 * 既存の「月で見る」「期間で見る」を上書きしない独立した窓にしてある。
 * 選択期間そのものを粒度で割ると、1日だけの期間を「年」で見たときに
 * 棒が1本だけになるなど、期間の選択と粒度の選択が互いを潰し合うため。
 */
export default function GranularityCard({ transactions, anchor }: Props) {
  const [granularity, setGranularity] = useState<Granularity>('month')

  const buckets = useMemo(
    () => bucketSeries(transactions, granularity, anchor),
    [transactions, granularity, anchor]
  )
  const count = DEFAULT_BUCKET_COUNT[granularity]
  const total = buckets.reduce((s, b) => s + b.total, 0)
  const last = buckets[buckets.length - 1]

  const windowNote =
    granularity === 'day'
      ? `${formatDate(anchor)}までの${count}日間`
      : granularity === 'week'
        ? `${formatDate(anchor)}を含む週までの${count}週間`
        : granularity === 'month'
          ? `${formatMonth(anchor.slice(0, 7))}までの${count}ヶ月`
          : `${anchor.slice(0, 4)}年までの${count}年`

  return (
    <div className="card">
      <h2>粒度を変えて見る</h2>
      <div className="seg seg-sm" role="group" aria-label="集計の粒度">
        {ORDER.map((g) => (
          <button
            key={g}
            className={granularity === g ? 'active' : ''}
            aria-pressed={granularity === g}
            onClick={() => setGranularity(g)}
          >
            {GRANULARITY_LABELS[g]}
          </button>
        ))}
      </div>
      <VerticalBars
        ariaLabel={`${GRANULARITY_LABELS[granularity]}ごとの支出(${windowNote})`}
        data={buckets.map((b, i) => ({
          label: b.label,
          value: b.total,
          // いちばん右(いま進行中の区間)を強調して、途中の数字だと分かるようにする
          emphasis: i === buckets.length - 1,
        }))}
      />
      <p className="axis-note">{windowNote}・合計 {yen(total)}</p>
      {/* 進行中の区間は途中までの合計。前の区間と並べると少なく見えるので必ず断る */}
      {granularity !== 'day' && last && last.end > anchor && (
        <p className="caveat">
          いちばん右の{GRANULARITY_LABELS[granularity]}は{formatDate(anchor)}までの途中集計です。
        </p>
      )}
    </div>
  )
}
