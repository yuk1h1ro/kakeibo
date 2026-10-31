// ============================================================
// まだ送れていない記録の一覧 (「⚠ 未同期 N件」から開く)
//
// 帯の「保留 N件」は件数しか言わないので、圏外で入れた記録が
// **本当にこの端末に残っているのか** を確かめる場所が無かった
// (行に付く小さな「未同期」を、月と日を辿って探すしかない)。
// ここではそれを1枚に並べ、その場で送り直せるようにする。
//
// 並べるのは追加・修正が残っている記録(日付・内容・金額)。
// 削除は行がもう画面に無いので件数だけを出す。数え方は lib/pendingRecords.ts。
// 履歴タブの帯からも、ヘッダー下のオフラインの帯からも同じものを開く。
// ============================================================

import { useState } from 'react'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import type { Transaction } from '../lib/types'
import { formatDate } from '../lib/format'
import { categoryLabel } from '../lib/categories'
import { txTitle } from '../lib/partnerBalance'
import { txAmountText } from './HistoryTxRow'

interface Props {
  /** 送れていない追加・修正がある記録(新しい順。pendingRows で作る) */
  rows: readonly Transaction[]
  /** 送れていない削除の件数 */
  deleteCount: number
  isOnline: boolean
  /** いま送っている最中か(ボタンを二度押しさせない) */
  syncing: boolean
  /** 保留分を送り、サーバーから取り込み直す(store.syncNow) */
  onSendNow: () => Promise<void>
  onClose: () => void
}

export default function UnsyncedSheet({
  rows,
  deleteCount,
  isOnline,
  syncing,
  onSendNow,
  onClose,
}: Props) {
  useBodyScrollLock()
  const [sending, setSending] = useState(false)
  // 押したあとに残っていたら「まだ残っています」と言う。押す前から出すと
  // 何もしていないのに失敗したように読めるので、押したかどうかを覚えておく
  const [tried, setTried] = useState(false)
  const busy = sending || syncing
  const total = rows.length + deleteCount

  const send = async () => {
    if (busy) return
    setSending(true)
    try {
      await onSendNow()
    } finally {
      setSending(false)
      setTried(true)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-sheet"
        role="dialog"
        aria-label="まだ送れていない記録"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-header">
          <h2>まだ送れていない記録</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        {total === 0 ? (
          <p className="hist-empty" role="status">
            {tried ? 'すべて送りました' : '未同期の記録はありません'}
          </p>
        ) : (
          <>
            <p className="muted hist-unsynced-lead">
              この端末には残っています。通信が戻ると自動で送ります
              {isOnline ? '(すぐ送るときは下の「いま送る」)' : '(いまはオフラインです)'}。
            </p>
            {rows.length > 0 && (
              <ul className="hist-unsynced-list">
                {rows.map((t) => (
                  <li key={t.id} className="hist-unsynced-item">
                    <span className="hist-unsynced-date">{formatDate(t.date)}</span>
                    <span className="hist-unsynced-title">{txTitle(t, categoryLabel)}</span>
                    <span className="hist-unsynced-amount">{txAmountText(t)}</span>
                  </li>
                ))}
              </ul>
            )}
            {deleteCount > 0 && (
              <p className="hist-unsynced-deletes">
                削除 {deleteCount}件(まだサーバーから消えていません)
              </p>
            )}
            {tried && !busy && (
              <p className="hist-unsynced-left" role="status">
                まだ {total}件
                残っています。電波の良いところでもう一度押すか、そのまま待ってください
              </p>
            )}
          </>
        )}

        {total > 0 && (
          <button
            className="btn-primary hist-unsynced-send"
            onClick={() => void send()}
            disabled={busy || !isOnline}
          >
            {busy ? '送信中…' : isOnline ? 'いま送る' : 'オフラインのため送れません'}
          </button>
        )}
      </div>
    </div>
  )
}
