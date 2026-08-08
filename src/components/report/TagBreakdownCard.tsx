import { useMemo, useState } from 'react'
import type { Transaction } from '../../lib/types'
import type { TransactionInput } from '../../hooks/useTransactions'
import type { DateRange } from '../../lib/report'
import { formatDate, yen } from '../../lib/format'
import { categoryLabel } from '../../lib/categories'
import { useSpecialTags } from '../../lib/reportTagSettings'
import { useDiscordWebhook } from '../../lib/discordWebhook'
import {
  EVENT_GAP_DAYS,
  NO_TAG_LABEL,
  coTagBreakdown,
  innerTagSet,
  selectionCategoryBreakdown,
  selectionEvents,
  selectionLabel,
  selectionSpan,
  selectionTags,
  selectionTxs,
  tagOutline,
  type TagEvent,
  type TagSelection,
} from '../../lib/reportTags'
import CategoryBars from '../charts/CategoryBars'
import EventTagSheet from './EventTagSheet'
import TripSummarySheet from './TripSummarySheet'

interface Props {
  transactions: Transaction[]
  range: DateRange
  /** 「今月」「この期間」など、文章に差し込む期間の呼び名 */
  periodLabel: string
  /** 任意期間(機能128)に切り替える。出来事の期間をそのまま見に行くのに使う */
  onPickRange: (start: string, end: string) => void
  /**
   * 「回ごと」にまとめてタグを付ける / 外す。オフラインキュー経由の updateMany を渡す。
   * 渡されないときは、その導線を出さない(書き込む手段が無いため)
   */
  onBulkUpdate?: (updates: { id: string; input: TransactionInput }[]) => void
}

/** 最初に見せる出来事の数。それ以上は「もっと見る」で開く */
const TOP_EVENTS = 3

/**
 * タグ別の集計と、そのタグの中の共起タグ・カテゴリ内訳・回ごとの集計。
 *
 * ここが埋めているのは「タグは付けられるのに、レポートで分けて見られない」
 * という穴。集計はすべて reportTags.ts(純粋関数)に置き、
 * この画面は表示の組み立てだけを行う。
 *
 * ---- 「#旅行 → #2026和歌山」の掘り方 ----
 * 階層タグ(親子関係)は作らず、**一緒に付いているタグ**を内側に出す
 * (理由は reportTags.ts の共起タグの節に長く書いてある)。
 * 掘れるのは **1段だけ**。何段でも掘れるようにすると、結局あとから
 * 「何段目を見ているのか」が読めない画面になる。
 */
