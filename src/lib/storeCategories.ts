// ============================================================
// 店名からカテゴリを学習する (機能067 + 075)
//
// 支出を保存するたびに「店名 → そのとき選ばれたカテゴリ」を覚え、
// 次に同じ店名を入力し始めたら候補として出し、確定したらカテゴリを自動で選ぶ。
// 上書きされたら新しい方を覚え直すので、ルール管理の画面は要らない。
//
// 保存先は Supabase の store_categories + localStorage キャッシュ。
// categories.ts と同じ「モジュールレベルのストア + useSyncExternalStore」構成。
// ============================================================

import { useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Transaction } from './types'
import { isSchemaError, toServerError } from './serverErrors'

export interface StoreCategory {
  /** 突き合わせ用に正規化した店名(主キー) */
  storeKey: string
  /** 表示・入力補完に使う、ユーザーが実際に打った店名 */
  storeName: string
  /** その店で最後に選ばれたカテゴリ(= categories.cat_key) */
  category: string
  /** ISO8601。同じ店の記憶が複数あるときに新しい方を採る */
  updatedAt: string
}

// ---------- 純粋関数(突き合わせ・候補の絞り込み) ----------

/**
 * 店名を突き合わせ用のキーに正規化する。
 * 全角/半角・大文字小文字・空白の違いで別の店として覚えてしまうのを防ぐ。
 * 空白は詰める(「セブン イレブン」と「セブンイレブン」を同一視する)。
 */
export function normalizeStoreName(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

/**
 * 入力中の文字列に対する店名候補を返す。(純粋関数)
 * 前方一致を先に、部分一致を後に並べる(打ち始めた文字で始まる店が最も期待に近い)。
 * 同順位のときは新しく使った店を優先する。
 */
export function matchStoreSuggestions(
  entries: readonly StoreCategory[],
  query: string,
  limit = 5
): StoreCategory[] {
  const q = normalizeStoreName(query)
  if (q === '') return []
  const scored: { entry: StoreCategory; rank: number }[] = []
  for (const e of entries) {
    if (e.storeKey === q) continue // 打ち終わった店そのものは候補に出さない
    if (e.storeKey.startsWith(q)) scored.push({ entry: e, rank: 0 })
    else if (e.storeKey.includes(q)) scored.push({ entry: e, rank: 1 })
  }
  scored.sort((a, b) => a.rank - b.rank || b.entry.updatedAt.localeCompare(a.entry.updatedAt))
  return scored.slice(0, limit).map((s) => s.entry)
}

/** 店名に対して記憶しているカテゴリ。無ければ null。(純粋関数) */
export function lookupStoreCategory(
  entries: readonly StoreCategory[],
  storeName: string
): string | null {
  const key = normalizeStoreName(storeName)
  if (key === '') return null
  return entries.find((e) => e.storeKey === key)?.category ?? null
}

/**
 * 「この店の過去の記録も新しいカテゴリに変えるか」の対象を洗い出す。(純粋関数)
 * 同じ店名(正規化後)の支出のうち、カテゴリが違うものだけを返す。
 * 保存したばかりの行は既に新カテゴリなので自然に対象外になる。
 */
export function transactionsToRecategorize(
  transactions: readonly Transaction[],
  storeName: string,
  category: string
): Transaction[] {
  const key = normalizeStoreName(storeName)
  if (key === '') return []
  return transactions.filter(
    (t) =>
      t.type === 'expense' &&
      t.category !== category &&
      normalizeStoreName(t.store ?? '') === key
  )
}

/** 同じ店の記憶を1件にまとめる。updatedAt が新しい方を採る。(純粋関数) */
export function mergeStoreCategories(
  a: readonly StoreCategory[],
  b: readonly StoreCategory[]
): StoreCategory[] {
  const map = new Map<string, StoreCategory>()
  for (const e of [...a, ...b]) {
    const cur = map.get(e.storeKey)
    if (!cur || cur.updatedAt < e.updatedAt) map.set(e.storeKey, e)
  }
  return [...map.values()].sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))
}

// ---------- localStorage キャッシュ ----------

const CACHE_KEY = 'kakeibo.storeCategories'

