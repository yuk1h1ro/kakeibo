import { useMemo } from 'react'
import type { Transaction } from '../../lib/types'
import type { DateRange } from '../../lib/report'
import { formatDate, yen } from '../../lib/format'
import { categoryLabel } from '../../lib/categories'
import { favorCategoryBreakdown, favorSummary } from '../../lib/favors'

interface Props {
  transactions: Transaction[]
  range: DateRange
  /** 「今月」「この期間」など、文章に差し込む期間の呼び名 */
  periodLabel: string
}

/**
 * おごり・値引きの振り返り (favors.ts)。
 *
 * ---- なぜ「人ごと」と「カテゴリ別」の2つを出すのか ----
 * このカードの主役は金額ではなく **人** です。
 * 「今月 8,400円 浮いた」より、「田中さんに 3回・6,200円ぶん ご馳走になっている。
 * 最後は7月12日」のほうが、次にやること(お礼・お返し)につながる。
 * 割引の合計は、そのついでに出しているだけ。
 *
 * カテゴリ(何をご馳走になったか)をここに出しているのは、**レポートの
 * 「カテゴリ別支出」には出てこない** から。あちらは自分が払った額を数えるので、
 * 全額おごってもらった回は 0円 として扱われる(それが正しい)。
 * 記録そのものには入力のときからカテゴリが付いているのに、
 * どこにも出ないままでは付けた意味がない。
 *
 * ---- 支出のカードとは並べない ----
 * ここに出す額は **1円も払っていないお金** なので、上の「支出」の数字とは
 * 足し引きできない。同じ行に並べると合計の一部に見えてしまうので、
 * 独立したカードにして、注記でもはっきり書く。
 *
 * この期間に1件も無ければ何も描かない。使っていない人の画面に、
 * 空のカードを増やさないため(親側でも favor 列の有無で出し分けている)。
 */
export default function FavorCard({ transactions, range, periodLabel }: Props) {
  const summary = useMemo(
    () => favorSummary(transactions, range),
    // range は毎回新しいオブジェクトなので、中身で比べる(他のカードと同じ作法)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, range.start, range.end]
  )

  // 何をご馳走になったか。カテゴリ名の解決は他のカードと同じくここで行う
  const treatCategories = useMemo(
    () => favorCategoryBreakdown(transactions, range, 'treat', categoryLabel),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [transactions, range.start, range.end]
  )

  if (summary.treatCount === 0 && summary.discountCount === 0) return null

  return (
    <div className="card favor-card">
      <h2>おごり・値引き</h2>

      {summary.treatCount > 0 ? (
        <>
          <p className="favor-lead">
            {periodLabel}は{' '}
            <span className="favor-strong">
              {summary.treatCount}回・{yen(summary.treatTotal)}
            </span>{' '}
            ぶん ご馳走になりました
          </p>
          <ul className="favor-people">
            {summary.people.map((p) => (
              <li key={p.name} className="favor-person">
                <span className="favor-person-name">
                  {p.name === '' ? '(名前を書いていない回)' : `${p.name}さん`}
                </span>
                <span className="favor-person-sub">
                  {p.count}回・最後は {formatDate(p.lastDate)}
                </span>
                <span className="rp-num favor-person-amount">{yen(p.total)}</span>
              </li>
            ))}
          </ul>

          {/* 何をご馳走になったか。1種類しかないときは、並べても内訳にならないので出さない */}
          {treatCategories.length > 1 && (
            <>
              <p className="favor-sub-head">何をご馳走になったか</p>
              <ul className="rp-split-tags favor-categories">
                {treatCategories.map((c) => (
                  <li key={c.key}>
                    <span className="rp-split-tag-label">{c.label}</span>
                    <span className="rp-num rp-split-tag-value">
                      {yen(c.total)}
                      <span className="rp-split-tag-count">({c.count}回)</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <p className="favor-lead">{periodLabel}にご馳走になった記録はありません</p>
      )}

      {summary.discountCount > 0 && (
        <p className="favor-discount">
          割引・ポイントで {summary.discountCount}回・{yen(summary.discountTotal)} 安くなりました
        </p>
      )}

      <p className="caveat">
        ここの金額は<strong>払っていないお金</strong>なので、支出の合計には入っていません。
        本来の値段は「支払った額 + ここの額」です。
      </p>
    </div>
  )
}
