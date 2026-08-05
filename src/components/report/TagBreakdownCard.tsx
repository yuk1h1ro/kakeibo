import { useMemo, useState } from 'react'
import type { Transaction } from '../../lib/types'
import type { DateRange } from '../../lib/report'
import { formatDate, yen } from '../../lib/format'
import { categoryLabel } from '../../lib/categories'
import {
  EVENT_GAP_DAYS,
  NO_TAG_LABEL,
  tagBreakdown,
  tagCategoryBreakdown,
  tagEvents,
  tagSpan,
} from '../../lib/reportTags'
import CategoryBars from '../charts/CategoryBars'

interface Props {
  transactions: Transaction[]
  range: DateRange
  /** 「今月」「この期間」など、文章に差し込む期間の呼び名 */
  periodLabel: string
  /** 任意期間(機能128)に切り替える。出来事の期間をそのまま見に行くのに使う */
  onPickRange: (start: string, end: string) => void
}

/** 最初に見せる出来事の数。それ以上は「もっと見る」で開く */
const TOP_EVENTS = 3

/**
 * タグ別の集計と、そのタグの中のカテゴリ内訳・回ごとの集計。
 *
 * ここが埋めているのは「タグは付けられるのに、レポートで分けて見られない」
 * という穴。集計はすべて reportTags.ts(純粋関数)に置き、
 * この画面は表示の組み立てだけを行う。
 */
export default function TagBreakdownCard({
  transactions,
  range,
  periodLabel,
  onPickRange,
}: Props) {
  // null = 何も選んでいない / { tag: null } = 「タグなし」を選んでいる
  const [selected, setSelected] = useState<{ tag: string | null } | null>(null)
  const [eventsExpanded, setEventsExpanded] = useState(false)

  const breakdown = useMemo(
    () => tagBreakdown(transactions, range),
    [transactions, range.start, range.end]
  )

  const detail = useMemo(() => {
    if (selected === null) return null
    return {
      categories: tagCategoryBreakdown(transactions, range, selected.tag, categoryLabel),
      // 出来事は **期間の指定を無視して** 全記録から出す。
      // 旅行は月をまたぐので、選択中の月で切ると1回の旅行が割れてしまう
      events: selected.tag === null ? [] : tagEvents(transactions, selected.tag, categoryLabel),
      span: selected.tag === null ? null : tagSpan(transactions, selected.tag, categoryLabel),
    }
  }, [transactions, range.start, range.end, selected])

  const hasTags = breakdown.items.some((i) => i.tag !== null)

  return (
    <div className="card">
      <h2>タグ別の支出</h2>

      {!hasTags ? (
        <p className="rp-tag-empty">
          {periodLabel}にはタグの付いた記録がありません。
          <br />
          {/* 文の途中で改行するとブラウザが空白を1つ入れてしまうので、1行にまとめる */}
          入力の「詳細」で「旅行」「デート」などのタグを付けると、カテゴリをまたいだ支出(旅行中の食費・交通費・宿泊費)を1つのまとまりとして見られます。
        </p>
      ) : (
        <>
          <CategoryBars
            ariaLabel="タグ別支出"
            data={breakdown.items.map((i) => ({
              label: i.tag === null ? NO_TAG_LABEL : `#${i.tag}`,
              value: i.total,
            }))}
          />

          {/* 合計が総額と一致しない理由を必ず書く。
              黙って出すと「計算が合っていない」と見えるため */}
          {breakdown.overlap > 0 ? (
            <p className="caveat">
              1件に複数のタグを付けられるので、タグ別の合計は{periodLabel}の総額({yen(breakdown.total)})より{yen(breakdown.overlap)}多くなっています。タグが2つ以上付いた{breakdown.multiTagCount}件を、どちらのタグにも満額で数えているためです(按分すると「旅行でいくら使ったか」が出せなくなります)。
            </p>
          ) : (
            <p className="caveat">
              いまは1件に1つまでしかタグが付いていないので、タグ別の合計は{periodLabel}の総額({yen(breakdown.total)})と一致します。1件に2つ付けると、どちらにも満額で数えるぶん、合計は総額より大きくなります。
            </p>
          )}

          <div className="rp-tag-chips" role="group" aria-label="内訳を見るタグ">
            {breakdown.items.map((i) => {
              const on = selected !== null && selected.tag === i.tag
              return (
                <button
                  key={i.key}
                  className={`rp-tag-chip${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => {
                    setSelected(on ? null : { tag: i.tag })
                    setEventsExpanded(false)
                  }}
                >
                  {i.tag === null ? NO_TAG_LABEL : `#${i.tag}`}
                </button>
              )
            })}
          </div>

          {selected !== null && detail !== null && (
            <div className="rp-tag-detail">
              <h3 className="rp-year-h3">
                {selected.tag === null ? NO_TAG_LABEL : `#${selected.tag}`}の内訳({periodLabel})
              </h3>
              {detail.categories.length === 0 ? (
                <p className="muted">{periodLabel}にこのタグの支出はありません</p>
              ) : (
                <CategoryBars
                  ariaLabel={`${selected.tag ?? NO_TAG_LABEL}のカテゴリ内訳`}
                  data={detail.categories.map((c) => ({ label: c.label, value: c.total }))}
                />
              )}

              {/* 期間をまたぐ集計。「今回の旅行でいくら使ったか」はここでしか出せない */}
              {selected.tag !== null && detail.events.length > 0 && (
                <>
                  <h3 className="rp-year-h3">#{selected.tag} の回ごと</h3>
                  {detail.span && detail.events.length > 1 && (
                    <p className="rp-num rp-tag-span">
                      全{detail.events.length}回・合計 {yen(detail.span.total)}(
                      {formatDate(detail.span.range.start)}〜
                      {formatDate(detail.span.range.end)})
                    </p>
                  )}
                  <ul className="rp-event-list">
                    {(eventsExpanded ? detail.events : detail.events.slice(0, TOP_EVENTS)).map(
                      (e) => (
                        <li key={`${e.range.start}-${e.range.end}`} className="rp-event-row">
                          <div className="rp-event-main">
                            <span className="rp-num rp-event-when">
                              {e.range.start === e.range.end
                                ? formatDate(e.range.start)
                                : `${formatDate(e.range.start)} 〜 ${formatDate(e.range.end)}`}
                            </span>
                            <span className="rp-num rp-event-sub">
                              {e.days}日間・{e.count}件
                              {e.categories.length > 0 &&
                                `・${e.categories
                                  .slice(0, 3)
                                  .map((c) => `${c.label} ${yen(c.total)}`)
                                  .join('・')}`}
                            </span>
                          </div>
                          <div className="rp-event-side">
                            <span className="rp-num rp-event-amount">{yen(e.total)}</span>
                            <button
                              className="btn-ghost rp-event-btn"
                              onClick={() => onPickRange(e.range.start, e.range.end)}
                            >
                              この期間で見る
                            </button>
                          </div>
                        </li>
                      )
                    )}
                  </ul>
                  {detail.events.length > TOP_EVENTS && (
                    <button
                      className="more-btn"
                      onClick={() => setEventsExpanded(!eventsExpanded)}
                    >
                      {eventsExpanded
                        ? `直近${TOP_EVENTS}回だけ表示`
                        : `もっと見る(全${detail.events.length}回)`}
                    </button>
                  )}
                  <p className="caveat">
                    回ごとの集計は、選んでいる期間に関係なく、このタグの記録すべてから出しています(旅行は月をまたぐため)。記録が{EVENT_GAP_DAYS}日より長く空いたところで、別の回として分けています。
                  </p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
