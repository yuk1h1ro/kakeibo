// ============================================================
// 変更履歴 (機能163)
//
// 「いつ・どの記録を・何から何に」直したかを新しい順に並べるだけの画面。
// 使う人は1人なので「誰が」は出さない(そもそも記録していない)。
// テーブルが無い環境ではそもそもこの導線が出ない(HistoryTab 側で判定)。
// ============================================================

import { useEffect, useState } from 'react'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import {
  RETENTION_DAYS,
  actionLabel,
  describeEntry,
  fetchChangeLog,
  type ChangeEntry,
} from '../lib/changeLog'
import { formatDate, maskAmountsIn } from '../lib/format'

function whenText(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return `${formatDate(date)} ${time}`
}

export default function ChangeLogSheet({ onClose }: { onClose: () => void }) {
  useBodyScrollLock()
  const [entries, setEntries] = useState<ChangeEntry[] | null>(null)

  useEffect(() => {
    let alive = true
    void fetchChangeLog().then((list) => {
      if (alive) setEntries(list)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>変更履歴</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        {entries === null ? (
          <p className="muted">読み込み中…</p>
        ) : entries.length === 0 ? (
          <p className="hist-empty">
            まだ変更の記録はありません。
            <br />
            記録を直したり削除したりすると、ここに残ります。
          </p>
        ) : (
          <div className="hist-log-list">
            {entries.map((e) => (
              <div key={e.id} className="hist-log-item">
                <div className="hist-log-when">{whenText(e.changedAt)}</div>
                <div className="hist-log-what">
                  <span className="hist-log-badge">{actionLabel(e.action)}</span>
                  {/* 変更履歴に残っている文字列は保存された時点のもの(素の金額)。
                      目隠し (機能169) 中は表示の直前だけ伏字にする */}
                  {maskAmountsIn(e.summary)}
                </div>
                {e.changes.length > 0 && (
                  <div className="hist-log-detail">{maskAmountsIn(describeEntry(e))}</div>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="muted" style={{ marginTop: 12 }}>
          直近{RETENTION_DAYS}日ぶんを残しています(それより古い履歴は自動で消えます)。
        </p>
      </div>
    </div>
  )
}
