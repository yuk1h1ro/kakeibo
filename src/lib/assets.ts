// ============================================================
// 資産・負債の登録と残高スナップショット (機能101)
//
// 保存先は Supabase の assets / asset_balances + localStorage キャッシュ
// (categories.ts・transactionTemplates.ts と同じ
//  「モジュールレベルのストア + useSyncExternalStore」構成)。
//
// なぜ transactions と分けるのか:
//   支出は「出来事(フロー)」、残高は「ある時点の状態(ストック)」で性質が違う。
//   同じテーブルに混ぜると月次集計・レポート・彼女の預かり残高に資産の数字が
//   紛れ込んでしまう。テーブルを分けておけば、家計簿側の集計コードが
//   資産の行を1件も見ないことが構造的に保証される。
//
// マイグレーション未実行(テーブルが無い)ときは status を 'unavailable' にして
// タブごと隠す。記録・入力・同期には一切触れない。
// ============================================================

import { useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isSchemaError, toServerError } from './serverErrors'

/** 資産か負債か。負債は残債を正の数で持ち、純資産を出すときに引く */
export type AssetKind = 'asset' | 'liability'

export interface AssetDef {
  id: string
  kind: AssetKind
  /** 種別キー(ASSET_CATEGORIES / LIABILITY_CATEGORIES の key) */
  category: string
  name: string
  sortOrder: number
  /** 一覧からも集計からも外した状態(解約・完済したもの) */
  archived: boolean
}

export interface BalanceSnapshot {
  id: string
  assetId: string
  /** 残高の基準日 'YYYY-MM-DD' */
  asOf: string
  /** 円・整数。負債は残債を正の数で持つ */
  balance: number
  /** 同じ日に複数回更新したときの後勝ち判定に使う */
  createdAt: string
}

export type AssetInput = Pick<AssetDef, 'kind' | 'category' | 'name'>

// ---------- 種別(選択肢) ----------

export interface AssetCategoryDef {
  key: string
  label: string
  emoji: string
}

export const ASSET_CATEGORIES: AssetCategoryDef[] = [
  { key: 'bank', label: '銀行口座', emoji: '🏦' },
  { key: 'securities', label: '証券・投資', emoji: '📈' },
  { key: 'cash', label: '現金', emoji: '💴' },
  { key: 'emoney', label: '電子マネー・ポイント', emoji: '💳' },
  { key: 'insurance', label: '保険・年金', emoji: '🛡️' },
  { key: 'realestate', label: '不動産・その他資産', emoji: '🏠' },
]

export const LIABILITY_CATEGORIES: AssetCategoryDef[] = [
  { key: 'credit_card', label: 'クレジットカード', emoji: '💳' },
  { key: 'loan', label: 'ローン', emoji: '🏧' },
  { key: 'scholarship', label: '奨学金', emoji: '🎓' },
  { key: 'other_debt', label: 'その他の負債', emoji: '📄' },
]

export function categoriesFor(kind: AssetKind): AssetCategoryDef[] {
  return kind === 'liability' ? LIABILITY_CATEGORIES : ASSET_CATEGORIES
}

/** 種別キーの表示名。未知のキーはキーをそのまま出す(将来足しても壊れないように) */
export function assetCategoryLabel(kind: AssetKind, key: string): string {
  return categoriesFor(kind).find((c) => c.key === key)?.label ?? key
}

export function assetCategoryEmoji(kind: AssetKind, key: string): string {
  return categoriesFor(kind).find((c) => c.key === key)?.emoji ?? (kind === 'liability' ? '📄' : '💰')
}

// ---------- localStorage キャッシュ ----------
// オフラインでも「いまの純資産」を見られるようにするためのもの。
// 書き込みはオンライン前提なので、キャッシュは読み取り専用の控えとして扱う。

const ASSETS_CACHE_KEY = 'kakeibo.assets'
const BALANCES_CACHE_KEY = 'kakeibo.assetBalances'

function loadCache<T>(key: string, isValid: (v: unknown) => boolean): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValid) as T[]
  } catch {
    return []
  }
}

