import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (client) return client
  const config = resolveConfig()
  if (!config) return null
  client = createClient(config.url, config.anonKey)
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

export function clearConfig(): void {
  localStorage.removeItem(URL_KEY)
  localStorage.removeItem(ANON_KEY)
  client = null
}
