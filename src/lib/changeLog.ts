// ============================================================
// 変更履歴 (機能163)
//
// 「いつ・どの記録を・何から何に」直したかを後から追えるようにする。
// 使う人は1人なので「誰が」は記録しない(列そのものを作らない)。
//
// 保存先は Supabase の transaction_changes テーブル
// (supabase/migration-change-log.sql)。端末を変えても履歴が残るようにするため。
// ただしこの機能は「記録そのもの」ではないので、次を絶対条件にしている:
//   - マイグレーション未実行でもアプリが壊れない(isSchemaError で検知して静かに無効化)
//   - オフラインでも書き込みを失わない(端末内のバッファに貯めて後で送る)
//   - 送信に失敗しても、取引の保存・同期は一切止めない(投げっぱなし)
//
// 際限なく増えないよう、保存期間と件数に上限を置く(下記の定数)。
// ============================================================

import { useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TransactionInput } from '../hooks/useTransactions'
import type { Transaction } from './types'
import { formatDate, yenPlain } from './format'
import { isSchemaError } from './serverErrors'

export type ChangeAction = 'update' | 'delete' | 'restore'

export interface FieldChange {
  /** 表示名(「金額」「カテゴリ」など) */
  label: string
  /** 変更前 / 変更後(表示用の文字列。カテゴリ名はその時点の名前で残す) */
  from: string
  to: string
}

export interface ChangeEntry {
  id: string
  transactionId: string
  action: ChangeAction
  /** どの記録か(日付・店/カテゴリ・金額) */
  summary: string
  changes: FieldChange[]
  /** いつ (ISO8601) */
  changedAt: string
}

/** これより古い履歴は捨てる。半年遡れれば「あれ何で直したっけ」には足りる */
export const RETENTION_DAYS = 180

/** 端末内バッファと画面表示の上限。無限に増えないようにする */
export const MAX_ENTRIES = 200

// ---------- 純粋関数 ----------

export function actionLabel(action: ChangeAction): string {
  switch (action) {
    case 'update':
      return '変更'
    case 'delete':
      return '削除'
    case 'restore':
      return '元に戻した'
  }
}

function textOrDash(v: string): string {
  return v.trim() === '' ? '(なし)' : v.trim()
}

/** どの記録のことかが分かる1行。(純粋関数) */
export function transactionSummary(
  t: Transaction,
  labelOf: (id: string | null) => string
): string {
  // 支出以外は店名もカテゴリも持たないので、種別そのものを見出しにする。
  // ここを落とすと返金・調整が「未分類」と表示され、履歴を遡る意味が薄れる
  const what =
    t.type === 'partner_deposit'
      ? '彼女から預かり'
      : t.type === 'partner_refund'
        ? '彼女へ返金'
        : t.type === 'partner_adjust'
          ? '残高の調整'
          : t.store.trim() !== ''
            ? t.store.trim()
            : labelOf(t.category)
  return `${formatDate(t.date)} ${what} ${yenPlain(t.amount)}`
}

/**
 * 変更前後の差分を出す。(純粋関数)
 *
 * payload にキーが無い項目(undefined)は「今回は触っていない」とみなして差分にしない。
 * satisfaction 列が無い環境ではキーごと落として送るため、
 * 「送らなかった = 変わっていない」を差分にすると嘘の履歴が残ってしまう。
 */
export function diffTransaction(
  before: Transaction,
  after: TransactionInput,
  labelOf: (id: string | null) => string
): FieldChange[] {
  const out: FieldChange[] = []
  const push = (label: string, from: string, to: string) => {
    if (from !== to) out.push({ label, from, to })
  }
  if (after.date !== undefined) push('日付', formatDate(before.date), formatDate(after.date))
  if (after.amount !== undefined) push('金額', yenPlain(before.amount), yenPlain(after.amount))
  if (after.category !== undefined) {
    push('カテゴリ', labelOf(before.category), labelOf(after.category))
  }
  if (after.store !== undefined) push('お店', textOrDash(before.store ?? ''), textOrDash(after.store))
  if (after.memo !== undefined) push('メモ', textOrDash(before.memo ?? ''), textOrDash(after.memo))
  if (after.partner_amount !== undefined) {
    push('彼女の負担分', yenPlain(before.partner_amount), yenPlain(after.partner_amount))
  }
  if (after.satisfaction !== undefined) {
    const name = (v: unknown) =>
      v === 'good' ? '満足' : v === 'neutral' ? '普通' : v === 'regret' ? '後悔' : '未設定'
    push('気分', name(before.satisfaction), name(after.satisfaction))
  }
  return out
}

/**
 * 保存期間と件数の上限を適用する。(純粋関数)
 * 新しい順に MAX_ENTRIES 件まで、かつ RETENTION_DAYS 以内のものだけ残す。
 */
export function pruneEntries(
  entries: readonly ChangeEntry[],
  now: Date,
  retentionDays: number = RETENTION_DAYS,
  maxEntries: number = MAX_ENTRIES
): ChangeEntry[] {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000
  return [...entries]
    .filter((e) => {
      const t = new Date(e.changedAt).getTime()
      return Number.isNaN(t) ? false : t >= cutoff
    })
    .sort((a, b) => b.changedAt.localeCompare(a.changedAt) || a.id.localeCompare(b.id))
    .slice(0, maxEntries)
}

/** 履歴1件を1行の文にする。(純粋関数) */
export function describeEntry(entry: ChangeEntry): string {
  if (entry.changes.length === 0) return actionLabel(entry.action)
  return entry.changes.map((c) => `${c.label} ${c.from} → ${c.to}`).join(' / ')
}

// ---------- 端末内バッファ(オフライン対策) ----------

const BUFFER_KEY = 'kakeibo.changeLogBuffer'