function saveCache(key: string, rows: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(rows))
  } catch {
    // 容量超過等は無視(キャッシュはあくまで補助)
  }
}

function isAssetLike(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const a = v as Partial<AssetDef>
  return typeof a.id === 'string' && typeof a.name === 'string' && typeof a.kind === 'string'
}

function isBalanceLike(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false
  const b = v as Partial<BalanceSnapshot>
  return typeof b.id === 'string' && typeof b.assetId === 'string' && typeof b.balance === 'number'
}

// ---------- モジュールレベルのストア ----------

/**
 * 'unknown'     … まだ Supabase に問い合わせていない(キャッシュだけの状態)
 * 'ready'       … テーブルがあり、読み込めた
 * 'unavailable' … テーブルが無い(migration-assets.sql 未実行)
 */
export type AssetsStatus = 'unknown' | 'ready' | 'unavailable'

export interface AssetsSnapshot {
  assets: AssetDef[]
  balances: BalanceSnapshot[]
  status: AssetsStatus
}

let snapshot: AssetsSnapshot = {
  assets: loadCache<AssetDef>(ASSETS_CACHE_KEY, isAssetLike),
  balances: loadCache<BalanceSnapshot>(BALANCES_CACHE_KEY, isBalanceLike),
  status: 'unknown',
}

const listeners = new Set<() => void>()

function publish(next: Partial<AssetsSnapshot>): void {
  snapshot = { ...snapshot, ...next }
  if (next.assets) saveCache(ASSETS_CACHE_KEY, snapshot.assets)
  if (next.balances) saveCache(BALANCES_CACHE_KEY, snapshot.balances)
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): AssetsSnapshot {
  return snapshot
}

export function useAssetsStore(): AssetsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * 資産タブを出してよいか。
 * - テーブルが無いと分かっている間は出さない(マイグレーション未実行)
 * - まだ確認できていない(オフライン起動など)ときは、キャッシュがあるときだけ出す。
 *   こうすると未実行のユーザーにタブが一瞬だけ現れて消える、という挙動を避けられる。
 */
export function isAssetsTabVisible(s: AssetsSnapshot): boolean {
  if (s.status === 'ready') return true
  if (s.status === 'unavailable') return false
  return s.assets.length > 0
}

// ---------- Supabase 連携 ----------

interface AssetRowDb {
  id: string
  kind: string
  category: string | null
  name: string
  sort_order: number | null
  archived: boolean | null
}

interface BalanceRowDb {
  id: string
  asset_id: string
  as_of: string
  balance: number
  created_at: string
}

const ASSET_COLUMNS = 'id, kind, category, name, sort_order, archived'
const BALANCE_COLUMNS = 'id, asset_id, as_of, balance, created_at'

function fromAssetRow(r: AssetRowDb): AssetDef {
  return {
    id: r.id,
    kind: r.kind === 'liability' ? 'liability' : 'asset',
    category: r.category ?? 'other',
    name: r.name,
    sortOrder: r.sort_order ?? 0,
    archived: r.archived === true,
  }
}

function fromBalanceRow(r: BalanceRowDb): BalanceSnapshot {
  return {
    id: r.id,
    assetId: r.asset_id,
    asOf: r.as_of,
    // DB 側は integer/bigint なので小数は入らないが、
    // 万一の型ゆらぎで小数が来ても円の整数に丸めてから集計に渡す
    balance: Math.round(r.balance),
    createdAt: r.created_at,
  }
}

/**
 * Supabase から資産と残高を読み込む。
 * テーブルが無ければ静かに無効化する(既存の記録・入力・同期は一切妨げない)。
 * ネットワーク失敗時は localStorage キャッシュのまま継続する。
 */
