// ============================================================
// Discord の Webhook URL を端末間で同期する
//
// ---- なぜ同期するのか(実際に起きた事故) ----
// Webhook URL はこれまで端末の localStorage にしかなかった。そのため
// 「PCでは設定したが、スマホではしていない」状態が起こり得て、
// **いちばん入力に使っているスマホからの記録だけが通知されない**という
// ことが実際に起きた。通知は彼女に残高の増減を知らせるための機能なので、
// そこが抜けると機能そのものの存在理由が失われる。
// そこで URL の正は Supabase の discord_settings(1ユーザー1行)に置き、
// localStorage はその**キャッシュ**にした。
//
// ---- ここで一番大事にしていること ----
// **通知が止まらないこと。** 同期の実装が原因で1通も飛ばなくなるのが
// いちばん悪い結果なので、次の3つを守っている:
//   1. 保存・解除は必ず「先に localStorage、後からサーバー」の順で行う。
//      サーバーへの書き込みに失敗しても、この端末からの通知は即座に効く。
//   2. サーバーの読み取りに失敗したときは、キャッシュを**絶対に消さない**。
//      オフラインや一時的な失敗で通知が止まってはいけない。
//   3. discord_settings テーブルが無い(マイグレーション未実行)ときは、
//      従来どおり localStorage だけで動く。機能は消えず、同期されないだけ。
//
// 構成は categories.ts / storeCategories.ts と同じ
// (Supabase + localStorage キャッシュ + useSyncExternalStore + スキーマエラー検知)。
// ============================================================

import { useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isSchemaError, toServerError } from './serverErrors'

// ---------- 純粋関数 ----------

/** Discord の Webhook URL の形をしているか。(純粋関数) */
export function isValidWebhookUrl(url: string): boolean {
  return (
    url.startsWith('https://discord.com/api/webhooks/') ||
    url.startsWith('https://discordapp.com/api/webhooks/')
  )
}

/**
 * 画面に出すときの伏字。(純粋関数)
 *
 * 先頭40文字だけ見せる。`https://discord.com/api/webhooks/` がちょうど33文字なので、
 * 見えるのはホストと Webhook ID の先頭7文字までで、**その次のスラッシュから始まる
 * トークン部分には決して届かない**(この40という数字はそのために選んである)。
 * 「どのチャンネルを設定したか」を確かめるには ID の頭だけで足りる。
 */
export function maskWebhookUrl(url: string): string {
  return url.length > 40 ? `${url.slice(0, 40)}…` : url
}

/** サーバー(discord_settings)側の状態。(純粋関数の入力) */
export type RemoteWebhook =
  /** 行が無い = まだどの端末も同期していない(この機能より前からの利用者) */
  | { kind: 'missing' }
  /** 行がある = どこかの端末が明示的に保存または解除した。url が null なら解除済み */
  | { kind: 'row'; url: string | null }

/** 初回同期で何をするか。(純粋関数の出力) */
export type WebhookSyncPlan =
  /** この端末に残っていた URL をサーバーへ引き上げる(利用者に再入力させない) */
  | { action: 'push'; url: string }
  /** サーバーの値をこの端末に写す(解除の反映もこれ) */
  | { action: 'adopt'; url: string | null }
  /** すでに一致している。何もしない */
  | { action: 'none' }

/**
 * 端末のキャッシュとサーバーの行から、初回同期の動きを決める。(純粋関数)
 *
 * ---- 食い違ったときの優先順位: **サーバーが勝つ** ----
 * サーバーに行があるということは、どこかの端末で人が明示的に「保存」か「解除」を
 * 押したということ。一方この端末のキャッシュは、同期が無かった頃に書かれたか、
 * 他の端末での変更をまだ知らないだけの古い写しでしかない。
 * 端末を勝たせると、
 *   - スマホの古い URL が、PCで直したばかりの新しい URL を上書きする
 *   - どこかで押した「解除」が、別の端末を開くたびに復活する
 * という壊れ方をする。サーバーを勝たせれば、どの端末から開いても必ず同じ値に
 * 収束する。
 *
 * 行が無いときだけ、この端末の値を引き上げる(既存端末の救済)。
 * 壊れた値を持ち上げないよう、形が違うものは引き上げない。
 */
