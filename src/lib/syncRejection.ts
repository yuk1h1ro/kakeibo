// ============================================================
// 同期で「サーバーに届いたうえで断られた」1件をどう扱うか (純粋関数)
//
// 通信の失敗(届いてすらいない)と、列が無いだけで落として送り直せるものは
// 呼ぶ側(useTransactions の flush)で先に片付けてある。ここに来るのは残りで、
//   - 直せる失敗(マイグレーション未実行) … 送り直せば通る見込みがある
//   - 直しようのない拒否(制約違反など)   … 何度送っても同じ
// のどちらかを見分け、画面に出す案内を決める。
// **どちらでも op を捨てない** のは呼ぶ側の約束(隔離箱へ移すか、キューに残す)。
// ============================================================

import {
  favorRejectionGuidance,
  guidanceForServerError,
  ledgerRejectionGuidance,
  syncRejectedGuidance,
  type Guidance,
} from './errorGuidance'
import { isSchemaError, type ServerErrorLike } from './serverErrors'
import { isFavorAmountRejection, isLedgerTypeRejection } from './txExtensions'
import type { TransactionInput } from './types'

export interface RejectionVerdict {
  /** 画面に出す案内(原因と次の行動) */
  guide: Guidance
  /** 送り直せば通る見込みがあるか(マイグレーション系だけ) */
  retryable: boolean
  /**
   * 返金・調整の種別が DB のチェック制約に無かった = settlement の SQL が未実行。
   * 呼ぶ側はその導線を閉じて、同じ失敗をこれ以上増やさない
   */
  ledgerRejected: boolean
}

export function judgeRejection(
  err: ServerErrorLike,
  payload: TransactionInput | undefined,
  online: boolean
): RejectionVerdict {
  // 支払い 0円 の記録が金額の制約に弾かれた = migration-favor.sql 未実行。
  // 種別の拒否より先に見る(こちらは支出、あちらは返金・調整なので重ならないが、
  // 判定の順番を固定しておくほうが後から読んで迷わない)
  const favorRejected = isFavorAmountRejection(err, payload)
  const ledgerRejected = !favorRejected && isLedgerTypeRejection(err, payload?.type)
  const schema = isSchemaError(err)
  const guide = schema
    ? // どの SQL を実行すればよいかは、code / details / hint が残っている
      // ここでしか分からない。決め打ちの文言ではなく、必ず err から引く
      guidanceForServerError(err, online)
    : favorRejected
      ? // 制約名 (transactions_amount_check) だけでは「調整のマイナス」と
        // 区別が付かないので、中身まで見たここでファイル名を決める
        favorRejectionGuidance(err)
      : ledgerRejected
        ? ledgerRejectionGuidance(err)
        : syncRejectedGuidance(err, online)
  return { guide, retryable: schema || ledgerRejected || favorRejected, ledgerRejected }
}
