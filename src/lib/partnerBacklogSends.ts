// ============================================================
// 履歴のまとめ送信 — 「どこまで送ったか」の記録と、逐次送信
//
// 組み立て(純粋関数)は partnerBacklog.ts。ここは
//   1. カーソル(前回どこまで送ったか)の読み書き
//   2. 1通ずつ間隔を空けて送り、送れたぶんだけカーソルを進める
// の2つだけを持つ。
//
// ---- カーソルの置き場所を Supabase にした理由 ----
// この機能が要るのは「Webhook URL が端末の中にしか無く、スマホからの記録が
// 通知されていなかった」からだった。同じ轍を踏まないよう、**どこまで送ったか**も
// 端末に閉じ込めない。PCで追いつかせたのにスマホで全部送り直す、が起きると、
// 彼女の通知欄が同じ履歴で二度埋まる。
// localStorage には**控え**だけを置き、食い違ったときは常に「進んでいる方」を採る
// (カーソルは絶対に戻さない。戻ると送信済みの分をもう一度送ることになる)。
//
// ---- 月末サマリー (monthlySummary.ts) と作法を変えた点 ----
// あちらは「先に印を書き、成功したときだけ送る」= 二重送信の回避を最優先にしている。
// 自動で毎月飛ぶ通知なので、間違って2通行く方が困るため。
// こちらは**人が押して、件数と通数を確認してから送る**もので、しかも
// 「彼女が知らない増減を届ける」ことが目的なので、送信漏れの方が重い。
// そこで **送れた通のぶんだけ、送った後にカーソルを進める**。
// 二度押しは、送信中のボタン無効化・押す前の確認・次回の既定が「前回の続き」に
// なることの3つで防ぐ(画面側)。
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { isSchemaError, toServerError } from './serverErrors'
import {
  BACKLOG_SEND_INTERVAL_MS,
  backlogRetryDelay,
  entryCursor,
  newerCursor,
  type BacklogCursor,
  type BacklogMessage,
} from './partnerBacklog'
import {
  sendDiscordMessageWithResult,
  type DiscordFailure,
  type DiscordSendResult,
} from './discordNotify'

const TABLE = 'partner_backlog_sends'
const CACHE_KEY = 'kakeibo.partnerBacklogCursor'

export interface BacklogSendState {
  /** 前回どこまで送ったか。null = まだ一度も送っていない */
  cursor: BacklogCursor | null
  /** 最後に送った日時 (ISO)。表示用 */
  lastSentAt: string | null
  /** これまでに送った明細の累計件数(表示用) */
  sentEntries: number
  /** これまでに送ったメッセージの累計通数(表示用) */
  sentMessages: number
}

export const EMPTY_BACKLOG_STATE: BacklogSendState = {
  cursor: null,
  lastSentAt: null,
  sentEntries: 0,
  sentMessages: 0,
}

// テーブルが無い(マイグレーション未実行)場合は true。
// 以後サーバーへは行かず、端末の控えだけで動く(機能は消えず、端末をまたげないだけ)
let tableMissing = false

export function isBacklogSyncUnavailable(): boolean {
  return tableMissing
}

/** テスト用に、モジュールに残る「テーブルが無い」判定を戻す */
export function resetBacklogSendsForTest(): void {
  tableMissing = false
}

// ---------- 端末の控え ----------

/** 控えの JSON を読む。壊れていれば「まだ送っていない」に倒す(送り直しの方が安全) */
export function loadCachedBacklogState(): BacklogSendState {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return EMPTY_BACKLOG_STATE
    return parseBacklogState(JSON.parse(raw))
  } catch {
    return EMPTY_BACKLOG_STATE
  }
}

function saveCachedBacklogState(state: BacklogSendState): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state))
  } catch {
    // 控えが書けなくても送信は成立している(サーバー側に残る)
  }
}

/** 未知の形を安全に読む。(純粋関数) */
export function parseBacklogState(value: unknown): BacklogSendState {
  if (value === null || typeof value !== 'object') return EMPTY_BACKLOG_STATE
  const o = value as Record<string, unknown>
  const c = o.cursor
  let cursor: BacklogCursor | null = null
  if (c !== null && typeof c === 'object') {
    const cc = c as Record<string, unknown>
    if (
      typeof cc.date === 'string' &&
      typeof cc.createdAt === 'string' &&
      typeof cc.id === 'string'
    ) {
      cursor = { date: cc.date, createdAt: cc.createdAt, id: cc.id }
    }
  }
  return {
    cursor,
    lastSentAt: typeof o.lastSentAt === 'string' ? o.lastSentAt : null,
    sentEntries: typeof o.sentEntries === 'number' ? o.sentEntries : 0,
    sentMessages: typeof o.sentMessages === 'number' ? o.sentMessages : 0,
  }
}

