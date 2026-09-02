// ============================================================
// 明細へのコメント (機能185)
//
// 利用者(owner)はアプリから普通のテーブル操作で読み書きする(RLS で本人のみ)。
// 彼女(partner)はアカウントを持たないので、共有ページから RPC 経由で書く
// (shareView.ts を参照)。このファイルは利用者側の永続化と、両者で使う
// 純粋関数(本文の検証・未読の集計)を持つ。
//
// XSS について: コメントは常に React のテキストノードとして描画する。
// dangerouslySetInnerHTML はこの機能のどこでも使わない。
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { createTableAvailability } from './tableAvailability'
import { formatGuidance, guidanceForServerError, isOnlineNow } from './errorGuidance'

/** コメント1件あたりの上限。データベース側の CHECK 制約と必ず同じ値にすること */
export const MAX_COMMENT_LENGTH = 300

export type CommentAuthor = 'owner' | 'partner'

export interface PartnerComment {
  id: string
  transactionId: string
  author: CommentAuthor
  body: string
  createdAt: string
  /** 利用者が読んだか(彼女の投稿だけが false で入る) */
  readByOwner: boolean
}

// ---------- 純粋関数 ----------

/**
 * 入力された本文を保存できる形に整える。(純粋関数)
 * - 前後の空白・改行を落とす
 * - 3行以上続く空行は2行までに畳む(縦に長い荒らしへの最低限の抑制)
 * - 制御文字は落とす
 */
export function normalizeCommentBody(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export type CommentValidation =
  | { ok: true; body: string }
  | { ok: false; reason: 'empty' | 'length'; message: string }

/** 送信前の検証。(純粋関数。サーバー側でも同じ条件で弾く) */
export function validateComment(raw: string): CommentValidation {
  const body = normalizeCommentBody(raw)
  if (body.length === 0) {
    return { ok: false, reason: 'empty', message: 'コメントを入力してください' }
  }
  if (body.length > MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      reason: 'length',
      message: `コメントは${MAX_COMMENT_LENGTH}文字までです`,
    }
  }
  return { ok: true, body }
}

/** 明細IDごとにコメントをまとめる(古い順)。(純粋関数) */
export function groupCommentsByTransaction(
  comments: readonly PartnerComment[]
): Record<string, PartnerComment[]> {
  const out: Record<string, PartnerComment[]> = {}
  for (const c of comments) {
    ;(out[c.transactionId] ??= []).push(c)
  }
  for (const key of Object.keys(out)) {
    out[key].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  return out
}

/** 利用者がまだ読んでいない彼女のコメント数。(純粋関数) */
export function unreadCommentCount(comments: readonly PartnerComment[]): number {
  return comments.filter((c) => c.author === 'partner' && !c.readByOwner).length
}

/** その明細に未読があるか。(純粋関数) */
export function hasUnread(comments: readonly PartnerComment[]): boolean {
  return unreadCommentCount(comments) > 0
}

// ---------- Supabase 連携(利用者側) ----------

interface CommentRow {
  id: string
  transaction_id: string
  author: string
  body: string
  created_at: string
  read_by_owner: boolean
}

const SELECT_COLUMNS = 'id, transaction_id, author, body, created_at, read_by_owner'

export function fromCommentRow(r: CommentRow): PartnerComment {
  return {
    id: r.id,
    transactionId: r.transaction_id,
    author: r.author === 'partner' ? 'partner' : 'owner',
    body: r.body,
    createdAt: r.created_at,
    readByOwner: r.read_by_owner,
  }
}

// テーブルが無いと分かったら「無い」。以後コメントの導線を出さない。
// 答えは localStorage に残るので、オフライン起動でも前回の答えが効く
// (見分け方は tableAvailability.ts)。
const availability = createTableAvailability('partner_share_comments')

// **この判定を「画面を出すかどうか」のガードに使わないこと。**
// 描画の手前で弾くと fetch まで届かず、答えを取り消す機会が永久に来ない
// (マイグレーションを実行しても機能が戻らなくなる)。導線を隠すのは、
// いまのように fetch の結果(null)を画面側の state で受けて判断すること。
export function isCommentsUnavailable(): boolean {
  return availability.isMissing()
}

/** テスト用に、モジュールに残る「テーブルが無い」判定を戻す */
export function resetPartnerCommentsForTest(): void {
  availability.resetForTest()
}

/**
 * 自分のコメントをすべて読み込む。
 * テーブルが無ければ null を返して静かに無効化する。例外は投げない。
 */
export async function fetchComments(supabase: SupabaseClient): Promise<PartnerComment[] | null> {
  try {
    const { data, error } = await supabase
      .from('partner_share_comments')
      .select(SELECT_COLUMNS)
      .order('created_at', { ascending: true })
    if (error) {
      availability.noteError(error)
      return null
    }
    availability.markPresent()
    return ((data ?? []) as unknown as CommentRow[]).map(fromCommentRow)
  } catch {
    return null
  }
}

/** 利用者がアプリからコメントを書く。自分の投稿なので既読で入れる */
export async function addOwnerComment(
  supabase: SupabaseClient,
  transactionId: string,
  raw: string
): Promise<PartnerComment> {
  const v = validateComment(raw)
  if (!v.ok) throw new Error(v.message)
  const { data, error } = await supabase
    .from('partner_share_comments')
    .insert({
      transaction_id: transactionId,
      author: 'owner',
      body: v.body,
      read_by_owner: true,
    })
    .select(SELECT_COLUMNS)
    .single()
  if (error) {
    availability.noteError(error)
    throw new Error(formatGuidance(guidanceForServerError(error, isOnlineNow())))
  }
  if (!data) {
    throw new Error('コメントを保存できませんでした。通信が不安定な可能性があります。もう一度お試しください')
  }
  return fromCommentRow(data as unknown as CommentRow)
}

/** その明細の彼女のコメントを既読にする(未読バッジを消すため) */
export async function markTransactionRead(
  supabase: SupabaseClient,
  transactionId: string
): Promise<void> {
  try {
    await supabase
      .from('partner_share_comments')
      .update({ read_by_owner: true })
      .eq('transaction_id', transactionId)
      .eq('read_by_owner', false)
  } catch {
    // 既読にできなくても表示は続ける(次に開いたときに再試行される)
  }
}

/** 利用者が自分のコメントを消す(誤爆の取り消し用) */
export async function deleteOwnComment(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('partner_share_comments').delete().eq('id', id)
  if (error) throw new Error(formatGuidance(guidanceForServerError(error, isOnlineNow())))
}
