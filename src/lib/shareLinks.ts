// ============================================================
// 閲覧専用の共有リンクの発行・無効化 (機能179 / 利用者側)
//
// 保存先は Supabase の partner_share_links。
// テーブルが無い(マイグレーション未実行)ときは静かに無効化し、
// 既存の記録・入力・同期には一切触れない。
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { isSchemaError, toServerError } from './serverErrors'
import { formatGuidance, guidanceForServerError, isOnlineNow } from './errorGuidance'

export interface ShareLink {
  id: string
  token: string
  /** 有効期限。null なら無期限 */
  expiresAt: string | null
  /** 無効化した日時。null なら有効 */
  revokedAt: string | null
  /** 彼女が最後に開いた日時。null ならまだ一度も開かれていない */
  lastViewedAt: string | null
  createdAt: string
}

// ---------- 純粋関数 ----------

export type ShareLinkStatus = 'active' | 'revoked' | 'expired'

/** リンクの状態を判定する。(純粋関数。now は ISO 文字列) */
export function shareLinkStatus(link: ShareLink, now: string): ShareLinkStatus {
  if (link.revokedAt !== null) return 'revoked'
  if (link.expiresAt !== null && link.expiresAt <= now) return 'expired'
  return 'active'
}

/**
 * 一覧から「今つかえるリンク」を1本だけ選ぶ。(純粋関数)
 * 画面に出すのは常に1本にしたいので、有効なものの中で最も新しいものを採る。
 */
export function pickActiveLink(links: readonly ShareLink[], now: string): ShareLink | null {
  const active = links.filter((l) => shareLinkStatus(l, now) === 'active')
  if (active.length === 0) return null
  return active.reduce((a, b) => (b.createdAt > a.createdAt ? b : a))
}

/**
 * 「n日後に切れる」を ISO 文字列にする。(純粋関数)
 * days が null なら無期限(null を返す)。
 */
export function expiryFromDays(base: Date, days: number | null): string | null {
  if (days === null) return null
  const d = new Date(base.getTime())
  d.setDate(d.getDate() + days)
  return d.toISOString()
}

/** 期限の残り日数(切り上げ)。無期限なら null。(純粋関数) */
export function daysUntil(expiresAt: string | null, now: string): number | null {
  if (expiresAt === null) return null
  const diff = new Date(expiresAt).getTime() - new Date(now).getTime()
  return Math.ceil(diff / 86_400_000)
}

// ---------- Supabase 連携 ----------

interface ShareLinkRow {
  id: string
  token: string
  expires_at: string | null
  revoked_at: string | null
  last_viewed_at: string | null
  created_at: string
}

const SELECT_COLUMNS = 'id, token, expires_at, revoked_at, last_viewed_at, created_at'

function fromRow(r: ShareLinkRow): ShareLink {
  return {
    id: r.id,
    token: r.token,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    lastViewedAt: r.last_viewed_at,
    createdAt: r.created_at,
  }
}

/** テーブルが無いと分かったら true。以後この機能の導線を出さない */
let tableMissing = false

export function isShareUnavailable(): boolean {
  return tableMissing
}

/**
 * 自分の共有リンクを読み込む。
 * テーブルが無ければ null を返して静かに無効化する(呼び出し側は導線を隠すだけ)。
 * 通信エラー等も null(= 分からない)で返し、例外は投げない。
 */
export async function fetchShareLinks(supabase: SupabaseClient): Promise<ShareLink[] | null> {
  try {
    const { data, error } = await supabase
      .from('partner_share_links')
      .select(SELECT_COLUMNS)
      .order('created_at', { ascending: false })
    if (error) {
      if (isSchemaError(error)) tableMissing = true
      return null
    }
    tableMissing = false
    return ((data ?? []) as unknown as ShareLinkRow[]).map(fromRow)
  } catch {
    return null
  }
}

/**
 * 新しいリンクを発行する。トークンはサーバー側の既定値
 * (gen_random_bytes による48文字)で作られるので、クライアントは触らない。
 */
export async function createShareLink(
  supabase: SupabaseClient,
  expiresAt: string | null
): Promise<ShareLink> {
  const { data, error } = await supabase
    .from('partner_share_links')
    .insert({ expires_at: expiresAt })
    .select(SELECT_COLUMNS)
    .single()
  if (error) {
    if (isSchemaError(error)) tableMissing = true
    throw new Error(formatGuidance(guidanceForServerError(error, isOnlineNow())))
  }
  if (!data) {
    throw new Error('共有リンクを作成できませんでした。通信が不安定な可能性があります。もう一度お試しください')
  }
  return fromRow(data as unknown as ShareLinkRow)
}

/** リンクを無効化する。以後は閲覧もコメントの書き込みもできなくなる */
export async function revokeShareLink(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase
    .from('partner_share_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error(formatGuidance(guidanceForServerError(error, isOnlineNow())))
}

/**
 * 再発行する。古いリンクを必ず先に無効化してから新しいものを作る
 * (古いURLが生き残ると「無効化したつもり」の事故になるため)。
 */
export async function reissueShareLink(
  supabase: SupabaseClient,
  oldId: string | null,
  expiresAt: string | null
): Promise<ShareLink> {
  if (oldId) {
    try {
      await revokeShareLink(supabase, oldId)
    } catch (e) {
      // 無効化できないまま新しいリンクを作ると、古いURLが生きたままになる
      throw new Error(toServerError(e).message)
    }
  }
  return createShareLink(supabase, expiresAt)
}
