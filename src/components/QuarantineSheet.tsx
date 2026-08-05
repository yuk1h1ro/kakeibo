// ============================================================
// 同期できなかった記録の確認・再送・破棄
//
// サーバーに断られた記録は、黙って捨てずに端末の中へ取り置いてある
// (lib/quarantine.ts)。ここはその中身を **人が読める形で** 見せ、
// 自分で決着を付けるための場所。
//
// 画面としての約束:
//   - 「消えていない」ことを最初に書く。打ち直しを誘発しないため
//   - 破棄は取り返しがつかないので、確認を挟む(再送には挟まない)
//   - サーバーの原文も隠さずに出す。原因を追える唯一の手がかりなので
// ============================================================

import { useState } from 'react'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { categoryLabel } from '../lib/categories'
import { formatDate, yen } from '../lib/format'
import {
  entryTotal,
  quarantinedOpSummary,
  reasonText,
  type QuarantineEntry,
} from '../lib/quarantine'
import '../settings.css'

interface Props {
  entries: QuarantineEntry[]
  onRetry: (entryId: string) => void
  onDiscard: (entryId: string) => void
  onClose: () => void
}

export default function QuarantineSheet({ entries, onRetry, onDiscard, onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  useBodyScrollLock()

  const retry = (id: string) => {
    setBusy(id)
    try {
      onRetry(id)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>同期できなかった記録</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        {entries.length === 0 ? (
          <p className="muted">いまはありません。記録はすべて同期できています。</p>
        ) : (
          <>
            <p className="muted">
              サーバーに送れなかった記録です。<strong>この端末の中に残しています</strong>
              (破棄するまで消えません)。原因が直ったら「再送する」を押してください。
            </p>
            {entries.map((e) => (
              <div key={e.id} className="settings-section">
                <h3>
                  {e.ops.length}件 ・ 合計 {yen(entryTotal(e))}
                </h3>
                <p className="muted">
                  {e.quarantinedAt ? `${formatDate(e.quarantinedAt.slice(0, 10))} ・ ` : ''}
                  {reasonText(e.reason)}
                </p>
                <ul className="cat-list">
                  {e.ops.map((op) => {
                    const s = quarantinedOpSummary(op, categoryLabel)
                    return (
                      <li key={op.opId} className="cat-row">
                        <span className="cat-name">
                          {s.date ? `${formatDate(s.date)} ・ ` : ''}
                          {s.title}
                        </span>
                        <span className="muted">{s.amount === null ? '—' : yen(s.amount)}</span>
                        <span className="muted">{s.action}</span>
                      </li>
                    )
                  })}
                </ul>
                {e.detail && <p className="err-guide-detail">詳細: {e.detail}</p>}
                <div className="quarantine-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy === e.id}
                    onClick={() => retry(e.id)}
                  >
                    もう一度送る
                  </button>
                  <button
                    type="button"
                    className="btn-ghost cat-delete"
                    disabled={busy === e.id}
                    onClick={() => {
                      // 破棄すると記録は本当に消える。ここだけは必ず確認する
                      if (!confirm(`この${e.ops.length}件を破棄しますか?(元に戻せません)`)) return
                      onDiscard(e.id)
                    }}
                  >
                    破棄する
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