export async function initAssets(supabase: SupabaseClient): Promise<void> {
  try {
    const { data: assetData, error: assetError } = await supabase
      .from('assets')
      .select(ASSET_COLUMNS)
      .order('sort_order', { ascending: true })
    if (assetError) {
      if (isSchemaError(assetError)) publish({ status: 'unavailable' })
      return
    }
    const { data: balanceData, error: balanceError } = await supabase
      .from('asset_balances')
      .select(BALANCE_COLUMNS)
      .order('as_of', { ascending: true })
    if (balanceError) {
      if (isSchemaError(balanceError)) publish({ status: 'unavailable' })
      return
    }
    publish({
      assets: ((assetData ?? []) as unknown as AssetRowDb[]).map(fromAssetRow),
      balances: ((balanceData ?? []) as unknown as BalanceRowDb[]).map(fromBalanceRow),
      status: 'ready',
    })
  } catch {
    // ネットワーク例外等 — キャッシュのまま継続(status は 'unknown' のまま)
  }
}

/** 編集系はオンライン前提。失敗したら理由を添えて throw する */
function throwOn(error: unknown): void {
  if (!error) return
  const e = toServerError(error)
  if (isSchemaError(e)) {
    publish({ status: 'unavailable' })
    throw new Error('資産のテーブルがありません(supabase/migration-assets.sql を実行してください)')
  }
  throw new Error(e.message)
}

export async function addAsset(supabase: SupabaseClient, input: AssetInput): Promise<AssetDef> {
  const sortOrder = snapshot.assets.reduce((max, a) => Math.max(max, a.sortOrder), -1) + 1
  const { data, error } = await supabase
    .from('assets')
    .insert({
      kind: input.kind,
      category: input.category,
      name: input.name,
      sort_order: sortOrder,
    })
    .select(ASSET_COLUMNS)
    .single()
  throwOn(error)
  if (!data) throw new Error('資産を保存できませんでした')
  const created = fromAssetRow(data as unknown as AssetRowDb)
  publish({ assets: [...snapshot.assets, created] })
  return created
}

export async function updateAsset(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<AssetInput>
): Promise<void> {
  const { error } = await supabase.from('assets').update(patch).eq('id', id)
  throwOn(error)
  publish({ assets: snapshot.assets.map((a) => (a.id === id ? { ...a, ...patch } : a)) })
}

/**
 * 一覧から外す(アーカイブ)。
 * 行は残すので残高の履歴は消えないが、純資産の集計からは外れる。
 * 解約・完済した口座を「最後の残高のまま」持ち越し続けるほうが実態とずれるため。
 */
export async function archiveAsset(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('assets').update({ archived: true }).eq('id', id)
  throwOn(error)
  publish({ assets: snapshot.assets.map((a) => (a.id === id ? { ...a, archived: true } : a)) })
}

export interface BalanceEntry {
  assetId: string
  /** 円・整数 */
  balance: number
}

/**
 * 指定日の残高をまとめて記録する。
 * (asset_id, as_of) の一意制約で upsert しているので、
 * 同じ日に何度更新しても行は増えず、最後の値だけが残る。
 */
export async function recordBalances(
  supabase: SupabaseClient,
  asOf: string,
  entries: readonly BalanceEntry[]
): Promise<void> {
  if (entries.length === 0) return
  const { data, error } = await supabase
    .from('asset_balances')
    .upsert(
      entries.map((e) => ({ asset_id: e.assetId, as_of: asOf, balance: Math.round(e.balance) })),
      { onConflict: 'asset_id,as_of' }
    )
    .select(BALANCE_COLUMNS)
  throwOn(error)
  const saved = ((data ?? []) as unknown as BalanceRowDb[]).map(fromBalanceRow)
  // 同じ (資産, 日付) の古い行を差し替えてから足す
  const replaced = new Set(saved.map((s) => `${s.assetId} ${s.asOf}`))
  publish({
    balances: [
      ...snapshot.balances.filter((b) => !replaced.has(`${b.assetId} ${b.asOf}`)),
      ...saved,
    ],
  })
}

/** 記録した残高を取り消す(打ち間違いの修正用) */
export async function deleteBalance(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('asset_balances').delete().eq('id', id)
  throwOn(error)
  publish({ balances: snapshot.balances.filter((b) => b.id !== id) })
}