export function planWebhookSync(local: string | null, remote: RemoteWebhook): WebhookSyncPlan {
  if (remote.kind === 'row') {
    if (remote.url === local) return { action: 'none' }
    return { action: 'adopt', url: remote.url }
  }
  if (local && isValidWebhookUrl(local)) return { action: 'push', url: local }
  return { action: 'none' }
}

// ---------- localStorage キャッシュ ----------

// キーは従来のまま。既存端末に入っている URL をそのまま引き継ぐため
// (ここを変えると、いま設定済みの端末が「未設定」に見えて通知が止まる)
const CACHE_KEY = 'kakeibo.discordWebhook'

function loadCache(): string | null {
  try {
    return localStorage.getItem(CACHE_KEY)
  } catch {
    return null
  }
}

function saveCache(url: string | null): void {
  try {
    if (url === null) localStorage.removeItem(CACHE_KEY)
    else localStorage.setItem(CACHE_KEY, url)
  } catch {
    // 保存できなくてもアプリは落とさない(この起動中は下のストアの値で動く)
  }
}

// ---------- モジュールレベルのストア ----------

/** 同期の状態。画面の文言を出し分けるために持つ */
export type WebhookSyncStatus =
  /** まだサーバーを確かめていない(起動直後・オフライン) */
  | 'unknown'
  /** サーバーと読み書きできている = 他の端末にも反映される */
  | 'synced'
  /** discord_settings が無い(マイグレーション未実行)= この端末だけ */
  | 'local'

export interface DiscordWebhookState {
  /** 設定済みの Webhook URL。null = 未設定または解除済み */
  url: string | null
  sync: WebhookSyncStatus
}

// discord_settings テーブルが無い(マイグレーション未実行)場合は true。
// 以後サーバーへは書きに行かず、従来どおり localStorage だけで動かす
let tableMissing = false
// 一度でもサーバーと読み書きできたか(できていれば他の端末にも反映されている)
let serverSeen = false

let url: string | null = loadCache()

function syncStatus(): WebhookSyncStatus {
  if (tableMissing) return 'local'
  return serverSeen ? 'synced' : 'unknown'
}

// useSyncExternalStore は参照が変わったかどうかで再描画を決めるので、
// 中身が同じときは同じオブジェクトを返し続ける必要がある
let snapshot: DiscordWebhookState = { url, sync: syncStatus() }

const listeners = new Set<() => void>()

function publish(): void {
  const next: DiscordWebhookState = { url, sync: syncStatus() }
  if (next.url === snapshot.url && next.sync === snapshot.sync) return
  snapshot = next
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): DiscordWebhookState {
  return snapshot
}

/**
 * いまの Webhook 設定。保存・解除・同期のたびに再描画される。
 *
 * 第3引数(サーバー用のスナップショット)にも同じ関数を渡している。
 * 渡していないと renderToStaticMarkup で描いた瞬間に例外になり、
 * このフックを使う彼女タブをテストから描けなくなるため(categories.ts と同じ)。
 */
export function useDiscordWebhook(): DiscordWebhookState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * 設定済みの Webhook URL(フックの外から参照する用)。
 * 通知の送信はこれを同期的に読む — 通知経路に await を挟まないための形。
 */
export function getWebhookUrl(): string | null {
  return url
}

/** テスト用にストアを初期状態へ戻す(モジュールをまたいで状態が漏れないように) */
export function resetDiscordWebhookForTest(): void {
  tableMissing = false
  serverSeen = false
  url = loadCache()
  snapshot = { url, sync: syncStatus() }
  for (const l of listeners) l()
}

// ---------- Supabase 連携 ----------

