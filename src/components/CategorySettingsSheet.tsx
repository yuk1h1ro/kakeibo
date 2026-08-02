import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addCategory,
  archiveCategory,
  moveCategory,
  updateCategory,
  useCategories,
  type Category,
} from '../lib/categories'
import '../settings.css'

interface Props {
  supabase: SupabaseClient
  onClose: () => void
}

// 絵文字入力欄の文字数(書記素)カウント。ZWJ 絵文字等もなるべく1文字として数える
// (Intl.Segmenter は ES2020 の型定義に無いため型キャストで参照する)
type SegmenterCtor = new (
  locale?: string,
  options?: { granularity?: 'grapheme' | 'word' | 'sentence' }
) => { segment(input: string): Iterable<unknown> }

function graphemeCount(s: string): number {
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter
  try {
    if (Segmenter) {
      return [...new Segmenter('ja', { granularity: 'grapheme' }).segment(s)].length
    }
  } catch {
    // フォールバックへ
  }
  return [...s].length
}

export default function CategorySettingsSheet({ supabase, onClose }: Props) {
  const categories = useCategories()
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editEmoji, setEditEmoji] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newEmoji, setNewEmoji] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const validate = (label: string, emoji: string): string | null => {
    if (!label.trim()) return 'カテゴリ名を入力してください'
    const n = graphemeCount(emoji.trim())
    if (n < 1 || n > 2) return '絵文字は1〜2文字で入力してください'
    return null
  }

  const startEdit = (c: Category) => {
    setEditingKey(c.catKey)
    setEditLabel(c.label)
    setEditEmoji(c.emoji)
    setError(null)
  }

  const saveEdit = (catKey: string) => {
    const msg = validate(editLabel, editEmoji)
    if (msg) {
      setError(msg)
      return
    }
    void run(async () => {
      await updateCategory(supabase, catKey, {
        label: editLabel.trim(),
        emoji: editEmoji.trim(),
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
    const msg = validate(newLabel, newEmoji)
    if (msg) {
      setError(msg)
      return
    }
    void run(async () => {
      await addCategory(supabase, newLabel.trim(), newEmoji.trim())
      setNewLabel('')
      setNewEmoji('')
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
                  <input
                    className="cat-emoji-input"
                    type="text"
                    maxLength={8}
                    aria-label="絵文字"
                    placeholder="📦"
                    value={editEmoji}
                    onChange={(e) => setEditEmoji(e.target.value)}
                  />
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
              ) : (
                <>
                  <span className="cat-emoji">{c.emoji}</span>
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
              className="cat-emoji-input"
              type="text"
              maxLength={8}
              aria-label="絵文字"
              placeholder="📦"
              value={newEmoji}
              onChange={(e) => setNewEmoji(e.target.value)}
            />
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
              disabled={busy || !newLabel.trim() || !newEmoji.trim()}
              onClick={add}
            >
              追加
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
