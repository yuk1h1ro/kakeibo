import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addCategory,
  archiveCategory,
  moveCategory,
  updateCategory,
  useCategories,
  visualFromEmojiValue,
  type Category,
} from '../lib/categories'
import {
  CATEGORY_ICON_IDS,
  CategoryIcon,
  CategoryVisualBadge,
  categoryIconLabel,
} from './categoryIcons'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import '../settings.css'

interface Props {
  supabase: SupabaseClient
  onClose: () => void
}

// emoji カラムの生値から、ピッカーで選択済みにするアイコンIDを求める。
// 旧絵文字カテゴリ(既定8種以外)は対応アイコンが無いため box を初期選択にする
function iconIdFromValue(raw: string): string {
  const visual = visualFromEmojiValue(raw)
  if (visual.kind === 'icon' && CATEGORY_ICON_IDS.includes(visual.icon)) return visual.icon
  return 'box'
}

function IconPicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (id: string) => void
  disabled: boolean
}) {
  return (
    <div className="icon-picker" role="radiogroup" aria-label="アイコンを選択">
      {CATEGORY_ICON_IDS.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          aria-label={categoryIconLabel(id)}
          className={`icon-pick ${value === id ? 'selected' : ''}`}
          disabled={disabled}
          onClick={() => onChange(id)}
        >
          <CategoryIcon icon={id} size={32} />
        </button>
      ))}
    </div>
  )
}

export default function CategorySettingsSheet({ supabase, onClose }: Props) {
  const categories = useCategories()
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editIcon, setEditIcon] = useState('box')
  const [newLabel, setNewLabel] = useState('')
  const [newIcon, setNewIcon] = useState('box')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // シートを開いている間は背面ページを固定する
  useBodyScrollLock()

  // カテゴリ編集はオンライン前提。失敗はシート内の .error-text に表示する
  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setError('カテゴリの編集はオンライン時のみ可能です')
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (c: Category) => {
    setEditingKey(c.catKey)
    setEditLabel(c.label)
    setEditIcon(iconIdFromValue(c.emoji))
    setError(null)
  }

  const saveEdit = (catKey: string) => {
    if (!editLabel.trim()) {
      setError('カテゴリ名を入力してください')
      return
    }
    void run(async () => {
      // 旧絵文字カテゴリを編集した場合も 'icon:xxx' 形式に更新される
      await updateCategory(supabase, catKey, {
        label: editLabel.trim(),
        emoji: `icon:${editIcon}`,
      })
      setEditingKey(null)
    })
  }

  const remove = (c: Category) => {
    if (!confirm('このカテゴリを削除しますか?過去の記録の表示はそのまま残ります')) return
    void run(async () => {
      await archiveCategory(supabase, c.catKey)
      if (editingKey === c.catKey) setEditingKey(null)
    })
  }

  const add = () => {
    if (!newLabel.trim()) {
      setError('カテゴリ名を入力してください')
      return
    }
    void run(async () => {
      await addCategory(supabase, newLabel.trim(), `icon:${newIcon}`)
      setNewLabel('')
      setNewIcon('box')
    })
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>カテゴリ設定</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        {error && <p className="error-text">{error}</p>}

        <ul className="cat-list">
          {categories.map((c, i) => (
            <li key={c.catKey} className="cat-row">
              {editingKey === c.catKey ? (
                <div className="cat-edit-form">
                  <div className="cat-edit-row">
                    <input
                      className="cat-label-input"
                      type="text"
                      aria-label="カテゴリ名"
                      placeholder="カテゴリ名"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                    />
                    <button
                      className="btn-ghost cat-action"
                      disabled={busy}
                      onClick={() => saveEdit(c.catKey)}
                    >
                      保存
                    </button>
                    <button
                      className="btn-ghost cat-action"
                      disabled={busy}
                      onClick={() => setEditingKey(null)}
                    >
                      キャンセル
                    </button>
                  </div>
                  <IconPicker value={editIcon} onChange={setEditIcon} disabled={busy} />
                </div>
              ) : (
                <>
                  <CategoryVisualBadge visual={visualFromEmojiValue(c.emoji)} size={32} />
                  <span className="cat-name">{c.label}</span>
                  <button
                    className="btn-ghost cat-move"
                    aria-label={`${c.label} を上へ移動`}
                    disabled={busy || i === 0}
                    onClick={() => void run(() => moveCategory(supabase, c.catKey, 'up'))}
                  >
                    ↑
                  </button>
                  <button
                    className="btn-ghost cat-move"
                    aria-label={`${c.label} を下へ移動`}
                    disabled={busy || i === categories.length - 1}
                    onClick={() => void run(() => moveCategory(supabase, c.catKey, 'down'))}
                  >
                    ↓
                  </button>
                  <button className="btn-ghost cat-action" disabled={busy} onClick={() => startEdit(c)}>
                    編集
                  </button>
                  <button
                    className="btn-ghost cat-action cat-delete"
                    disabled={busy}
                    onClick={() => remove(c)}
                  >
                    削除
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>

        <div className="cat-add">
          <h3>+ カテゴリを追加</h3>
          <div className="cat-add-form">
            <input
              className="cat-label-input"
              type="text"
              aria-label="カテゴリ名"
              placeholder="例: サブスク"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <button
              className="btn-primary cat-add-btn"
              disabled={busy || !newLabel.trim()}
              onClick={add}
            >
              追加
            </button>
          </div>
          <IconPicker value={newIcon} onChange={setNewIcon} disabled={busy} />
        </div>
      </div>
    </div>
  )
}