function loadCache(): StoreCategory[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: StoreCategory[] = []
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue
      const e = item as Partial<StoreCategory>
      if (
        typeof e.storeKey !== 'string' ||
        typeof e.storeName !== 'string' ||
        typeof e.category !== 'string'
      ) {
        continue
      }
      out.push({
        storeKey: e.storeKey,
        storeName: e.storeName,
        category: e.category,
        updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : '',
      })
    }
    return out
  } catch {
    return []
  }
}

function saveCache(rows: StoreCategory[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows))
  } catch {
    // 容量超過等は無視(キャッシュはあくまで補助)
  }
}

// ---------- モジュールレベルのストア ----------

let entries: StoreCategory[] = loadCache()
const listeners = new Set<() => void>()

// store_categories テーブルが無い(マイグレーション未実行)場合は true。
// 学習は端末内だけで続け、サーバーへの書き込みは以後試さない。
let tableMissing = false

function setEntries(rows: StoreCategory[]): void {
  entries = rows
  saveCache(rows)
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): StoreCategory[] {
  return entries
}

/** 学習済みの店名一覧。保存のたびに再描画される */
export function useStoreCategories(): StoreCategory[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** 現在の記憶(フックの外から参照する用) */
export function getStoreCategories(): StoreCategory[] {
  return entries
}

// ---------- Supabase 連携 ----------

interface StoreCategoryRow {
  store_key: string
  store_name: string
  category: string
  updated_at: string
}

function fromRow(r: StoreCategoryRow): StoreCategory {
  return {
    storeKey: r.store_key,
    storeName: r.store_name,
    category: r.category,
    updatedAt: r.updated_at ?? '',
  }
}

/**
 * Supabase から学習内容を読み込む。
 * テーブルが無ければ静かに無効化し、以後サーバーには書き込まない
 * (端末内のキャッシュだけで学習は続くので、入力の邪魔はしない)。
 */
export async function initStoreCategories(supabase: SupabaseClient): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('store_categories')
      .select('store_key, store_name, category, updated_at')
    if (error) {
      if (isSchemaError(error)) tableMissing = true
      return
    }
    // オフライン中に覚えた分を消さないよう、サーバーの内容とマージする
    setEntries(mergeStoreCategories(entries, ((data ?? []) as StoreCategoryRow[]).map(fromRow)))
  } catch {
    // ネットワーク例外等 — キャッシュのまま継続
  }
}

/**
 * 店名とカテゴリの対応を覚える。
 * 戻り値はこの保存より前に覚えていたカテゴリ(初めての店なら null)。
 * 「カテゴリが変わったか」の判定に使うので、キャッシュを更新する前の値を返す。
 *
 * サーバーへの書き込みに失敗しても throw しない — 学習は入力のおまけであって、
 * ここで失敗を表に出すと記録そのものが止まって見えてしまう。
 */
export async function rememberStoreCategory(
  supabase: SupabaseClient,
  storeName: string,
  category: string
): Promise<string | null> {
  const key = normalizeStoreName(storeName)
  if (key === '' || category === '') return null

  const before = entries.find((e) => e.storeKey === key) ?? null
  const previous = before?.category ?? null
  const now = new Date().toISOString()

  // まず端末内の記憶を更新する(オフラインでも次の入力から効く)
  setEntries([
    { storeKey: key, storeName: storeName.trim(), category, updatedAt: now },
    ...entries.filter((e) => e.storeKey !== key),
  ])

  if (tableMissing) return previous

  const row = { store_key: key, store_name: storeName.trim(), category, updated_at: now }
  try {
    if (before) {
      const { error } = await supabase
        .from('store_categories')
        .update(row)
        .eq('store_key', key)
      if (error && isSchemaError(error)) tableMissing = true
    } else {
      const { error } = await supabase.from('store_categories').insert(row)
      if (error) {
        if (isSchemaError(error)) tableMissing = true
        // 別端末が先に覚えていた場合(一意制約違反)は更新に切り替える
        else if (error.code === '23505') {
          await supabase.from('store_categories').update(row).eq('store_key', key)
        }
      }
    }
  } catch (e) {
    if (isSchemaError(toServerError(e))) tableMissing = true
  }
  return previous
}