interface DiscordSettingsRow {
  webhook_url: string | null
}

/**
 * いまログインしている利用者のID。取れなければ null。
 * upsert の衝突判定に使う列 (user_id) を本文にも入れるために引く
 * (assets.ts の upsert と同じ形にそろえている)。
 * 取れなくても列の既定値 auth.uid() が入るので、insert 自体は成立する。
 */
async function currentUserId(supabase: SupabaseClient): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.user.id ?? null
  } catch {
    return null
  }
}

/**
 * サーバーへ書き込む(保存・解除で共通)。
 * 1ユーザー1行なので upsert。行が増えないことが RLS 以前の前提になっている。
 * 失敗しても throw しない — ここで例外を出すと、端末には保存できているのに
 * 画面が「保存できませんでした」に見え、利用者が解除して入れ直す方向に動く。
 */
async function writeRemote(supabase: SupabaseClient, next: string | null): Promise<boolean> {
  if (tableMissing) return false
  try {
    const userId = await currentUserId(supabase)
    const row: { webhook_url: string | null; updated_at: string; user_id?: string } = {
      webhook_url: next,
      updated_at: new Date().toISOString(),
    }
    if (userId) row.user_id = userId
    const { error } = await supabase
      .from('discord_settings')
      .upsert(row, { onConflict: 'user_id' })
    if (error) {
      if (isSchemaError(error)) tableMissing = true
      publish()
      return false
    }
    serverSeen = true
    publish()
    return true
  } catch (e) {
    if (isSchemaError(toServerError(e))) tableMissing = true
    publish()
    return false
  }
}

/**
 * 起動時に1回。サーバーの設定を読み、端末のキャッシュと突き合わせる。
 *
 * - サーバーに行がある → その値を採る(他の端末での保存・解除がここで反映される)
 * - 行が無く、この端末に URL がある → サーバーへ引き上げる
 *   (既存の利用者に再入力させないための救済。1回で済み、次からは行がある側に入る)
 * - テーブルが無い / 通信できない → **キャッシュには一切触らない**。
 *   従来どおりこの端末の URL で通知が飛び続ける
 */
export async function initDiscordWebhook(supabase: SupabaseClient): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('discord_settings')
      .select('webhook_url')
      .maybeSingle()
    if (error) {
      // マイグレーション未実行と分かったときだけ、画面にその旨を出せるようにする。
      // それ以外(オフライン等)は 'unknown' のままにして、次の起動で再試行する
      if (isSchemaError(error)) tableMissing = true
      publish()
      return
    }
    serverSeen = true
    const row = data as DiscordSettingsRow | null
    const plan = planWebhookSync(url, row ? { kind: 'row', url: row.webhook_url } : { kind: 'missing' })
    if (plan.action === 'adopt') {
      url = plan.url
      saveCache(plan.url)
      publish()
      return
    }
    publish()
    if (plan.action === 'push') await writeRemote(supabase, plan.url)
  } catch (e) {
    if (isSchemaError(toServerError(e))) tableMissing = true
    publish()
    // ネットワーク例外等 — キャッシュのまま継続(通知は止めない)
  }
}

/**
 * Webhook URL を保存する。
 * 先に端末へ、そのあとサーバーへ。順番を逆にすると、サーバーが不調なだけで
 * 「保存したのに通知が来ない」が起きる。
 */
export async function saveWebhookUrl(supabase: SupabaseClient, raw: string): Promise<void> {
  const next = raw.trim()
  url = next
  saveCache(next)
  publish()
  await writeRemote(supabase, next)
}

/**
 * 解除する。解除も他の端末に伝わらなければ意味がない(片方だけ鳴り続ける)ので、
 * 行は消さず null を保存する。詳しくは migration-discord-webhook.sql のコメント。
 */
export async function clearWebhookUrl(supabase: SupabaseClient): Promise<void> {
  url = null
  saveCache(null)
  publish()
  await writeRemote(supabase, null)
}
