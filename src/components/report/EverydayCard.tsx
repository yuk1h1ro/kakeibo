import { useMemo, useState } from 'react'
import type { Transaction } from '../../lib/types'
import type { DateRange } from '../../lib/report'
import { yen } from '../../lib/format'
import { everydaySplit, specialTagOptions } from '../../lib/reportTags'
import {
  DEFAULT_SPECIAL_TAGS,
  setSpecialTags,
  toggleSpecialTag,
  useSpecialTags,
} from '../../lib/reportTagSettings'

interface Props {
  transactions: Transaction[]
  range: DateRange
  /** 「今月」「この期間」など、文章に差し込む期間の呼び名 */
  periodLabel: string
}

/**
 * 日常 / 非日常 の切り分け。
 *
 * 要望の中心は「旅行やデートを除いた、普段の支出はいくらか」。
 * なので割合ではなく **両方を金額で** 出す(割合だけだと、旅行を挟んだ月に
 * 「普段はいくらだったのか」が読み取れない)。
 *
 * どのタグを特別とみなすかは利用者が選ぶ。既定で 旅行/デート/出張 が
 * 入っているが、外すことも増やすこともできる(reportTagSettings.ts)。
 */
export default function EverydayCard({ transactions, range, periodLabel }: Props) {
  const specialTags = useSpecialTags()
  const [pickerOpen, setPickerOpen] = useState(false)

  const split = useMemo(
    () => everydaySplit(transactions, range, specialTags),
    [transactions, range.start, range.end, specialTags]
  )

  // 候補は「使ったことのあるタグ」+「既定の3つ」+「いま選んでいるもの」。
  // まだ使っていない既定のタグも出さないと、初期値を外したあとに戻せない
  const options = useMemo(
    () => specialTagOptions(transactions, [...specialTags, ...DEFAULT_SPECIAL_TAGS]),
    [transactions, specialTags]
  )

  // 選んだタグが、この期間に1件も見つからない状態。
  // 空のグラフを出すのではなく「次に何をすればいいか」を書く
  const noSpecialHere = split.special === 0
  const noTagsAtAll = useMemo(
    () => transactions.every((t) => (t.tags?.length ?? 0) === 0),
    [transactions]
  )

  const share = split.total > 0 ? Math.round((split.special / split.total) * 100) : 0

  return (
    <div className="card">
      <h2>普段の支出 / 特別な支出</h2>

      <div className="rp-split-figures">
        <div className="rp-split-figure">
          <span className="rp-split-head">
            <span className="rp-split-swatch everyday" aria-hidden="true" />
            普段
          </span>
          <span className="rp-num rp-split-amount">{yen(split.everyday)}</span>
          <span className="rp-num rp-split-sub">
            {split.everydayCount}件・1日あたり {yen(split.everydayPerDay)}
          </span>
        </div>
        <div className="rp-split-figure">
          <span className="rp-split-head">
            <span className="rp-split-swatch special" aria-hidden="true" />
            特別
          </span>
          <span className="rp-num rp-split-amount">{yen(split.special)}</span>
          <span className="rp-num rp-split-sub">
            {split.specialCount}件{split.special > 0 && `・全体の${share}%`}
          </span>
        </div>
      </div>

      {/* 割合の帯。片方が0のときは1色の帯になるだけで何も分からないので出さない */}
      {split.everyday > 0 && split.special > 0 && (
        <SplitBar everyday={split.everyday} special={split.special} />
      )}

      {specialTags.length === 0 ? (
        <p className="caveat">
          特別なタグを1つも選んでいないので、{periodLabel}の支出はすべて「普段」として数えています。
        </p>
      ) : noSpecialHere ? (
        <p className="caveat">
          {periodLabel}には{specialTags.map((t) => `「${t}」`).join('')}の付いた記録がありません。
          {noTagsAtAll
            ? '入力の「詳細」でタグを付けると、旅行やデートの支出を普段の支出と分けて見られます。'
            : '旅行やデートの記録にこのタグを付けると、普段の支出と分けて見られます。'}
        </p>
      ) : (
        <>
          <ul className="rp-split-tags">
            {split.byTag.map((t) => (
              <li key={t.key}>
                <span className="rp-split-tag-label">#{t.label}</span>
                <span className="rp-num rp-split-tag-value">
                  {yen(t.total)}
                  <span className="rp-split-tag-count">({t.count}件)</span>
                </span>
              </li>
            ))}
          </ul>
          {split.byTag.length > 1 && (
            <p className="caveat">
              1件に特別なタグを2つ付けると、上の内訳では両方に数えます(合計は「特別」より大きくなることがあります)。「普段」と「特別」の2つはどちらか一方にしか入らないので、足すと{periodLabel}の総額になります。
            </p>
          )}
        </>
      )}

      <button
        className="btn-ghost rp-tag-picker-btn"
        aria-expanded={pickerOpen}
        onClick={() => setPickerOpen(!pickerOpen)}
      >
        {pickerOpen ? '特別なタグの設定を閉じる' : `特別なタグを選ぶ(いま${specialTags.length}個)`}
      </button>

      {pickerOpen && (
        <div className="rp-tag-picker">
          {/* 文の途中で改行するとブラウザが空白を1つ入れてしまうので、1文を1行に収める */}
          <p className="muted rp-tag-picker-note">
            日常とは違う場面のタグを選んでください。選んだタグが付いた支出だけが「特別」に回ります。この設定はこの端末にだけ保存され、記録そのものは変わりません。
          </p>
          <div className="rp-tag-chips">
            {options.map((tag) => {
              const on = specialTags.includes(tag)
              return (
                <button
                  key={tag}
                  className={`rp-tag-chip${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleSpecialTag(tag)}
                >
                  #{tag}
                </button>
              )
            })}
          </div>
          {options.length === 0 && (
            <p className="muted">
              まだタグがありません。入力の「詳細」でタグを付けると、ここに出てきます。
            </p>
          )}
          <div className="rp-tag-picker-actions">
            <button
              className="btn-ghost"
              onClick={() => setSpecialTags(DEFAULT_SPECIAL_TAGS)}
              disabled={
                specialTags.length === DEFAULT_SPECIAL_TAGS.length &&
                DEFAULT_SPECIAL_TAGS.every((t) => specialTags.includes(t))
              }
            >
              既定に戻す
            </button>
            <button
              className="btn-ghost"
              onClick={() => setSpecialTags([])}
              disabled={specialTags.length === 0}
            >
              すべて外す
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 普段と特別の割合を1本の帯で見せる(SVG を自前で描く。外部ライブラリは使わない)。
 * 色の違いだけに頼らず、特別のほうには斜線を重ねている
 * (色が見分けにくい環境でも2つを区別できるように)。
 */
function SplitBar({ everyday, special }: { everyday: number; special: number }) {
  const W = 360
  const H = 18
  const total = everyday + special
  // 端が丸いので、極端に小さい側でも見える幅を残す
  const everydayW = Math.min(Math.max((everyday / total) * W, 6), W - 6)

  return (
    <svg
      className="rp-split-bar"
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`普段と特別の割合。普段 ${Math.round((everyday / total) * 100)}パーセント`}
      style={{ display: 'block' }}
    >
      <defs>
        <pattern
          id="rp-split-hatch"
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="8" height="8" fill="var(--accent)" opacity="0.2" />
          <rect width="3.5" height="8" fill="var(--accent)" opacity="0.85" />
        </pattern>
        <clipPath id="rp-split-clip">
          <rect x="0" y="0" width={W} height={H} rx={H / 2} />
        </clipPath>
      </defs>
      <g clipPath="url(#rp-split-clip)">
        <rect x="0" y="0" width={everydayW} height={H} fill="var(--accent)" />
        <rect
          x={everydayW}
          y="0"
          width={W - everydayW}
          height={H}
          fill="url(#rp-split-hatch)"
        />
      </g>
    </svg>
  )
}
