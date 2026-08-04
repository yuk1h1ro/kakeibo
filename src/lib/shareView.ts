// ============================================================
// 共有ページ側のデータ取得 (機能179 / 185)
//
// 彼女はアカウントを持たないので、ここでは **ログインしない専用のクライアント** を
// 作って RPC だけを呼ぶ。
//   - persistSession: false → アプリ本体のログイン状態を一切書き換えない
//   - detectSessionInUrl: false → URL のハッシュを認証情報と誤認しない
//     (共有URLのハッシュにはトークンが載っているので、これは必須)
//   - autoRefreshToken: false → セッションが無いので更新も不要
//
// 読めるのは partner_share_view / partner_share_add_comment の2つの関数だけで、
// transactions テーブルには anon の権限を与えていない (migration-partner-share.sql)。
// ============================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseConfig } from './supabaseClient'
import type { CommentAuthor } from './partnerComments'

export interface ShareDeposit {
  id: string
  date: string
  amount: number
}

export interface ShareCharge {
  id: string
  date: string
  store: string
  /** 彼女の負担額。支払い総額は共有ページには一切出さない */
  amount: number
  category: string | null
  /** サーバー側で解決した表示名。カテゴリ設定が未登録なら null */
  categoryLabel: string | null
}

export interface ShareComment {
  id: string
  transactionId: string
  author: CommentAuthor
  body: string
  createdAt: string
}

export interface ShareSnapshot {
  balance: number
  deposits: ShareDeposit[]
  charges: ShareCharge[]
  comments: ShareComment[]
  expiresAt: string | null
  maxCommentLength: number
}

/**
 * 共有ページの結果。
 * リンクが無効(存在しない・無効化済み・期限切れ)のときは理由を区別せず
 * 'invalid' にする。情報を漏らさないため。
 */
export type ShareResult =
  | { kind: 'ok'; data: ShareSnapshot }
  | { kind: 'invalid' }
  | { kind: 'unconfigured' }
  | { kind: 'error' }

let shareClient: SupabaseClient | null = null

function getShareClient(): SupabaseClient | null {
  if (shareClient) return shareClient
  const config = getSupabaseConfig()
  if (!config) return null
  shareClient = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  return shareClient
}

// ---------- 受け取った JSON の整形(純粋関数) ----------

type Json = Record<string, unknown>

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function asArray(v: unknown): Json[] {
  return Array.isArray(v) ? (v.filter((x) => typeof x === 'object' && x !== null) as Json[]) : []
}

/** RPC の戻り値(jsonb)を画面で使う形に整える。(純粋関数) */
export function parseShareSnapshot(raw: unknown): ShareSnapshot | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Json
  if (o.ok !== true) return null
  return {
    balance: asNumber(o.balance),
    deposits: asArray(o.deposits).map((d) => ({
      id: asString(d.id),
      date: asString(d.date),
      amount: asNumber(d.amount),
    })),
    charges: asArray(o.charges).map((c) => ({
      id: asString(c.id),
      date: asString(c.date),
      store: asString(c.store),
      amount: asNumber(c.amount),
      category: typeof c.category === 'string' ? c.category : null,
      categoryLabel: typeof c.category_label === 'string' ? c.category_label : null,
    })),
    comments: asArray(o.comments).map(parseComment),
    expiresAt: typeof o.expires_at === 'string' ? o.expires_at : null,
    maxCommentLength: asNumber(o.max_comment_length) || 300,
  }
}

/** コメント1件を整形する。(純粋関数) */
export function parseComment(c: Json): ShareComment {
  return {
    id: asString(c.id),
    transactionId: asString(c.transaction_id),
    author: c.author === 'partner' ? 'partner' : 'owner',
    body: asString(c.body),
    createdAt: asString(c.created_at),
  }
}

// ---------- RPC ----------

/** 共有ページの内容を取得する。例外は投げない */
export async function fetchShareSnapshot(token: string): Promise<ShareResult> {
  const client = getShareClient()
  if (!client) return { kind: 'unconfigured' }
  try {
    const { data, error } = await client.rpc('partner_share_view', { p_token: token })
    if (error) return { kind: 'error' }
    const snapshot = parseShareSnapshot(data)
    if (!snapshot) return { kind: 'invalid' }
    return { kind: 'ok', data: snapshot }
  } catch {
    return { kind: 'error' }
  }
}

export type PostCommentResult =
  | { kind: 'ok'; comment: ShareComment }
  | { kind: 'invalid' } // リンクが無効・期限切れ・見えない明細
  | { kind: 'rate' } // 連投しすぎ
  | { kind: 'length' } // 長すぎる / 空
  | { kind: 'error' } // 通信エラーなど

/** 彼女が共有ページからコメントを書く。例外は投げない */
export async function postShareComment(
  token: string,
  transactionId: string,
  body: string
): Promise<PostCommentResult> {
  const client = getShareClient()
  if (!client) return { kind: 'error' }
  try {
    const { data, error } = await client.rpc('partner_share_add_comment', {
      p_token: token,
      p_transaction_id: transactionId,
      p_body: body,
    })
    if (error) return { kind: 'error' }
    if (typeof data !== 'object' || data === null) return { kind: 'error' }
    const o = data as Json
    if (o.ok === true && typeof o.comment === 'object' && o.comment !== null) {
      return { kind: 'ok', comment: parseComment(o.comment as Json) }
    }
    const reason = asString(o.reason)
    if (reason === 'rate' || reason === 'rate_day') return { kind: 'rate' }
    if (reason === 'length' || reason === 'empty') return { kind: 'length' }
    return { kind: 'invalid' }
  } catch {
    return { kind: 'error' }
  }
}