/**
 * サーバーと端末の記録を突き合わせる。(純粋関数)
 * カーソルは進んでいる方、累計は大きい方を採る。**戻さない**のがこの関数の役目。
 */
export function mergeBacklogState(
  remote: BacklogSendState | null,
  local: BacklogSendState
): BacklogSendState {
  if (!remote) return local
  const cursor = newerCursor(remote.cursor, local.cursor)
  const lastSentAt =
    (remote.lastSentAt ?? '') >= (local.lastSentAt ?? '') ? remote.lastSentAt : local.lastSentAt
  return {
    cursor,
    lastSentAt,
    sentEntries: Math.max(remote.sentEntries, local.sentEntries),
    sentMessages: Math.max(remote.sentMessages, local.sentMessages),
  }
}

// ---------- Supabase ----------

interface BacklogRow {
  last_date: string | null
  last_created_at: string | null
  last_tx_id: string | null
  sent_entries: number | null
  sent_messages: number | null
  last_sent_at: string | null
}

/** 行 → 状態。(純粋関数) */
export function rowToBacklogState(row: BacklogRow | null): BacklogSendState | null {
  if (!row) return null
  const cursor =
    row.last_date && row.last_created_at && row.last_tx_id
      ? { date: row.last_date, createdAt: row.last_created_at, id: row.last_tx_id }
      : null
  return {
    cursor,
    lastSentAt: row.last_sent_at ?? null,
    sentEntries: row.sent_entries ?? 0,
    sentMessages: row.sent_messages ?? 0,
  }
}

/**
 * 「前回どこまで送ったか」を読む。
 * テーブルが無い・通信できないときも、端末の控えだけで必ず何かを返す
 * (ここで例外が漏れると、Discord カードの導線ごと開けなくなる)。
 */
export async function fetchBacklogState(supabase: SupabaseClient): Promise<BacklogSendState> {
  const local = loadCachedBacklogState()
  if (tableMissing) return local
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('last_date,last_created_at,last_tx_id,sent_entries,sent_messages,last_sent_at')
      .maybeSingle()
    if (error) {
      if (isSchemaError(error)) tableMissing = true
      return local
    }
    const merged = mergeBacklogState(rowToBacklogState(data as BacklogRow | null), local)
    saveCachedBacklogState(merged)
    return merged
  } catch (e) {
    if (isSchemaError(toServerError(e))) tableMissing = true
    return local
  }
}

/**
 * 「ここまで送った」を残す。端末の控えを先に、そのあとサーバーへ。
 * サーバーが不調でも、少なくともこの端末では続きから送れる。
 */
export async function saveBacklogState(
  supabase: SupabaseClient,
  state: BacklogSendState
): Promise<void> {
  saveCachedBacklogState(state)
  if (tableMissing) return
  try {
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user.id ?? null
    const row: Record<string, unknown> = {
      last_date: state.cursor?.date ?? null,
      last_created_at: state.cursor?.createdAt ?? null,
      last_tx_id: state.cursor?.id ?? null,
      sent_entries: state.sentEntries,
      sent_messages: state.sentMessages,
      last_sent_at: state.lastSentAt,
      updated_at: new Date().toISOString(),
    }
    // 1ユーザー1行。衝突判定に使う列を本文にも入れる(discordWebhook.ts と同じ形)
    if (userId) row.user_id = userId
    const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'user_id' })
    if (error && isSchemaError(error)) tableMissing = true
  } catch (e) {
    if (isSchemaError(toServerError(e))) tableMissing = true
    // 送信そのものは成立している。記録できなかっただけなので黙って進む
  }
}

// ---------- 逐次送信 ----------

export interface BacklogRunOptions {
  /** 1通送るたびに呼ばれる(画面の「送信中… 3/10通」用) */
  onProgress?: (sent: number, total: number) => void
  /** 差し替え可能な送信口(テスト用)。既定は Discord への実送信 */
  send?: (text: string) => Promise<DiscordSendResult>
  /** 差し替え可能な待ち(テスト用) */
  sleep?: (ms: number) => Promise<void>
  /** 1通ごとの間隔 */
  intervalMs?: number
}

