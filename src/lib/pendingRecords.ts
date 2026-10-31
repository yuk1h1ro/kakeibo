// ============================================================
// まだサーバーへ送れていない記録の一覧 (「⚠ 未同期 N件」のシート)
//
// これまでは帯に「保留 N件」と出るだけで、**どの記録が** 送れていないのかを
// 見る場所が無かった(行に小さく「未同期」と出るが、どの月のどの日かを
// 探して回るしかない)。圏外で入れた記録が本当に残っているのかを確かめたい
// 場面で、件数だけでは安心できない。そこで中身を1枚のシートに並べる。
//
// 何を「1件」と数えるか:
//   オフラインキューは操作(追加・修正・削除)を圧縮せずに積むので、
//   同じ記録を入れてから直すと操作は2つになる。シートで見たいのは
//   「どの記録がまだ届いていないか」なので、**記録の単位** で数える。
//   (MainScreen の帯の「保留 N件」は操作の数のまま。そちらは送る量の目安)
//   削除はもう画面に行が無いので、中身ではなく件数だけを出す。
// ============================================================

import type { PendingOp } from './offlineQueue'
import type { Transaction } from './types'
import { sortTransactions } from './historyFilter'

/**
 * 送れていない追加・修正がある記録。新しい日付から順に。(純粋関数)
 * pendingIds は useTransactions が作る「削除以外の操作が残っている行ID」。
 */
export function pendingRows(
  transactions: readonly Transaction[],
  pendingIds: ReadonlySet<string>
): Transaction[] {
  if (pendingIds.size === 0) return []
  return sortTransactions(
    transactions.filter((t) => pendingIds.has(t.id)),
    'date_desc'
  )
}

/**
 * 送れていない削除の件数(記録の単位)。(純粋関数)
 *
 * 削除のあとに「元に戻す」(機能159)で積み直した記録は、キューに削除が残っていても
 * 画面には戻ってきている — それを「消した記録」と数えると嘘になるので、
 * **いま画面に無い** ものだけを数える(visibleIds は表示中の全記録のID)。
 * 同じ記録への削除が二重に積まれていても1件と数える。
 */
export function pendingDeleteCount(
  ops: readonly PendingOp[],
  visibleIds: ReadonlySet<string>
): number {
  const ids = new Set<string>()
  for (const op of ops) {
    if (op.kind === 'delete' && !visibleIds.has(op.id)) ids.add(op.id)
  }
  return ids.size
}
