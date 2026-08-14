// ============================================================
// 後から足した transactions の列が、この環境にあるかどうか (実行時判定)
//
//   settlement … partner_paid 列 + 新しい種別(partner_refund / partner_adjust)
//                → supabase/migration-partner-ledger.sql
//   tagging    … tags 列 + split_group 列
//                → supabase/migration-tags-splits.sql
//   favor      … favor_amount / favor_kind / favor_from 列(おごり・値引き)
//                → supabase/migration-favor.sql
//                この SQL は amount > 0 の制約もゆるめる(全額おごりの 0円 を
//                保存するため)ので、列が無い環境では 0円 で保存させないこと。
//                導線を出すかどうかの判断は、その一点でも効いている。
//
// 過去に「マイグレーション未実行が原因で入力が失われた」事故があるので、
// ここは二重に守る:
//   1. 起動時に列の有無を確かめ、無ければその機能の導線を出さない(作らせない)
//   2. それでも送ってしまったときは、送信直前にキーを落とす / op をキューに残す
//
// 判定結果は localStorage にも残す。オフライン起動でも前回の答えを使えるので、
// 「圏外でうっかり新機能を使い、あとでサーバーに弾かれる」窓が狭くなる。
// (感情スタンプ satisfaction.ts と同じ考え方を、2つの機能群に広げたもの)
// ============================================================

import { useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isSchemaError, type ServerErrorLike } from './serverErrors'
import { isPartnerLedgerType, type TransactionType } from './types'

export type TxFeature = 'settlement' | 'tagging' | 'favor'

const STORAGE_KEY = 'kakeibo.txExtensions'

// 既定は「使える」。初回は必ず起動直後の probe が答えを上書きするし、
// 使えないと決めつけると、通信できないときに機能が消えてしまうため。
const state: Record<TxFeature, boolean> = { settlement: true, tagging: true, favor: true }

function loadCache(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return
    const o = parsed as Partial<Record<TxFeature, unknown>>
    if (typeof o.settlement === 'boolean') state.settlement = o.settlement
    if (typeof o.tagging === 'boolean') state.tagging = o.tagging
    if (typeof o.favor === 'boolean') state.favor = o.favor
  } catch {
    // 壊れたキャッシュは無視(既定に戻るだけ)
  }
}

loadCache()

const listeners = new Set<() => void>()
// useSyncExternalStore に渡すスナップショットは参照を安定させる
let snapshot: Record<TxFeature, boolean> = { ...state }

function commit(): void {
  snapshot = { ...state }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 保存できなくても、この起動中は正しく動く
  }
  for (const l of listeners) l()
}

function setAvailable(feature: TxFeature, available: boolean): void {
  if (state[feature] === available) return
  state[feature] = available
  commit()
}

/** 同期時に列が無いと分かったときに呼ぶ。以後その機能は送らない・出さない */
export function markTxFeatureUnavailable(feature: TxFeature): void {
  setAvailable(feature, false)
}

export function isTxFeatureAvailable(feature: TxFeature): boolean {
  return state[feature]
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): Record<TxFeature, boolean> {
  return snapshot
}

/** 導線を出してよいか。列が無いと分かった時点で消える */
export function useTxFeature(feature: TxFeature): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)[feature]
}

// ---------- 起動時の確認 ----------

async function probe(
  supabase: SupabaseClient,
  feature: TxFeature,
  columns: string
): Promise<void> {
  try {
    const { error } = await supabase.from('transactions').select(columns).limit(1)
    if (error) {
      if (isSchemaError(error)) setAvailable(feature, false)
      return
    }
    setAvailable(feature, true)
  } catch {
    // ネットワーク例外等 — 判定は据え置き(前回の答えを使う)
  }
}

/** 起動時に1回だけ、後から足した列の有無を確かめる */
export async function initTxExtensions(supabase: SupabaseClient): Promise<void> {
  await Promise.all([
    probe(supabase, 'settlement', 'partner_paid'),
    probe(supabase, 'tagging', 'tags, split_group'),
    probe(supabase, 'favor', 'favor_amount, favor_kind, favor_from'),
  ])
}

// ---------- 送信直前の間引き ----------

interface ExtendedPayload {
  type?: TransactionType
  partner_paid?: number | null
  tags?: string[] | null
  split_group?: string | null
  favor_amount?: number | null
  favor_kind?: string | null
  favor_from?: string | null
}

/**
 * この環境に無い列をキーごと落とす。(純粋関数)
 * undefined を入れるのではなく削除する — 列が無いDBでは、キーが存在するだけで
 * PostgREST が弾いてしまうため(satisfaction.ts と同じ理由)。
 *
 * 落としても記録そのものは残る:
 *   partner_paid が落ちれば「自分が全額払った」扱い、
 *   split_group が落ちれば分割の束ねだけが消えて金額とカテゴリは正しいまま、
 *   tags が落ちればタグだけが付かない。
 *   favor_* が落ちれば「誰にご馳走になったか」だけが付かない
 *   (この場合、そもそも画面がおごりの導線を出さないので値は入っていない。
 *    列が無いと分かる前に入力してしまった1件のための保険)。
 */
export function stripUnavailableColumns<T extends ExtendedPayload>(payload: T): Partial<T> {
  const out: Partial<T> = { ...payload }
  if (!state.settlement) delete out.partner_paid
  if (!state.tagging) {
    delete out.tags
    delete out.split_group
  }
  if (!state.favor) {
    delete out.favor_amount
    delete out.favor_kind
    delete out.favor_from
  }
  return out
}

/**
 * 「新しい種別を保存しようとして、DB のチェック制約に弾かれた」か。(純粋関数)
 *
 * migration 未実行のまま partner_refund / partner_adjust を書き込むと、
 * 列不足(スキーマエラー)ではなく **制約違反 23514** で返ってくる。
 * これを普通の永続的な拒否として扱うと op が捨てられ、記録が消えてしまうので、
 * ここで見分けて「マイグレーションを実行すれば通る失敗」に分類する。
 */
export function isLedgerTypeRejection(
  err: ServerErrorLike,
  type: TransactionType | undefined
): boolean {
  if (type === undefined || type === 'expense' || type === 'partner_deposit') return false
  if (!isPartnerLedgerType(type)) return false
  if (err.code === '23514') return true
  return /violates check constraint|check constraint/i.test(err.message)
}

/**
 * 「支払い 0円 の記録が、金額の制約に弾かれた」か。(純粋関数)
 *
 * 全額おごり・割引券で無料の回は amount が 0 になる。これを通すのは
 * migration-favor.sql が付け直す transactions_amount_check だけなので、
 * 未実行(または後から migration-partner-ledger.sql を実行し直して上書きされた)
 * サーバーでは 23514 で返ってくる。
 *
 * 制約名だけでは「調整のマイナス金額」と区別が付かない — どちらも
 * transactions_amount_check。**保存しようとした中身を知っているのはここだけ** なので、
 * 支出で金額が 0 のときに限って、この形だと判断する。
 * 見分けを誤って普通の拒否として扱うと op が捨てられ、記録が消える。
 */
export function isFavorAmountRejection(
  err: ServerErrorLike,
  payload: { type?: TransactionType; amount?: number } | undefined
): boolean {
  if (!payload) return false
  if (payload.type !== undefined && payload.type !== 'expense') return false
  if (payload.amount !== 0) return false
  if (err.code === '23514') return true
  return /violates check constraint|check constraint/i.test(err.message)
}
