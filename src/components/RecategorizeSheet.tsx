import { useState } from 'react'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { categoryLabel } from '../lib/categories'
import { formatDate, yen } from '../lib/format'
import type { Transaction } from '../lib/types'
import '../settings.css'

interface Props {
  storeName: string
  /** 新しく学習したカテゴリ */
  category: string
  /** カテゴリが違う過去の記録(1件以上あるときだけ開く) */
  targets: Transaction[]
  onApply: () => Promise<void>
  onClose: () => void
}

/**
 * 学習した内容を過去にも適用するか聞く (機能078)。
 *
 * 保存の直後に、同じ店でカテゴリが変わったと判定できたときだけ出す。
 * 該当が1件も無いときは呼び出し側で開かない = 毎回は聞かない。
 */
export default function RecategorizeSheet({
  storeName,
  category,
  targets,
  onApply,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false)
  useBodyScrollLock()

  const apply = async () => {
    setBusy(true)
    try {
      await onApply()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>過去の記録も変えますか?</h2>
        </div>

        <p className="recat-lead">
          過去の「{storeName}」{targets.length}件も{categoryLabel(category)}に変えますか?
        </p>

        <ul className="recat-list">
          {targets.slice(0, 5).map((t) => (
            <li key={t.id} className="recat-row">
              <span className="recat-date">{formatDate(t.date)}</span>
              <span className="recat-from">{categoryLabel(t.category)}</span>
              <span className="recat-amount">{yen(t.amount)}</span>
            </li>
          ))}
          {targets.length > 5 && <li className="muted">ほか {targets.length - 5}件</li>}
        </ul>

        <button className="btn-primary" disabled={busy} onClick={() => void apply()}>
          {busy ? '変更中…' : `${targets.length}件を${categoryLabel(category)}に変える`}
        </button>
        <button className="btn-ghost recat-skip" disabled={busy} onClick={onClose}>
          このままにする
        </button>
      </div>
    </div>
  )
}