function loadBuffer(): ChangeEntry[] {
  try {
    const raw = localStorage.getItem(BUFFER_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ChangeEntry[]) : []
  } catch {
    return []
  }
}

function saveBuffer(entries: readonly ChangeEntry[]): void {
  try {
    localStorage.setItem(BUFFER_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)))
  } catch {
    // 容量超過等。履歴は補助的な機能なので、保存できなくても何もしない
  }
}

// ---------- 状態(テーブルの有無・Supabase クライアント) ----------

let client: SupabaseClient | null = null
let tableMissing = false
let prunedThisSession = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

/** useTransactions から渡される。履歴シートは props を増やさずここから使う */
export function attachChangeLogClient(supabase: SupabaseClient): void {
  client = supabase
}

function getSnapshot(): boolean {
  return !tableMissing
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 変更履歴の導線を出してよいか。テーブルが無いと分かった時点で消える */
export function useChangeLogAvailable(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function markUnavailable(): void {
  if (tableMissing) return
  tableMissing = true
  // 送れない履歴を貯め続けても意味がないので捨てる(記録そのものではない)
  saveBuffer([])
  notify()
}

// ---------- Supabase 連携 ----------

interface ChangeRow {
  id: string
  transaction_id: string
  action: string
  summary: string | null
  changes: FieldChange[] | null
  changed_at: string
}

function fromRow(r: ChangeRow): ChangeEntry {
  return {
    id: r.id,
    transactionId: r.transaction_id,
    action: (r.action === 'delete' || r.action === 'restore' ? r.action : 'update') as ChangeAction,
    summary: r.summary ?? '',
    changes: Array.isArray(r.changes) ? r.changes : [],
    changedAt: r.changed_at,
  }
}

const SELECT_COLUMNS = 'id, transaction_id, action, summary, changes, changed_at'

/**
 * 履歴を1件記録する。投げっぱなしで呼んでよい(失敗しても何も壊れない)。
 * まず端末内に貯めてから送るので、オフラインでも消えない。
 */
export function recordChange(entry: ChangeEntry): void {
  if (tableMissing) return
  if (entry.action === 'update' && entry.changes.length === 0) return // 変わっていないなら残さない
  saveBuffer([...loadBuffer(), entry])
  void flushChangeLog()
}

/** 貯まっている履歴をまとめて送る。送れた分だけバッファから消す */
export async function flushChangeLog(): Promise<void> {
  if (tableMissing || !client) return
  const buffered = loadBuffer()
  if (buffered.length === 0) return
  try {
    const { error } = await client.from('transaction_changes').insert(
      buffered.map((e) => ({
        id: e.id,
        transaction_id: e.transactionId,
        action: e.action,
        summary: e.summary,
        changes: e.changes,
        changed_at: e.changedAt,
      }))
    )
    if (error) {
      if (isSchemaError(error)) markUnavailable()
      // 通信エラー等はバッファを残して次の機会に再送する
      return
    }
    saveBuffer([])
    void pruneServerEntries()
  } catch {
    // ネットワーク例外 — バッファは残す
  }
}

/** 古い履歴をサーバー側から消す。1起動につき1回だけ試みる */
async function pruneServerEntries(): Promise<void> {
  if (prunedThisSession || tableMissing || !client) return
  prunedThisSession = true
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  try {
    await client.from('transaction_changes').delete().lt('changed_at', cutoff)
  } catch {
    // 消せなくても実害はない(次の起動でまた試みる)
  }
}

/**
 * 表示用に履歴を読む。まだ送れていない分(バッファ)も混ぜて新しい順に返す。
 * テーブルが無いときは空を返し、呼び出し側は導線ごと出さない。
 */
export async function fetchChangeLog(limit: number = MAX_ENTRIES): Promise<ChangeEntry[]> {
  const local = loadBuffer()
  if (tableMissing || !client) return pruneEntries(local, new Date()).slice(0, limit)
  try {
    const { data, error } = await client
      .from('transaction_changes')
      .select(SELECT_COLUMNS)
      .order('changed_at', { ascending: false })
      .limit(limit)
    if (error) {
      if (isSchemaError(error)) markUnavailable()
      return pruneEntries(local, new Date()).slice(0, limit)
    }
    const rows = ((data ?? []) as unknown as ChangeRow[]).map(fromRow)
    // バッファと重複しうるので id で寄せる
    const byId = new Map<string, ChangeEntry>()
    for (const e of [...rows, ...local]) byId.set(e.id, e)
    return pruneEntries([...byId.values()], new Date()).slice(0, limit)
  } catch {
    return pruneEntries(local, new Date()).slice(0, limit)
  }
}

/**
 * 起動時にテーブルの有無を1回だけ確かめ、貯まっている分を送る。
 * 通信できないときは判定を変えない(オフラインで機能が消えるほうが不便なため)。
 */
export async function initChangeLog(supabase: SupabaseClient): Promise<void> {
  attachChangeLogClient(supabase)
  try {
    const { error } = await supabase.from('transaction_changes').select('id').limit(1)
    if (error) {
      if (isSchemaError(error)) markUnavailable()
      return
    }
    if (tableMissing) {
      tableMissing = false
      notify()
    }
    await flushChangeLog()
  } catch {
    // ネットワーク例外等 — 判定は据え置き
  }
}

/** 記録用のエントリを組み立てる小道具(id と時刻の採番をここに閉じ込める) */
export function newEntry(
  transactionId: string,
  action: ChangeAction,
  summary: string,
  changes: FieldChange[]
): ChangeEntry {
  return {
    id: crypto.randomUUID(),
    transactionId,
    action,
    summary,
    changes,
    changedAt: new Date().toISOString(),
  }
}
