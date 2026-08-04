// ============================================================
// 複数選択 → カテゴリの一括変更 (機能151)
//
// 選んだ支出のカテゴリだけを、まとめて付け替える。
// 書き込みは useTransactions の updateMany(= オフラインキュー経由)なので、
// 通信できない場所で操作しても記録は失われない。
// ============================================================

import { useCategories } from '../lib/categories'
import useBodyScrollLock from '../hooks/useBodyScrollLock'

interface Props {
  /** 変更対象の件数(何件に効くのかを先に見せる) */
  count: number
  onPick: (catKey: string) => void
  onClose: () => void
}

export default function BulkCategorySheet({ count, onPick, onClose }: Props) {
  useBodyScrollLock()
  const categories = useCategories()

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>{count}件のカテゴリを変える</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <div className="hist-chips">
          {categories.map((c) => (
            <button
              key={c.catKey}
              className="hist-chip"
              onClick={() => {
                onPick(c.catKey)
                onClose()
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <p className="muted" style={{ marginTop: 12 }}>
          預かりの記録はカテゴリを持たないため、変更の対象になりません
        </p>
      </div>
    </div>
  )
}
