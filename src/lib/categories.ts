import { useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatGuidance, guidanceForServerError, isOnlineNow } from './errorGuidance'
import type { ServerErrorLike } from './serverErrors'

export interface Category {
  // id は transactions.category に保存される値 (= cat_key)。既存コードとの互換用に残す
  id: string
  catKey: string
  label: string
  // categories.emoji カラムの生値。絵文字1〜2文字、または 'icon:rice' 形式のアイコンID
  emoji: string
  sortOrder: number
  archived: boolean
}

// ---------- 既定カテゴリ(フォールバック兼・初回移行時のシード) ----------

const DEFAULT_DEFS: { key: string; label: string; emoji: string }[] = [
  { key: 'food', label: '食費', emoji: 'icon:rice' },
  { key: 'eating_out', label: '外食', emoji: 'icon:ramen' },
  { key: 'daily', label: '日用品', emoji: 'icon:cart' },
  { key: 'transport', label: '交通費', emoji: 'icon:train' },
  { key: 'hobby', label: '趣味・娯楽', emoji: 'icon:gamepad' },
  { key: 'social', label: '交際費', emoji: 'icon:beer' },
  { key: 'health', label: '医療・健康', emoji: 'icon:pill' },
  { key: 'other', label: 'その他', emoji: 'icon:box' },
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

/**
 * 隠したカテゴリ (機能086)。並びは元の sort_order のまま。
 * 「隠した順」ではなく「元の並び」で出したほうが、戻すときに探しやすい。
 */
function computeArchived(): Category[] {
  return allCategories
    .filter((c) => c.archived)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'ja'))
}

// useSyncExternalStore 用に参照が安定したスナップショットを保持する
let activeSnapshot: Category[] = computeActive()
let archivedSnapshot: Category[] = computeArchived()

const listeners = new Set<() => void>()

function setCategories(rows: Category[]): void {
  allCategories = rows
  activeSnapshot = computeActive()
  archivedSnapshot = computeArchived()
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

function getArchivedSnapshot(): Category[] {
  return archivedSnapshot
}

/** アクティブなカテゴリ一覧 (sort_order 順)。ストア更新時に再描画される */
export function useCategories(): Category[] {
  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * 隠しているカテゴリ一覧 (機能086)。
 * 入力の選択肢には出さないが、設定画面で「戻す」ために一覧できる必要がある。
 * 過去の記録の表示は archived に関係なく resolve() が解決するので影響しない。
 */
export function useArchivedCategories(): Category[] {
  return useSyncExternalStore(subscribe, getArchivedSnapshot)
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

// ---------- カテゴリの見た目の解決(絵文字 / 線画アイコン) ----------

/** カテゴリの表示形態。icon は categoryIcons.tsx の CategoryIcon で描画する */
export type CategoryVisual = { kind: 'icon'; icon: string } | { kind: 'emoji'; emoji: string }

const ICON_PREFIX = 'icon:'

// 既定8カテゴリの旧絵文字 → アイコンIDの読み替え表。
// 既存ユーザーのDBには絵文字でseed済みのため、この読み替えが無いと見た目が変わらない。
const LEGACY_EMOJI_TO_ICON: Record<string, string> = {
  '🍚': 'rice',
  '🍜': 'ramen',
  '🧻': 'cart',
  '🚃': 'train',
  '🎮': 'gamepad',
  '🍻': 'beer',
  '💊': 'pill',
  '📦': 'box',
}

/**
 * emoji カラムの生値から表示形態を求める。
 * - 'icon:xxx' → 線画アイコン
 * - 既定8カテゴリの旧絵文字 → 対応する線画アイコンに読み替え
 * - それ以外の絵文字 → 従来どおり絵文字表示(後方互換)
 */
export function visualFromEmojiValue(raw: string): CategoryVisual {
  if (raw.startsWith(ICON_PREFIX)) {
    return { kind: 'icon', icon: raw.slice(ICON_PREFIX.length) }
  }
  const mapped = LEGACY_EMOJI_TO_ICON[raw]
  if (mapped) return { kind: 'icon', icon: mapped }
  return { kind: 'emoji', emoji: raw }
}

/** カテゴリIDから表示形態を求める。未分類・不明カテゴリは box アイコン */
export function resolveCategoryVisual(id: string | null): CategoryVisual {
  if (!id) return { kind: 'icon', icon: 'box' }
  const c = resolve(id)
  return c ? visualFromEmojiValue(c.emoji) : { kind: 'icon', icon: 'box' }
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

// 原文をそのまま投げると、カテゴリ設定シートには英語の PostgREST メッセージが出る。
// 他の lib (recurringRules / transactionTemplates / shareLinks / partnerComments) と
// 同じく、原因と次の行動に置き換えてから投げる (機能161)
function throwOn(error: ServerErrorLike | null): void {
  if (error) throw new Error(formatGuidance(guidanceForServerError(error, isOnlineNow())))
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
 * カテゴリを隠す(アーカイブ)。削除ではない (機能086)。
 * 行は残るため、過去の記録のカテゴリ名・絵文字は引き続き表示できる。
 * 入力の選択肢からは消える(useCategories が archived を除いているため)。
 */
export async function archiveCategory(supabase: SupabaseClient, catKey: string): Promise<void> {
  const { error } = await supabase.from('categories').update({ archived: true }).eq('cat_key', catKey)
  throwOn(error)
  setCategories(allCategories.map((c) => (c.catKey === catKey ? { ...c, archived: true } : c)))
}

/**
 * 隠したカテゴリを再表示する (機能086)。
 * sort_order はそのままなので、元の位置に戻る。
 */
export async function unarchiveCategory(supabase: SupabaseClient, catKey: string): Promise<void> {
  const { error } = await supabase
    .from('categories')
    .update({ archived: false })
    .eq('cat_key', catKey)
  throwOn(error)
  setCategories(allCategories.map((c) => (c.catKey === catKey ? { ...c, archived: false } : c)))
}

/** そのカテゴリを使っている記録の件数。隠す前の確認に使う。(純粋関数) */
export function countTransactionsWithCategory(
  txs: readonly { category: string | null }[],
  catKey: string
): number {
  return txs.filter((t) => t.category === catKey).length
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
