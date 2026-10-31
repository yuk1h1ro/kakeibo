// ============================================================
// 更新と変更履歴 (機能154 / 163 の置き場)
//
// 履歴タブの最上段には「10:32 に更新 / 変更履歴 / ⟳」の1行(44px)があったが、
// 開いた瞬間に明細が1行も見えない原因の1つだった(上部だけで 409px)。
// そこでこの行は検索欄の右端の小さなボタン(⟳ 10:32)に畳み、
// 押すとこのシートが開くようにした。
//   ・いつ取り込んだか … ボタンに時刻だけ、ここに長い言い方
//   ・いま更新する      … ここ。いちばん上で下に引く操作もそのまま使える
//   ・変更履歴          … ここ(テーブルがある環境だけ)
//   ・未同期の記録      … 残っているときだけ、その一覧への入口
// ============================================================

import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { IconHistory, IconRefresh } from './historyIcons'

interface Props {
  /** formatSyncedAt の結果(「10:32 に更新」)。未取得なら null */
  syncedText: string | null
  refreshing: boolean
  /** 変更履歴のテーブルがある環境か */
  logAvailable: boolean
  /** まだ送れていない記録の数(記録の単位) */
  unsyncedCount: number
  onRefresh: () => void
  onShowLog: () => void
  onShowUnsynced: () => void
  onClose: () => void
}

export default function HistorySyncSheet({
  syncedText,
  refreshing,
  logAvailable,
  unsyncedCount,
  onRefresh,
  onShowLog,
  onShowUnsynced,
  onClose,
}: Props) {
  useBodyScrollLock()
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-sheet"
        role="dialog"
        aria-label="更新と変更履歴"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-header">
          <h2>更新と変更履歴</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <p className="hist-menu-target" role="status" aria-live="polite">
          {refreshing ? '更新中…' : (syncedText ?? 'まだサーバーから取り込めていません')}
        </p>

        <div className="hist-menu-sheet" style={{ marginTop: 12 }}>
          <button className="hist-menu-item" onClick={onRefresh} disabled={refreshing}>
            <IconRefresh /> {refreshing ? '更新中…' : 'いま更新する'}
          </button>
          <p className="muted hist-sync-tip">一覧のいちばん上で下に引いても更新できます</p>

          {logAvailable && (
            <button className="hist-menu-item" onClick={onShowLog}>
              <IconHistory /> 変更履歴を見る
            </button>
          )}

          {unsyncedCount > 0 && (
            <button className="hist-menu-item is-warn" onClick={onShowUnsynced}>
              ⚠ 未同期の記録 {unsyncedCount}件を見る
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
