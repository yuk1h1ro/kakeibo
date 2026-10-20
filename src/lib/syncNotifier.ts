// ============================================================
// 同期1回ぶんの Discord 通知 (useTransactions の flush が使う)
//
// 送信の成否と記録の扱いは flush が決め、ここは「何を・いつ知らせるか」だけを持つ:
//   - 彼女の残高に効く op が通ったら、その場で1通
//   - 分割の会計は内訳が揃ってから1通にまとめる(次の op に移るときか、同期を抜けるとき)
//   - 断られて会計ごと取り消された内訳は、まとめていた通知ごと捨てる
//     (取り消しの削除も知らせない — 彼女から見ると、聞いたことの無い記録が消えた知らせになる)
//   - 残高がしきい値をまたいだら低下アラート(預かりを使っている人にだけ)
//
// 送るのはどれも投げっぱなし。通知が失敗しても記録は止めない。
// ============================================================

import {
  addSplitPart,
  buildPartnerOpMessage,
  formatSplitNotification,
  notifyLowBalanceIfNeeded,
  sendDiscordMessage,
  splitGroupOfOp,
  type SplitNotice,
} from './discordNotify'
import type { PendingOp } from './offlineQueue'
import { hasDeposits, partnerBalance } from './partnerBalance'
import type { Transaction } from './types'

/**
 * rows は同期を始めるときの手元の写し(預かりを使っているかの判断に使う)。
 * 同期1回ごとに作り直すこと — まとめている途中の会計を次の同期へ持ち越さない。
 */
export function createSyncNotifier(rows: readonly Transaction[]) {
  // まとめている途中の分割の会計
  let pendingSplit: SplitNotice | null = null
  // 取り消された内訳の行ID(その削除は知らせない)
  const silencedIds = new Set<string>()
  // 低下アラートは預かりを使っている人にだけ送る。分割の通知は後でまとめて
  // 送るので、そのとき見る手元の写しの状態をここで追いかける
  let depositsSeen = hasDeposits(rows)

  const sendPendingSplit = () => {
    if (pendingSplit === null) return
    const message = formatSplitNotification(pendingSplit)
    if (message) {
      void sendDiscordMessage(message)
      if (depositsSeen) notifyLowBalanceIfNeeded(pendingSplit.balance)
    }
    pendingSplit = null
  }

  return {
    /**
     * 次の op を送る前に呼ぶ。別の op に移るなら、まとめていた会計を送り出す
     * (届いた順を崩さない)。同じ会計の内訳が続くうちは待つ
     */
    beforeOp(op: PendingOp) {
      if (pendingSplit !== null && splitGroupOfOp(op) !== pendingSplit.group) sendPendingSplit()
    },

    /** op がサーバーに通った。before / after はその op を反映する前・後の手元の写し */
    sent(op: PendingOp, before: Transaction[], after: Transaction[]) {
      if (splitGroupOfOp(op) !== null) {
        // 分割の内訳は、会計が揃うまで手元にまとめる
        pendingSplit = addSplitPart(pendingSplit, op, partnerBalance(after))
      } else if (!(op.kind === 'delete' && silencedIds.has(op.id))) {
        const message = buildPartnerOpMessage(op, before, after)
        if (message) void sendDiscordMessage(message)
        // 機能010: 残高がしきい値をまたいだときだけ低下アラートを送る。
        // 個々の op の通知とは別に、確定した残高そのものを見て判断する
        // 預かりをまだ使っていない人には送らない(hasDeposits。画面のアラートと同じ判断)
        if (message && hasDeposits(after)) notifyLowBalanceIfNeeded(partnerBalance(after))
      }
      depositsSeen = depositsSeen || hasDeposits([op.payload ?? { type: '' }])
    },

    /**
     * op が断られ、その会計ごと取り消された(隔離箱へ移した)。
     * まとめていた通知は **送らずに捨てる**(無かったことになる会計)
     */
    cancelled(op: PendingOp) {
      if (pendingSplit !== null && splitGroupOfOp(op) === pendingSplit.group) {
        for (const id of pendingSplit.ids) silencedIds.add(id)
        pendingSplit = null
      }
    },

    /**
     * 同期を抜けるときに必ず呼ぶ。圏外で途中まで送れた会計も、送れた分だけで
     * 1通にして出す(残りは次の同期で、もう1通になる)。待ち続けると知らせが出ない
     */
    finish() {
      sendPendingSplit()
    },
  }
}
