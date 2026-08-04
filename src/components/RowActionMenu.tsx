// ============================================================
// 長押しメニュー (機能149)
//
// 行を長押ししたときに、その場で「複製・編集・削除」を出す。
// 複製は「同じ内容で今日の日付」— 過去日のまま複製しても使い道が薄く、
// 使いたい場面は「この前と同じものをまた買った」ときだから (lib/txActions.ts)。
// 削除に確認ダイアログは出さない。消したあとに出る「元に戻す」で取り消せる (機能159)。
// ============================================================

import type { Transaction } from '../lib/types'
import { categoryLabel } from '../lib/categories'
import { formatDate, yen } from '../lib/format'
import { ownAmount } from '../lib/types'
import { ledgerRowTitle, partnerImpact } from '../lib/partnerBalance'
import { IconCopy, IconEdit, IconTrash } from './historyIcons'

interface Props {
  tx: Transaction
  onDuplicate: (t: Transaction) => void
  onEdit: (t: Transaction) => void
  onDelete: (t: Transaction) => void
  onClose: () => void
}

export default function RowActionMenu({ tx, onDuplicate, onEdit, onDelete, onClose }: Props) {
  // 預かり・返金・調整は専用の見出しと「残高への影響額」で出す
  // (支出と同じ書き方にすると、返金・調整が ¥0 の行に見えてしまう)
  const isExpense = tx.type === 'expense'
  const what = isExpense ? tx.store || tx.memo || categoryLabel(tx.category) : ledgerRowTitle(tx)
  const amount = isExpense ? ownAmount(tx) : Math.abs(partnerImpact(tx))

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>この記録の操作</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <p className="hist-menu-target">
          {formatDate(tx.date)} ・ {what} ・ {yen(amount)}
        </p>

        <div className="hist-menu-sheet" style={{ marginTop: 12 }}>
          <button
            className="hist-menu-item"
            onClick={() => {
              onDuplicate(tx)
              onClose()
            }}
          >
            <IconCopy />
            同じ内容で今日の日付に複製する
          </button>
          <button
            className="hist-menu-item"
            onClick={() => {
              onEdit(tx)
              onClose()
            }}
          >
            <IconEdit />
            編集する
          </button>
          <button
            className="hist-menu-item is-danger"
            onClick={() => {
              onDelete(tx)
              onClose()
            }}
          >
            <IconTrash />
            削除する
          </button>
        </div>
      </div>
    </div>
  )
}
