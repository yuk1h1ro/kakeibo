// ============================================================
// ログインの控え — 勝手にログアウトされても、黙って戻す
//
// ---- 何が起きていたか ----
// 前回 (authSession.ts) で「アクセストークンの期限切れ」は黙って直すように
// した。それでも「ログインしてください」の画面に戻されることがあった。
//
// 原因は supabase-js 自身にある。更新トークンでの更新が
// **通信不調以外の理由で** 1回失敗すると、supabase-js は端末に保存した
// セッション (`sb-<プロジェクト>-auth-token`) を自分で消し、SIGNED_OUT を
// 出す (auth-js の _callRefreshToken → _removeSession)。こうなると
// アプリにはもう手掛かりが残らず、ログイン画面を出すしかない。
//
// 失敗が起きやすいのは、たとえば
//   - PC で2つのタブが同時に更新し、片方が「もう使われた更新トークン」で
//     弾かれる → 弾かれた側が **共有の保存場所ごと** 消してしまう
//     (もう片方が受け取ったばかりの新しいトークンも巻き添えになる)
//   - iPhone でアプリを寝かせていた間の1回目の通信が、通信不調とは
//     判定されない形で落ちる
// のような、**本当はまだログインできる** 場面。
//
// ---- ここでやること ----
// 更新トークンの控えを、supabase-js とは別の場所 (kakeibo.authVault) に
// 持っておく。更新に成功するたびに最新に書き換える。
// supabase-js がセッションを手放したら、控えのトークンで1回だけ
// 更新し直す。通れば何事もなかったように続き、利用者は何も押さない。
//
// ---- 控えを消すとき (= 本当にログアウトするとき) ----
//   - 利用者がログアウトを押した (signOutByUser)
//     … 控えが残っていると、押したのに勝手にログインし直してしまう
//   - 控えのトークンもサーバーに断られた
//     … もう二度と通らないので、持っていても意味が無い
//   - 接続設定をやり直した (clearConfig が kakeibo.* を全部消す)
// 通信できなかっただけなら **消さない**。電波が戻ればまた試せる。
//
// ---- 端末に置くことについて ----
// 更新トークンそのものは、supabase-js がすでに同じ localStorage に
// 平文で置いている。控えを1つ増やしても、端末を手に入れた人に
// 見えるものは増えない(どちらも同じ場所にある)。
// 端末を貸す・売るときに消える側 (kakeibo.*) にも入っている。
// ============================================================

