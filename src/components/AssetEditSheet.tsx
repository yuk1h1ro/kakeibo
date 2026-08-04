import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addAsset,
  archiveAsset,
  categoriesFor,
  updateAsset,
  type AssetDef,
  type AssetKind,
} from '../lib/assets'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { describeUnknownError, isOnlineNow } from '../lib/errorGuidance'

interface Props {
  supabase: SupabaseClient
  /** null なら新規追加 */
  editing: AssetDef | null
  onClose: () => void
  onSaved: () => void
}

/** 資産・負債の追加/編集シート (機能101) */
export default function AssetEditSheet({ supabase, editing, onClose, onSaved }: Props) {
  useBodyScrollLock()

  const [kind, setKind] = useState<AssetKind>(editing?.kind ?? 'asset')
  const [category, setCategory] = useState(editing?.category ?? categoriesFor('asset')[0].key)
  const [name, setName] = useState(editing?.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 資産↔負債を切り替えたら種別の選択肢も入れ替わるので、先頭に寄せ直す
  const changeKind = (next: AssetKind) => {
    setKind(next)
    setCategory(categoriesFor(next)[0].key)
  }

  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? describeUnknownError(e, isOnlineNow()) : '保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  const trimmed = name.trim()

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>{editing ? '資産・負債を編集' : '資産・負債を追加'}</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <div className="asset-kind-toggle" role="radiogroup" aria-label="資産か負債か">
          {(['asset', 'liability'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              className={kind === k ? 'selected' : ''}
              onClick={() => changeKind(k)}
            >
              {k === 'asset' ? '資産' : '負債'}
            </button>
          ))}
        </div>
        <p className="asset-note">
          {kind === 'asset'
            ? '銀行口座・証券口座・現金など、持っているお金です。'
            : 'クレジットカードの残債・奨学金など、返す予定のお金です。残高は「残っている額」をプラスの数字で入れてください。'}
        </p>

        <label className="field asset-field">
          <span>種別</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categoriesFor(kind).map((c) => (
              <option key={c.key} value={c.key}>
                {c.emoji} {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field asset-field">
          <span>名前</span>
          <input
            type="text"
            value={name}
            maxLength={40}
            placeholder={kind === 'asset' ? '例: 三井住友銀行' : '例: 楽天カード'}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        {error && <p className="error-text">{error}</p>}

        <button
          className="btn-primary"
          disabled={busy || trimmed === ''}
          onClick={() =>
            void run(async () => {
              if (editing) {
                await updateAsset(supabase, editing.id, { kind, category, name: trimmed })
              } else {
                await addAsset(supabase, { kind, category, name: trimmed })
              }
            })
          }
        >
          {busy ? '保存中…' : editing ? '更新する' : '追加する'}
        </button>

        {editing && (
          <button
            className="btn-ghost asset-archive-btn"
            disabled={busy}
            onClick={() => {
              if (
                !confirm(
                  `「${editing.name}」を一覧から外しますか?\n記録した残高は残りますが、純資産の推移からは外れます。`
                )
              ) {
                return
              }
              void run(() => archiveAsset(supabase, editing.id))
            }}
          >
            一覧から外す(解約・完済した)
          </button>
        )}
      </div>
    </div>
  )
}
