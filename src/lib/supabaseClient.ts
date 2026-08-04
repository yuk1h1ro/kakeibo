import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { cleanupAfterSignOut, clearLocalData, clearSupabaseSession } from './localData'

const URL_KEY = 'kakeibo.supabaseUrl'
const ANON_KEY = 'kakeibo.supabaseAnonKey'

/**
 * Project URL を正規化する。
 * 末尾スラッシュや `/auth/v1/callback` のようなパスを取り除き、オリジンだけを返す。
 * (パスが残っていると supabase-js が不正なURLを組み立ててしまうため)
 * パースできない入力は trim しただけの文字列をそのまま返す。
 */
export function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '')
  try {
    return new URL(trimmed).origin
  } catch {
    return trimmed
  }
}

// 接続情報の優先順位: ビルド時の環境変数 → localStorage(初回セットアップ画面で保存)
function resolveConfig(): { url: string; anonKey: string } | null {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (envUrl && envKey) return { url: normalizeUrl(envUrl), anonKey: envKey }
  const lsUrl = localStorage.getItem(URL_KEY)
  const lsKey = localStorage.getItem(ANON_KEY)
  // 過去に保存された不正な値(パス付きURL等)もここで救済する
  if (lsUrl && lsKey) return { url: normalizeUrl(lsUrl), anonKey: lsKey }
  return null
}

/**
 * 接続情報(URL と anon キー)を返す。未設定なら null。
 * 共有ページ (機能179) は「ログインしない別のクライアント」を作る必要があるため、
 * 接続情報だけをここから取り出せるようにしている。
 */
export function getSupabaseConfig(): { url: string; anonKey: string } | null {
  return resolveConfig()
}

/**
 * 接続情報がビルド時の環境変数から来ているか。
 * 共有リンクは彼女の端末(localStorage が空)で開かれるので、
 * ビルド時に埋め込まれていないとリンクが機能しない。その注意書きの判定に使う。
 */
export function hasBuildTimeConfig(): boolean {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  return Boolean(envUrl && envKey)
}

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (client) return client
  const config = resolveConfig()
  if (!config) return null
  client = createClient(config.url, config.anonKey)
  // ログアウトの後始末はここに1つだけ置く。ログアウトのボタンが増えても
  // 「セッションだけ消えて端末内のデータと鍵が残る」状態を作らないため。
  // (未同期が残っているときは何も消さずに知らせるだけ — localData.ts)
  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') cleanupAfterSignOut()
  })
  return client
}

export function isConfigured(): boolean {
  return resolveConfig() !== null
}

// 現在の接続先URL(正規化済み)。未設定なら null。表示用。
export function getConfiguredUrl(): string | null {
  return resolveConfig()?.url ?? null
}

// この端末の localStorage に接続情報が保存されているか(リセット可能かの判定用)
export function hasStoredConfig(): boolean {
  return localStorage.getItem(URL_KEY) !== null || localStorage.getItem(ANON_KEY) !== null
}

export function saveConfig(url: string, anonKey: string): void {
  localStorage.setItem(URL_KEY, normalizeUrl(url))
  localStorage.setItem(ANON_KEY, anonKey.trim())
}

/**
 * 接続設定をやり直す (AuthScreen の導線)。
 *
 * URL と anon キーだけを消すと、前の接続先のログイン状態(Supabase の
 * セッション鍵)と、前の接続先から取り込んだ明細のキャッシュが端末に残る。
 * 「別のプロジェクトに繋ぎ直す」ためのボタンなので、端末内は全部片付ける
 * (サーバー上の記録は1件も消えない)。
 */
export function clearConfig(): void {
  clearLocalData([])
  clearSupabaseSession()
  client = null
}
