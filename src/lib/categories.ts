import { useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface Category {
  // id は transactions.category に保存される値 (= cat_key)。既存コードとの互換用に残す
  id: string
  catKey: string
  label: string
  emoji: string
  sortOrder: number
  archived: boolean
}

// ---------- 既定カテゴリ(フォールバック兼・初回移行時のシード) ----------

const DEFAULT_DEFS: { key: string; label: string; emoji: string }[] = [
  { key: 'food', label: '食費', emoji: '🍚' },
  { key: 'eating_out', label: '外食', emoji: '🍜' },
  { key: 'daily', label: '日用品', emoji: '🧻' },
  { key: 'transport', label: '交通費', emoji: '🚃' },
  { key: 'hobby', label: '趣味・娯楽', emoji: '🎮' },
  { key: 'social', label: '交際費', emoji: '🍻' },
  { key: 'health', label: '医療・健康', emoji: '💊' },
  { key: 'other', label: 'その他', emoji: '📦' },
]

const DEFAULT_CATEGORIES: Category[] = DEFAULT_DEFS.map((d, i) => ({
  id: d.key,
  catKey: d.key,
  label: d.label,
  emoji: d.emoji,
  sortOrder: i,
  archived: false,
}))

// ---------- localStorage キャッシュ ----------

const CACHE_KEY = 'kakeibo.categories'

function loadCache(): Category[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    const out: Category[] = []
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) return null
      const c = item as Partial<Category>
      if (typeof c.catKey !== 'string' || typeof c.label !== 'string' || typeof c.emoji !== 'string') {
        return null
      }
      out.push({
        id: c.catKey,
        catKey: c.catKey,
        label: c.label,
        emoji: c.emoji,
        sortOrder: typeof c.sortOrder === 'number' ? c.sortOrder : 0,
        archived: c.archived === true,
      })
    }
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

function saveCache(rows: Category[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows))
  } catch {
    // 容量超過等は無視(キャッシュはあくまで補助)
  }
}

// ---------- モジュールレベルのストア ----------

// archived を含む全カテゴリ(過去の記録の表示解決に使う)
let allCategories: Category[] = loadCache() ?? DEFAULT_CATEGORIES

function computeActive(): Category[] {
  return allCategories
    .filter((c) => !c.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'ja'))
}

// useSyncExternalStore 用に参照が安定したスナップショットを保持する
let activeSnapshot: Category[] = computeActive()

const listeners = new Set<() => void>()

function setCategories(rows: Category[]): void {
  allCategories = rows
  activeSnapshot = computeActive()
  saveCache(rows)
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): Category[] {
  return activeSnapshot
}

/** アクティブなカテゴリ一覧 (sort_order 順)。ストア更新時に再描画される */
export function useCategories(): Category[] {
  return useSyncExternalStore(subscribe, getSnapshot)
}

// ---------- 互換API(同期関数のまま維持) ----------

function resolve(id: string): Category | undefined {
  return (
    allCategories.find((c) => c.catKey === id) ?? DEFAULT_CATEGORIES.find((c) => c.catKey === id)
  )
}

export function categoryLabel(id: string | null): string {
  if (!id) return '未分類'
  const c = resolve(id)
  return c ? c.label : id
}

export function categoryEmoji(id: string | null): string {
  if (!id) return '📦'
  const c = resolve(id)
  return c ? c.emoji : '📦'
}

// ---------- Supabase 連携 ----------

interface CategoryRow {
  cat_key: string
  label: string
  emoji: string
  sort_order: number
  archived: boolean
}

function fromRow(r: CategoryRow): Category {
  return {
    id: r.cat_key,
    catKey: r.cat_key,
    label: r.label,
    emoji: r.emoji,
    sortOrder: r.sort_order,
    archived: r.archived,
  }
}

/**
 * Supabase からカテゴリを取得してストアを初期化する。
 * テーブルが空(既存ユーザーの初回)なら既定8カテゴリを insert して移行する。
 * 失敗時(オフライン等)は localStorage キャッシュ / 既定カテゴリのまま継続する。
 */
export async function initCategories(supabase: SupabaseClient): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('cat_key, label, emoji, sort_order, archived')
      .order('sort_order', { ascending: true })
    if (error) return
    const rows = (data ?? []) as CategoryRow[]
    if (rows.length === 0) {
      // 初回: 既定カテゴリをユーザーのテーブルに書き込む
      const seed = DEFAULT_CATEGORIES.map((c) => ({
        cat_key: c.catKey,
        label: c.label,
        emoji: c.emoji,
        sort_order: c.sortOrder,
      }))
      const { data: inserted, error: insError } = await supabase
        .from('categories')
        .insert(seed)
        .select('cat_key, label, emoji, sort_order, archived')
      if (insError || !inserted) return
      setCategories((inserted as CategoryRow[]).map(fromRow))
    } else {
      setCategories(rows.map(fromRow))
    }
  } catch {
    // ネットワーク例外等 — キャッシュ/既定で継続
  }
}

// ---------- CRUD(カテゴリ編集はオンライン前提。失敗時は throw) ----------

function throwOn(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

/** カテゴリを追加する。cat_key は uuid を採番 */
export async function addCategory(
  supabase: SupabaseClient,
  label: string,
  emoji: string
): Promise<void> {
  const catKey = crypto.randomUUID()
  const sortOrder = allCategories.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1
  const { data, error } = await supabase
    .from('categories')
    .insert({ cat_key: catKey, label, emoji, sort_order: sortOrder })
    .select('cat_key, label, emoji, sort_order, archived')
    .single()
  throwOn(error)
  if (!data) throw new Error('カテゴリを追加できませんでした')
  setCategories([...allCategories, fromRow(data as CategoryRow)])
}

/** 名前・絵文字を変更する */
export async function updateCategory(
  supabase: SupabaseClient,
  catKey: string,
  patch: { label?: string; emoji?: string }
): Promise<void> {
  const { error } = await supabase.from('categories').update(patch).eq('cat_key', catKey)
  throwOn(error)
  setCategories(allCategories.map((c) => (c.catKey === catKey ? { ...c, ...patch } : c)))
}

/**
 * カテゴリを削除(アーカイブ)する。
 * 行は残るため、過去の記録のカテゴリ名・絵文字は引き続き表示できる。
 */
export async function archiveCategory(supabase: SupabaseClient, catKey: string): Promise<void> {
  const { error } = await supabase.from('categories').update({ archived: true }).eq('cat_key', catKey)
  throwOn(error)
  setCategories(allCategories.map((c) => (c.catKey === catKey ? { ...c, archived: true } : c)))
}

/** アクティブ一覧内で1つ上/下と sort_order を入れ替える */
export async function moveCategory(
  supabase: SupabaseClient,
  catKey: string,
  direction: 'up' | 'down'
): Promise<void> {
  const active = getSnapshot()
  const idx = active.findIndex((c) => c.catKey === catKey)
  if (idx < 0) return
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1
  if (swapIdx < 0 || swapIdx >= active.length) return
  const a = active[idx]
  const b = active[swapIdx]
  const { error: e1 } = await supabase
    .from('categories')
    .update({ sort_order: b.sortOrder })
    .eq('cat_key', a.catKey)
  throwOn(e1)
  const { error: e2 } = await supabase
    .from('categories')
    .update({ sort_order: a.sortOrder })
    .eq('cat_key', b.catKey)
  throwOn(e2)
  setCategories(
    allCategories.map((c) =>
      c.catKey === a.catKey
        ? { ...c, sortOrder: b.sortOrder }
        : c.catKey === b.catKey
          ? { ...c, sortOrder: a.sortOrder }
          : c
    )
  )
}