export interface BacklogRunResult {
  sentMessages: number
  totalMessages: number
  /** 送り終えた明細の件数 */
  sentEntries: number
  /** null なら最後まで送れた */
  failure: DiscordFailure | null
  /** 送ったあとのカーソル(失敗しても、送れたところまで進む) */
  state: BacklogSendState
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export interface SequentialSendOptions extends BacklogRunOptions {
  /**
   * 1通送れるたびに呼ばれる(await される)。
   * 「どこまで送ったか」を残す仕事はここに渡す — 送信そのものの手順
   * (間隔・再試行・止めどころ)と、何を覚えるかを分けておくため。
   */
  onSent?: (index: number, sent: number) => void | Promise<void>
}

/**
 * 用意した文面を1通ずつ Discord へ送る。
 *
 * ・**逐次**送る。まとめて Promise.all に流すと Discord のレート制限に当たり、
 *   429 が返って途中の通だけが落ちる(いちばん気付きにくい壊れ方)。
 * ・失敗したら**そこで止める**。以降の通を送ると、届いた分と届かない分が
 *   飛び飛びになり、彼女の画面で履歴が虫食いになる。
 * ・止まった位置(sentMessages)を返すので、呼び出し側は「残りだけ送り直す」ができる。
 *
 * 履歴のまとめ送信(runBacklogSend)と旅行1回ぶんのまとめ(TripSummarySheet)が
 * 共有する。2,000文字での分割・間隔・再試行・途中失敗からの再開を
 * 二度実装しないための切り出し。
 */
export async function sendMessagesInSequence(
  messages: readonly { text: string }[],
  options: SequentialSendOptions = {}
): Promise<{ sentMessages: number; failure: DiscordFailure | null }> {
  const send = options.send ?? sendDiscordMessageWithResult
  const sleep = options.sleep ?? defaultSleep
  const interval = options.intervalMs ?? BACKLOG_SEND_INTERVAL_MS

  let sentMessages = 0
  for (let i = 0; i < messages.length; i++) {
    // 1通目の前には待たない(押してすぐ1通目が飛ぶ方が、動いている感じが伝わる)
    if (i > 0) await sleep(interval)

    let result = await send(messages[i].text)
    let attempt = 1
    while (!result.ok) {
      const delay = backlogRetryDelay(result.failure, attempt)
      if (delay === null) break
      await sleep(delay)
      result = await send(messages[i].text)
      attempt += 1
    }
    if (!result.ok) return { sentMessages, failure: result.failure }

    sentMessages += 1
    // 送れた分は必ず残してから次へ進む(ここで画面を閉じられても続きから再開できる)
    await options.onSent?.(i, sentMessages)
    options.onProgress?.(sentMessages, messages.length)
  }
  return { sentMessages, failure: null }
}

/**
 * まとめ送信を実行する。
 *
 * ・**逐次**送る。まとめて Promise.all に流すと Discord のレート制限に当たり、
 *   429 が返って途中の通だけが落ちる(いちばん気付きにくい壊れ方)。
 * ・1通送るごとにカーソルを保存する。3通目で失敗しても2通目までは残るので、
 *   「前回の続き」でそのまま再開できる。
 * ・失敗したら**そこで止める**。以降の通を送ると、届いた分と届かない分が
 *   飛び飛びになり、彼女の画面で履歴が虫食いになる。
 */
export async function runBacklogSend(
  supabase: SupabaseClient,
  messages: readonly BacklogMessage[],
  previous: BacklogSendState,
  options: BacklogRunOptions = {}
): Promise<BacklogRunResult> {
  let state = previous
  let sentEntries = 0

  const outcome = await sendMessagesInSequence(messages, {
    ...options,
    onSent: async (i, sent) => {
      const last = messages[i].lastEntry
      sentEntries = messages[i].entriesThrough
      state = {
        // カーソルは進んでいる方だけを採る(古い期間を指定して送り直しても巻き戻さない)
        cursor: last ? newerCursor(state.cursor, entryCursor(last)) : state.cursor,
        lastSentAt: new Date().toISOString(),
        // 累計は「前回まで + この回で送れたぶん」。この回の途中経過から作るので、
        // 失敗して抜けたときも、送れた分だけが足された状態で残る
        sentEntries: previous.sentEntries + sentEntries,
        sentMessages: previous.sentMessages + sent,
      }
      await saveBacklogState(supabase, state)
    },
  })

  return {
    sentMessages: outcome.sentMessages,
    totalMessages: messages.length,
    sentEntries,
    failure: outcome.failure,
    state,
  }
}
