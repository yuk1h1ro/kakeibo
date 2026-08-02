import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const URL_KEY = 'kakeibo.supabaseUrl'
const ANON_KEY = 'kakeibo.supabaseAnonKey'

// 接続情報の優先順位: ビルド時の環境変数 → localStorage(初回セットアップ画面で保存)
function resolveConfig(): { url: string; anonKey: string } | null {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (envUrl && envKey) return { url: envUrl, anonKey: envKey }
  const lsUrl = localStorage.getItem(URL_KEY)
  const lsKey = localStorage.getItem(ANON_KEY)
  if (lsUrl && lsKey) return { url: lsUrl, anonKey: lsKey }
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

export function saveConfig(url: string, anonKey: string): void {
  localStorage.setItem(URL_KEY, url.trim())
  localStorage.setItem(ANON_KEY, anonKey.trim())
}

export function clearConfig(): void {
  localStorage.removeItem(URL_KEY)
  localStorage.removeItem(ANON_KEY)
  client = null
}
