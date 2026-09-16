import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  cleanupAfterSignOut,
  markSignOutRequested,
  takeSignOutRequest,
  clearLocalData,
  clearSupabaseSession,
  signOutIntentText,
  unsyncedCount,
} from './localData'
import {
  createRefresher,
  createSelfHealingFetch,
  startSessionKeepAlive,
  type SessionRefresher,
} from './authSession'

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

  // 期限切れを利用者の問題にしない (authSession.ts)。
  //
  // fetch を包むのはクライアントを作るときだが、更新を頼む相手は
  // その「作ったあとのクライアント」しかいない。先に入れ物だけ置いて、
  // 実際に呼ばれるとき(= 最初の 401 のとき)に中身を見る。
  let refresher: SessionRefresher | null = null
  const lazyRefresher: SessionRefresher = {
    refreshSession: () =>
      refresher ? refresher.refreshSession() : Promise.resolve({ accessToken: null }),
  }

  client = createClient(config.url, config.anonKey, {
    auth: {
      // 既定と同じ値だが、**この3つが期限切れの体験を決める**ので明示する。
      // 端末にセッションを残し、裏で更新し、ログイン後の戻り先URLから拾う。
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    global: {
      // すり抜けた期限切れ (JWT expired) は、ここで黙って直して送り直す
      fetch: createSelfHealingFetch(lazyRefresher),
    },
  })
  refresher = createRefresher(client)

  // ログアウトの後始末はここに1つだけ置く。ログアウトのボタンが増えても
  // 「セッションだけ消えて端末内のデータと鍵が残る」状態を作らないため。
  // (未同期が残っているときは何も消さずに知らせるだけ — localData.ts)
  //
  // ただし SIGNED_OUT は、更新トークンごと失効したときにも飛ぶ。
  // 意図を立てたときだけ後始末する(そうしないと、何もしていないのに
  // 消去の確認が出る)
  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && takeSignOutRequest()) cleanupAfterSignOut()
  })

  // ホーム画面から戻ってきた・圏外から復帰した、といった「止まっていた
  // 時間の終わり」で先回りして更新する。1発目のエラーごと無くすため
  startSessionKeepAlive(client, refresher)
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

/**
 * 利用者が押したログアウト。**確認は二段。**
 *
 *   1段目(ここ)  … 「ログアウトしますか?」
 *   2段目(後始末)… 「端末に残っているデータも消しますか?」
 *
 * 1段目が無かったころは、ヘッダーの小さなボタンに指が触れた瞬間に
 * ログアウトが済み、次に出るのがいきなり消去の可否だった。
 * **押すつもりが無かった人に消去を聞く** 並びになっていて、続けて OK を
 * 押せば端末内が初期化される。段を分けて、まず「押したかどうか」を確かめる。
 *
 * ここを通ったときだけ端末内の後始末をする。素の signOut() を直に呼ぶと
 * 期限切れによる SIGNED_OUT と区別が付かず、何もしていないのに消去の
 * 確認が出る。
 * 後始末を断られてもログアウト自体は行う(消すかどうかとは別の話なので)。
 *
 * **このボタンを押さないと直らない場面は作らないこと。** 押した先で
 * 端末内の初期化を聞かれるボタンなので、期限切れのような「勝手に直せる
 * こと」の案内で押させてはいけない (authSession.ts / errorGuidance.ts)。
 *
 * @returns 'signed-out' ログアウトした / 'cancelled' 1段目で止めた
 */
export async function signOutByUser(
  supabase: SupabaseClient,
  // ダイアログは差し替えられるようにしてある(テストと、将来 UI を変えるとき用)
  io: { confirm: (message: string) => boolean } = { confirm: (m) => window.confirm(m) }
): Promise<'signed-out' | 'cancelled'> {
  // 1段目。ここで止めたときは **セッションにも端末にも一切触らない**
  if (!io.confirm(signOutIntentText(unsyncedCount()))) return 'cancelled'

  markSignOutRequested()
  const { error } = await supabase.auth.signOut()
  // 失敗して SIGNED_OUT が飛ばないときは、立てた意図を倒しておく
  // (次に SIGNED_OUT が来たときに後始末が誤発火しないようにする)
  if (error) takeSignOutRequest()
  return 'signed-out'
}