export default function TagBreakdownCard({
  transactions,
  range,
  periodLabel,
  onPickRange,
  onBulkUpdate,
}: Props) {
  // null = 何も選んでいない / { tag: null } = 「タグなし」を選んでいる
  const [selected, setSelected] = useState<TagSelection | null>(null)
  const [eventsExpanded, setEventsExpanded] = useState(false)
  // 「この回にタグを付ける」「この回を送る」の対象
  const [tagTarget, setTagTarget] = useState<TagEvent | null>(null)
  const [sendTarget, setSendTarget] = useState<TagEvent | null>(null)

  const specialTags = useSpecialTags()
  // Discord が未設定のときに送る導線を出しても、押した先で失敗するだけ。
  // 彼女タブの「履歴のまとめ送信」と同じく、設定済みのときだけ出す
  const webhookReady = useDiscordWebhook().url !== null

  const outline = useMemo(
    () => tagOutline(transactions, range, specialTags),
    [transactions, range.start, range.end, specialTags]
  )
  // 行き先タグの候補(過去に使った内側のタグ)。まとめて付けるときに打ち直さずに済む
  const innerTags = useMemo(
    () => [...innerTagSet(transactions, specialTags)],
    [transactions, specialTags]
  )

  const detail = useMemo(() => {
    if (selected === null) return null
    return {
      categories: selectionCategoryBreakdown(transactions, range, selected, categoryLabel),
      // 出来事は **期間の指定を無視して** 全記録から出す。
      // 旅行は月をまたぐので、選択中の月で切ると1回の旅行が割れてしまう
      events: selectionEvents(transactions, selected, categoryLabel),
      span: selectionSpan(transactions, selected, categoryLabel),
      // 内側のタグは親を選んだときだけ出す(1段だけ)
      co:
        selected.tag !== null && selected.co === null
          ? coTagBreakdown(transactions, range, selected.tag)
          : null,
    }
  }, [transactions, range.start, range.end, selected])

  const hasTags = outline.top.some((i) => i.tag !== null) || outline.inner.length > 0

  /** その回の記録(タグの付け外し・送信の対象) */
  const eventTxs = (e: TagEvent): Transaction[] =>
    selected === null
      ? []
      : selectionTxs(transactions, selected).filter(
          (t) => t.date >= e.range.start && t.date <= e.range.end
        )

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
            data={outline.top.map((i) => ({
              label: i.tag === null ? NO_TAG_LABEL : `#${i.tag}`,
              value: i.total,
            }))}
          />

          {/* 合計が総額と一致しない理由を必ず書く。
              黙って出すと「計算が合っていない」と見えるため */}
          {outline.overlap > 0 ? (
            <p className="caveat">
              1件に複数のタグを付けられるので、タグ別の合計は{periodLabel}の総額({yen(outline.total)})より{yen(outline.overlap)}多くなっています。タグが2つ以上付いた{outline.multiTopCount}件を、どちらのタグにも満額で数えているためです(按分すると「旅行でいくら使ったか」が出せなくなります)。
            </p>
          ) : (
            <p className="caveat">
              いまは1件に1つまでしかタグが付いていないので、タグ別の合計は{periodLabel}の総額({yen(outline.total)})と一致します。1件に2つ付けると、どちらにも満額で数えるぶん、合計は総額より大きくなります。
            </p>
          )}

          {/* 行き先タグを上に並べない理由を、隠している事実とセットで書く */}
          {outline.inner.length > 0 && (
            <p className="caveat">
              「{outline.inner
                .slice(0, 3)
                .map((i) => `#${i.tag}`)
                .join('・')}」{outline.inner.length > 3 && `など${outline.inner.length}個`}
              のタグは、いつも別のタグと一緒に付いているので上の一覧には出していません(同じ金額が2度並ぶのを避けるためです)。上のタグを押すと、その中に出ます。
            </p>
          )}

          <div className="rp-tag-chips" role="group" aria-label="内訳を見るタグ">
            {outline.top.map((i) => {
              const on = selected !== null && selected.tag === i.tag
              return (
                <button
                  key={i.key}
                  className={`rp-tag-chip${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => {
                    setSelected(on ? null : { tag: i.tag, co: null })
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
                {selectionLabel(selected)}の内訳({periodLabel})
              </h3>

              {/* ---- 1段だけのドリルダウン ---- */}
              {detail.co !== null && detail.co.items.length > 0 && (
                <>
                  <p className="muted rp-co-lead">
                    #{selected.tag} と一緒に付いているタグ(押すとその旅行だけに絞れます)
                  </p>
                  <div
                    className="rp-tag-chips rp-co-chips"
                    role="group"
                    aria-label={`${selected.tag}と一緒に付いているタグ`}
                  >
                    {detail.co.items.map((i) => (
                      <button
                        key={i.key}
                        className="rp-tag-chip"
                        onClick={() => {
                          setSelected({ tag: selected.tag, co: i.tag })
                          setEventsExpanded(false)
                        }}
                      >
                        #{i.tag}
                        <span className="rp-co-amount">{yen(i.total)}</span>
                      </button>
                    ))}
                  </div>
                  {detail.co.soloCount > 0 && (
                    <p className="caveat">
                      ほかにタグの付いていない#{selected.tag}が{detail.co.soloCount}件({yen(detail.co.soloTotal)})あります。下の「回ごと」からまとめて行き先タグを付けられます。
                    </p>
                  )}
                </>
              )}

              {selected.co !== null && (
                <button
                  className="btn-ghost rp-co-back"
                  onClick={() => {
                    setSelected({ tag: selected.tag, co: null })
                    setEventsExpanded(false)
                  }}
                >
                  ← #{selected.tag} 全体に戻る
                </button>
              )}

              {detail.categories.length === 0 ? (
                <p className="muted">{periodLabel}にこのタグの支出はありません</p>
              ) : (
                <CategoryBars
                  ariaLabel={`${selectionLabel(selected)}のカテゴリ内訳`}
                  data={detail.categories.map((c) => ({ label: c.label, value: c.total }))}
                />
              )}

              {/* 期間をまたぐ集計。「今回の旅行でいくら使ったか」はここでしか出せない。
                  行き先タグを付けていない過去の旅行は、これでしか個別に見られないので
                  共起タグのドリルダウンを足したあとも必ず残す */}
              {selected.tag !== null && detail.events.length > 0 && (
                <>
                  <h3 className="rp-year-h3">{selectionLabel(selected)} の回ごと</h3>
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
                          <div className="rp-event-actions">
                            {/* 過去の旅行にあとから行き先タグを付ける入り口。
                                この回の記録がすでに特定できているので、選ぶ操作がゼロで済む */}
                            {onBulkUpdate && (
                              <button
                                className="btn-ghost rp-event-btn"
                                onClick={() => setTagTarget(e)}
                              >
                                この回にタグを付ける
                              </button>
                            )}
                            {webhookReady && (
                              <button
                                className="btn-ghost rp-event-btn"
                                onClick={() => setSendTarget(e)}
                              >
                                この回を彼女に送る
                              </button>
                            )}
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

      {tagTarget !== null && selected !== null && onBulkUpdate && (
        <EventTagSheet
          targets={eventTxs(tagTarget)}
          periodText={
            tagTarget.range.start === tagTarget.range.end
              ? formatDate(tagTarget.range.start)
              : `${formatDate(tagTarget.range.start)} 〜 ${formatDate(tagTarget.range.end)}`
          }
          keepTags={selectionTags(selected)}
          suggestions={innerTags}
          onApply={onBulkUpdate}
          onClose={() => setTagTarget(null)}
        />
      )}

      {sendTarget !== null && selected !== null && (
        <TripSummarySheet
          transactions={transactions}
          tags={selectionTags(selected)}
          range={sendTarget.range}
          onClose={() => setSendTarget(null)}
        />
      )}
    </div>
  )
}