import { isAuthRetryableFetchError, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { isOnlineNow } from './serverErrors'

export const VAULT_KEY = 'kakeibo.authVault'

export interface VaultEntry {
  refreshToken: string
  /** 誰の控えか。復帰の判定には使わない(調べものの手掛かり用) */
  userId: string
  /** 最後に書き換えた時刻(ISO)。調べものの手掛かり用 */
  savedAt: string
}

/** 保存した文字列を控えとして読む。壊れていれば null。(純粋関数) */
export function parseVault(raw: string | null): VaultEntry | null {
  if (raw === null) return null
  try {
    const v = JSON.parse(raw) as Partial<VaultEntry> | null
    if (
      v === null ||
      typeof v !== 'object' ||
      typeof v.refreshToken !== 'string' ||
      v.refreshToken === '' ||
      typeof v.userId !== 'string' ||
      typeof v.savedAt !== 'string'
    ) {
      return null
    }
    return { refreshToken: v.refreshToken, userId: v.userId, savedAt: v.savedAt }
  } catch {
    return null
  }
}

/** セッションから控えを作る。更新トークンが無ければ null。(純粋関数) */
export function vaultEntryOf(
  session: Pick<Session, 'refresh_token'> & { user: { id: string } },
  now: Date = new Date()
): VaultEntry | null {
  if (!session.refresh_token) return null
  return { refreshToken: session.refresh_token, userId: session.user.id, savedAt: now.toISOString() }
}

// localStorage が使えない端末(プライベートブラウズ等)でも、ログインそのものは
// 止めない。控えが無いだけで、今までどおりの動きに戻る。

export function readVault(storage: Storage = localStorage): VaultEntry | null {
  try {
    return parseVault(storage.getItem(VAULT_KEY))
  } catch {
    return null
  }
}

export function hasVault(storage: Storage = localStorage): boolean {
  return readVault(storage) !== null
}

/** 最新のセッションで控えを書き換える。 */
export function writeVault(
  session: Pick<Session, 'refresh_token'> & { user: { id: string } },
  storage: Storage = localStorage
): void {
  const entry = vaultEntryOf(session)
  if (entry === null) return
  try {
    storage.setItem(VAULT_KEY, JSON.stringify(entry))
  } catch {
    // 書けなくても、今のログインには影響しない
  }
}

export function clearVault(storage: Storage = localStorage): void {
  try {
    storage.removeItem(VAULT_KEY)
  } catch {
    // 消せない端末では何もしない
  }
}

/**
 * 控えからログインを戻した結果。
 *   restored  … 戻った。supabase-js がセッションを保存し直し、画面も続く
 *   no-backup … 控えが無い。ログインし直すしかない
 *   offline   … 通信できなかった。控えは残してあり、電波が戻れば試せる
 *   rejected  … 控えもサーバーに断られた。控えは消した。ログインし直すしかない
 */
export type RestoreResult = 'restored' | 'no-backup' | 'offline' | 'rejected'

/** 更新に必要な分だけを写した口。テストから本物のクライアントを要らなくする */
type RefreshCapable = Pick<SupabaseClient['auth'], 'refreshSession'>

// 同時に何度呼ばれても、サーバーへ行くのは1回だけにする。
// 同じ更新トークンを2回使うと、2回目は「使い回し」として断られ、
// 断られた側の処理が控えを消してしまう。
let inFlight: Promise<RestoreResult> | null = null

/**
 * supabase-js がセッションを手放したあとで、控えの更新トークンから戻す。
 *
 * 通れば supabase-js が新しいセッションを保存して TOKEN_REFRESHED を出すので、
 * 画面 (App) はそれを受けてそのまま続く。呼び出し側は結果を見て、
 * ログイン画面を出すか、電波を待つかを決める。
 */
export function restoreFromVault(
  auth: RefreshCapable,
  options: { storage?: Storage; online?: boolean } = {}
): Promise<RestoreResult> {
  if (inFlight) return inFlight
  const p = runRestore(auth, options)
  inFlight = p
  const release = () => {
    if (inFlight === p) inFlight = null
  }
  p.then(release, release)
  return p
}

async function runRestore(
  auth: RefreshCapable,
  { storage = localStorage, online = isOnlineNow() }: { storage?: Storage; online?: boolean }
): Promise<RestoreResult> {
  const entry = readVault(storage)
  if (entry === null) return 'no-backup'
  // 圏外で投げても失敗が1つ増えるだけ。控えは残して電波を待つ
  if (!online) return 'offline'

  let result: Awaited<ReturnType<RefreshCapable['refreshSession']>>
  try {
    result = await auth.refreshSession({ refresh_token: entry.refreshToken })
  } catch {
    // 例外で落ちるのは通信まわり。控えは残す
    return 'offline'
  }
  const { data, error } = result
  if (error) {
    if (isAuthRetryableFetchError(error)) return 'offline'
    // サーバーが「このトークンはもう使えない」と言った。二度と通らない
    clearVault(storage)
    return 'rejected'
  }
  if (!data.session) {
    clearVault(storage)
    return 'rejected'
  }
  // 戻った直後のセッションで控えも最新にする(onAuthStateChange でも書くが、
  // 画面がその知らせを受ける前に次の更新が走っても取りこぼさないように)
  writeVault(data.session, storage)
  return 'restored'
}

/**
 * どの画面を出すか。(純粋関数)
 *
 *   loading   … 起動直後、端末のセッションを読んでいる
 *   app       … ログインしている。家計簿の本体
 *   restoring … セッションは消えたが、控えから戻している最中
 *   waiting   … 控えはあるが通信できない。電波が戻れば戻せる
 *   login     … 控えが無い / 断られた。ログインし直すしかない
 *
 * **セッションが無い間は、家計簿の本体 (app) を出さない。**
 * 本体はログインしている前提でサーバーに問い合わせる。ログインしていない
 * 問い合わせは RLS で「0件」として返ってくる(エラーにならない)ので、
 * 端末のキャッシュを空で上書きし、記録が全部消えたように見せてしまう。
 */
export type AuthView = 'loading' | 'app' | 'restoring' | 'waiting' | 'login'

export function authViewFor(s: {
  ready: boolean
  hasSession: boolean
  /** 'pending' = まだ試していない / 試している最中 */
  restore: RestoreResult | 'pending'
}): AuthView {
  if (!s.ready) return 'loading'
  if (s.hasSession) return 'app'
  switch (s.restore) {
    case 'pending':
    case 'restored': // 戻った知らせ (TOKEN_REFRESHED) が届くまでの一瞬
      return 'restoring'
    case 'offline':
      return 'waiting'
    case 'no-backup':
    case 'rejected':
      return 'login'
  }
}
