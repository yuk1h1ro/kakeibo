// ============================================================
// 履歴の「一覧」表示: 月の記録を日ごとに束ねる
//
// 履歴タブはもともと「カレンダー + 選んだ日の明細」だけで、開いた瞬間には
// 明細が1行も見えなかった(390x844 で最初の行が y=816、タブバーは y=789)。
// 月の記録をまるごと見るには 絞り込み →「この月」と辿るしかなかった。
// そこで「一覧｜カレンダー」の切り替えを足し、一覧ではその月の記録を
// 日付の見出しで区切って新しい順に並べる。束ね方はここに純粋関数として置く。
//
// 日付の見出しに出す金額は **カレンダーのマスに出ている額と同じもの**
// (自分の実質支出 = ownAmount の合計。預かりは混ぜない)。
// 2つの見え方を行き来したときに、同じ日の数字が食い違うと信用できなくなるので、
// カレンダー側もここの summarizeDays を使う(計算を1か所にする)。
// ============================================================

import type { Transaction } from './types'
import { ownAmount } from './types'
import { sortTransactions } from './historyFilter'

/** 1日ぶんの集計(カレンダーのマスと一覧の日付見出しが共通で使う) */
export interface DaySummary {
  /** 自分の実質支出の合計(彼女の負担分を除いた額。預かり・返金・調整は 0) */
  own: number
  /** 彼女からの預かりの合計(カレンダーでは緑の点、合計では「預かり」) */
  deposit: number
}

/**
 * 日付ごとの集計。(純粋関数)
 * 自分の分は ownAmount で数える — 支出以外は 0 になるので、預かりや返金が
 * 「使った額」に紛れ込まない。預かりは別の欄に分けて数える。
 */
export function summarizeDays(txs: readonly Transaction[]): Map<string, DaySummary> {
  const map = new Map<string, DaySummary>()
  for (const t of txs) {
    const entry = map.get(t.date) ?? { own: 0, deposit: 0 }
    if (t.type === 'partner_deposit') entry.deposit += t.amount
    else entry.own += ownAmount(t)
    map.set(t.date, entry)
  }
  return map
}

export interface DayGroup extends DaySummary {
  date: string
  /** その日の記録(新しい順)。上限で切ったときは、出せたぶんだけ */
  rows: Transaction[]
}

export interface DayGroups {
  /** 新しい日付から順に */
  groups: DayGroup[]
  /** 実際に並べた行数 */
  shown: number
  /** 束ねる前の全件数(上限で切ったかどうかは shown < total で分かる) */
  total: number
}

/**
 * 記録を日ごとに束ねる。新しい日付が上、同じ日の中も新しい順。(純粋関数)
 *
 * 並べ順は検索結果の「日付が新しい順」(sortTransactions の date_desc)と同じものを使う。
 * 同じ日の中の順番まで決めきっておかないと、同期のたびに行が入れ替わって
 * さっき見ていた行を見失う(historyFilter.ts の sortTransactions に理由がある)。
 *
 * limit は一度に描く行数の上限(履歴タブの RESULT_LIMIT)。数百件を一気に描くと
 * スクロールが重くなるので、検索結果と同じく先頭だけを出す。
 * **上限で切っても、日付見出しの金額はその日の全件の合計にする** —
 * 見出しの額がカレンダーのマスと食い違うと、どちらが正しいのか分からなくなるため。
 * 行の途中で切れた日は、見出しの額と並んだ行の合計が合わなくなるが、
 * その場合は画面の下に「先頭N件だけ表示しています」と出る(検索結果と同じ注記)。
 */
export function groupByDay(txs: readonly Transaction[], limit: number = Infinity): DayGroups {
  const totals = summarizeDays(txs)
  const sorted = sortTransactions(txs, 'date_desc')
  const shownRows = sorted.length > limit ? sorted.slice(0, Math.max(0, limit)) : sorted
  const groups: DayGroup[] = []
  for (const t of shownRows) {
    const last = groups[groups.length - 1]
    if (last && last.date === t.date) {
      last.rows.push(t)
      continue
    }
    const sum = totals.get(t.date) ?? { own: 0, deposit: 0 }
    groups.push({ date: t.date, own: sum.own, deposit: sum.deposit, rows: [t] })
  }
  return { groups, shown: shownRows.length, total: txs.length }
}
