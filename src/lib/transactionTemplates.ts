// ============================================================
// よく使う入力のテンプレート (機能072)
//
// 店・カテゴリ・金額・彼女の負担分の組み合わせを保存し、入力タブから1タップで呼び出す。
// 保存先は Supabase の transaction_templates + localStorage キャッシュ
// (categories.ts と同じ「モジュールレベルのストア + useSyncExternalStore」構成)。
// ============================================================

import { useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Transaction } from './types'
import { categoryLabel } from './categories'
import { isSchemaError } from './serverErrors'

export interface TransactionTemplate {
  id: string
  /** チップに出す名前。空なら店名・メモ・カテゴリ名で補う */
  title: string
  amount: number
  category: string | null
  store: string
  memo: string
  partnerAmount: number
  sortOrder: number
}

export type TransactionTemplateInput = Omit<TransactionTemplate, 'id' | 'sortOrder'>

// ---------- 純粋関数 ----------

/** チップに出す表示名。名前が空でも何のテンプレートか分かるようにする。(純粋関数) */
export function templateLabel(t: TransactionTemplateInput): string {
  const title = t.title.trim()
  if (title !== '') return title
  if (t.store.trim() !== '') return t.store.trim()
  if (t.memo.trim() !== '') return t.memo.trim()
  return categoryLabel(t.category)
}

/** 既存の取引から「これをテンプレートにする」ときの初期値。(純粋関数) */
export function templateFromTransaction(t: Transaction): TransactionTemplateInput {
  return {
    title: t.store || t.memo || '',
    amount: t.amount,
    category: t.category,
    store: t.store ?? '',
    memo: t.memo ?? '',
    partnerAmount: t.partner_amount,
  }
}

// ---------- localStorage キャッシュ ----------

const CACHE_KEY = 'kakeibo.transactionTemplates'

function loadCache(): TransactionTemplate[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as TransactionTemplate[]) : []
  } catch {
    return []
  }
}

function saveCache(rows: TransactionTemplate[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows))
  } catch {
    // 容量超過等は無視(キャッシュはあくまで補助)
  }
}

// ---------- モジュールレベルのストア ----------

let templates: TransactionTemplate[] = loadCache()
const listeners = new Set<() => void>()

// transaction_templates テーブルが無い(マイグレーション未実行)場合は true。
// テンプレートの導線を出さないだけで、通常の入力には影響しない。
let tableMissing = false

function setTemplates(rows: TransactionTemplate[]): void {
  templates = [...rows].sort((a, b) => a.sortOrder - b.sortOrder)
  saveCache(templates)
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): TransactionTemplate[] {
  return templates
}

export function useTransactionTemplates(): TransactionTemplate[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function isTemplatesUnavailable(): boolean {
  return tableMissing
}

// ---------- Supabase 連携 ----------

interface TemplateRow {
  id: string
  title: string | null
  amount: number
  category: string | null
  store: string | null
  memo: string | null
  partner_amount: number | null
  sort_order: number | null
}

const SELECT_COLUMNS = 'id, title, amount, category, store, memo, partner_amount, sort_order'

function fromRow(r: TemplateRow): TransactionTemplate {
  return {
    id: r.id,
    title: r.title ?? '',
    amount: r.amount,
    category: r.category,
    store: r.store ?? '',
    memo: r.memo ?? '',
    partnerAmount: r.partner_amount ?? 0,
    sortOrder: r.sort_order ?? 0,
  }
}

/**
 * Supabase からテンプレートを読み込む。
 * テーブルが無ければ静かに無効化する(既存の入力は一切妨げない)。
 */
export async function initTransactionTemplates(supabase: SupabaseClient): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('transaction_templates')
      .select(SELECT_COLUMNS)
      .order('sort_order', { ascending: true })
    if (error) {
      if (isSchemaError(error)) {
        tableMissing = true
        setTemplates([])
      }
      return
    }
    tableMissing = false
    setTemplates(((data ?? []) as unknown as TemplateRow[]).map(fromRow))
  } catch {
    // ネットワーク例外等 — キャッシュのまま継続
  }
}

function throwOn(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

/** テンプレートを追加する。編集系はオンライン前提で、失敗時は throw する */
export async function addTransactionTemplate(
  supabase: SupabaseClient,
  input: TransactionTemplateInput
): Promise<void> {
  const sortOrder = templates.reduce((max, t) => Math.max(max, t.sortOrder), -1) + 1
  const { data, error } = await supabase
    .from('transaction_templates')
    .insert({
      title: input.title,
      amount: input.amount,
      category: input.category,
      store: input.store,
      memo: input.memo,
      partner_amount: input.partnerAmount,
      sort_order: sortOrder,
    })
    .select(SELECT_COLUMNS)
    .single()
  throwOn(error)
  if (!data) throw new Error('テンプレートを保存できませんでした')
  setTemplates([...templates, fromRow(data as unknown as TemplateRow)])
}

export async function deleteTransactionTemplate(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await supabase.from('transaction_templates').delete().eq('id', id)
  throwOn(error)
  setTemplates(templates.filter((t) => t.id !== id))
}
