// ============================================================
// 絞り込み条件の保存 (機能152)
//
// 「今月の外食だけ」のような組み合わせに名前を付けて、ワンタップで再現する。
//
// 保存先は端末内 (localStorage)。理由:
//   - 絞り込みは「その端末でどう見たいか」であって記録そのものではない。
//     失っても記録は1件も減らないので、DB(とマイグレーション)を増やす価値が薄い。
//   - localStorage ならオフラインでも保存・呼び出しができる(このアプリの前提)。
//   - Supabase に置くと新しいテーブル + RLS が必要になり、
//     未実行の環境で機能が消える不確実さを1つ増やすことになる。
// 使う人は1人なので、端末間で共有できないことの実害はほぼない。
// ============================================================

import { DEFAULT_FILTER, sameFilter, type HistoryFilter } from './historyFilter'

export interface SavedFilter {
  id: string
  name: string
  filter: HistoryFilter
  createdAt: string
}

/** 保存できる上限。増えすぎるとワンタップの良さが消えるので絞る */
export const MAX_SAVED_FILTERS = 12

// ---------- 純粋関数 ----------

/**
 * 条件を追加した一覧を返す。(純粋関数)
 * 同じ名前があれば上書きする(同じ名前が2つ並ぶと選べなくなるため)。
 * 上限を超えたら古いものから捨てる。
 */
export function addSavedFilter(
  list: readonly SavedFilter[],
  entry: SavedFilter
): SavedFilter[] {
  const name = entry.name.trim()
  const kept = list.filter((s) => s.name !== name)
  return [...kept, { ...entry, name }].slice(-MAX_SAVED_FILTERS)
}

export function removeSavedFilter(list: readonly SavedFilter[], id: string): SavedFilter[] {
  return list.filter((s) => s.id !== id)
}

/** いまの絞り込みと一致する保存済み条件(あれば)。選択中の表示に使う。(純粋関数) */
export function findMatchingFilter(
  list: readonly SavedFilter[],
  filter: HistoryFilter
): SavedFilter | null {
  return list.find((s) => sameFilter(s.filter, filter)) ?? null
}

/** 保存できる状態か。既定のまま(= 何も絞っていない)を保存させない。(純粋関数) */
export function canSaveFilter(filter: HistoryFilter): boolean {
  return !sameFilter(filter, DEFAULT_FILTER)
}

/** 壊れた/古い形の保存内容を弾いて読む。(純粋関数) */
export function parseSavedFilters(raw: unknown): SavedFilter[] {
  if (!Array.isArray(raw)) return []
  const out: SavedFilter[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const s = item as Partial<SavedFilter>
    if (typeof s.id !== 'string' || typeof s.name !== 'string') continue
    const f = s.filter as Partial<HistoryFilter> | undefined
    if (!f || typeof f.query !== 'string') continue
    out.push({
      id: s.id,
      name: s.name,
      createdAt: typeof s.createdAt === 'string' ? s.createdAt : '',
      filter: {
        query: f.query,
        sort: f.sort ?? DEFAULT_FILTER.sort,
        period: f.period ?? DEFAULT_FILTER.period,
        categories: Array.isArray(f.categories) ? f.categories.filter((c) => typeof c === 'string') : [],
      },
    })
  }
  return out.slice(-MAX_SAVED_FILTERS)
}

// ---------- localStorage ----------

const KEY = 'kakeibo.savedFilters'

export function loadSavedFilters(): SavedFilter[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    return parseSavedFilters(JSON.parse(raw))
  } catch {
    // 壊れたJSON等は「保存なし」扱い(致命的にしない)
    return []
  }
}

export function storeSavedFilters(list: readonly SavedFilter[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // 容量超過等。保存できなくても絞り込みそのものは使える
  }
}
