import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { categoryLabel } from '../lib/categories'
import { yen } from '../lib/format'
import {
  addTransactionTemplate,
  templateFromTransaction,
  templateLabel,
} from '../lib/transactionTemplates'
import type { Transaction } from '../lib/types'
import '../settings.css'
import { describeUnknownError, isOnlineNow } from '../lib/errorGuidance'

interface Props {
  supabase: SupabaseClient
  transaction: Transaction
  onSaved: () => void
  onClose: () => void
}

/** 既存の取引から「これをテンプレートにする」(機能072) */
export default function TemplateSaveSheet({ supabase, transaction, onSaved, onClose }: Props) {
  const base = templateFromTransaction(transaction)
  const [title, setTitle] = useState(templateLabel(base))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBodyScrollLock()

  const save = () => {
    setBusy(true)
    setError(null)
    void addTransactionTemplate(supabase, { ...base, title: title.trim() })
      .then(onSaved)
      .catch((e: unknown) => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setError('テンプレートの保存はオンライン時のみ可能です')
        } else {
          setError(describeUnknownError(e, isOnlineNow()))
        }
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>テンプレートにする</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <p className="muted">
          {yen(base.amount)} ・ {categoryLabel(base.category)}
          {base.store !== '' && ` ・ ${base.store}`}
          {base.partnerAmount > 0 && ` ・ 彼女 ${yen(base.partnerAmount)}`}
        </p>

        {error && <p className="error-text">{error}</p>}

        <label className="field">
          <span>名前</span>
          <input
            type="text"
            placeholder="例: 昼のコンビニ"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <button className="btn-primary" disabled={busy} onClick={save}>
          {busy ? '保存中…' : '保存する'}
        </button>
      </div>
    </div>
  )
}
