// ============================================================
// ログインの「期限切れ」を利用者に見せない (機能: セッションの自動更新)
//
// ---- 何が起きていたか ----
// Supabase のアクセストークンは既定で1時間で切れる。supabase-js は裏で
// 更新してくれるが、iPhone でホーム画面に戻す・PC でタブを寝かせる、と
// いった「アプリを見ていない時間」には更新が止まる。戻ってきた直後の
// 1発目のリクエストは、切れたままのトークンで飛んで `JWT expired` で
// 落ちる。画面にはこう出ていた:
//
//   「ログインの有効期限が切れているようです。
//     右上のログアウトを押してから、もう一度ログインし直してください。」
//
// **この案内がいちばん危ない。** ログアウトの後始末 (localData.ts) は
// 「端末に残っている家計簿のデータも消しますか?」と聞く。押させる必要の
// ないボタンを押させ、その先で端末内を初期化させかねなかった。
//
// ---- ここでやること ----
// 期限そのものを利用者の問題にしない。更新トークンは残っているのだから、
// **黙って更新して、何事もなかったように続ける**。
//
//   1. 先回り (ensureFreshSession)
//      画面に戻ってきた・窓に焦点が戻った・回線が回復した、という
//      「止まっていた時間の終わり」で、切れかけていれば先に更新する。
//   2. 後始末 (createSelfHealingFetch)
//      それでもすり抜けて 401 `JWT expired` が返ってきたら、その場で
//      更新して **同じリクエストを1回だけ送り直す**。呼び出し側
//      (useTransactions / shareLinks / partnerComments …) は、期限切れが
//      あったことを知らないまま成功を受け取る。
//
// ---- それでも直らないとき ----
// 更新トークンごと失効している(パスワード変更・長期間の放置・
// Supabase 側での失効)ときだけは、本当にログインし直すしかない。
// そのときは supabase-js が SIGNED_OUT を飛ばし、App がログイン画面に
// 戻す。**利用者がログアウトを押したわけではないので、端末内の
// データは1件も消えない** (localData.ts の signOutRequested)。
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 「まだ切れていないが、そろそろ切れる」とみなす余裕(秒)。
 * 0 にすると、切れた瞬間に飛んだリクエストが落ちる。
 * 通信の往復と端末の時計のずれを飲めるだけの幅を取る。
 */
export const REFRESH_MARGIN_SEC = 120

/** 見ていない間に止まっていても気付けるよう、動いている間も時々見に行く間隔 */
export const KEEP_ALIVE_INTERVAL_MS = 5 * 60 * 1000

/**
 * いま更新すべきか。(純粋関数)
 *
 * @param expiresAt セッションの expires_at (UNIX 秒)。分からないときは null
 * @param nowSec    いまの UNIX 秒
 *
 * expires_at が読めないときは「更新する」側に倒す。
 * 余計に1回更新しても害は無いが、切れたまま投げると画面にエラーが出るため。
 */
export function needsRefresh(
  expiresAt: number | null | undefined,
  nowSec: number,
  marginSec: number = REFRESH_MARGIN_SEC
): boolean {
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return true
  return expiresAt - marginSec <= nowSec
}

/**
 * この応答は「トークンが切れていただけ」か。(純粋関数)
 *
 * 送り直せば通るものだけを拾う。権限が無い (RLS) ・キーが違う、といった
 * 送り直しても同じ結果になる失敗を巻き込むと、無駄な往復が増えるうえ、
 * 本当の原因の案内が1往復ぶん遅れる。
 * PostgREST は期限切れを 401 + PGRST301 で返す。
 */
export function isExpiredTokenResponse(status: number, body: string): boolean {
  if (status !== 401 && status !== 403) return false
  return /jwt expired|token is expired|jwt is expired|pgrst301/i.test(body)
}

/** URL を取り出す。(純粋関数) fetch の第1引数は3通りの形を取りうる */
export function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/**
 * 更新そのものの往復か。(純粋関数)
 * ここを送り直しの対象に含めると、更新の失敗が更新を呼ぶ輪になる。
 */
export function isAuthEndpoint(input: RequestInfo | URL): boolean {
  return /\/auth\/v1\//.test(urlOf(input))
}

/**
 * 送り直し用のヘッダを組む。(純粋関数)
 *
 * apikey など元のヘッダを落とすと、期限切れを直した先で別の失敗を作る。
 * init に headers が無いときは Request 側から引き継ぐ。
 */
export function withAuthHeader(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  token: string
): RequestInit {
  const source =
    init?.headers !== undefined
      ? init.headers
      : typeof input === 'object' && input !== null && 'headers' in input
        ? (input as Request).headers
        : undefined
  const headers = new Headers(source)
  headers.set('Authorization', `Bearer ${token}`)
  return { ...init, headers }
}

/** 更新に必要な分だけを写した口。テストから本物のクライアントを要らなくする */
export interface SessionRefresher {
  refreshSession: () => Promise<{ accessToken: string | null }>
}

/**
 * 期限切れだけを自分で直す fetch を作る。
 *
 * 直せなかったとき(更新も失敗した)は、元の応答をそのまま返す。
 * 呼び出し側から見れば今までどおりなので、案内の仕組み (errorGuidance)
 * はそのまま最後の砦として残る。
 */
export function createSelfHealingFetch(
  refresher: SessionRefresher,
  baseFetch: typeof fetch = fetch
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const res = await baseFetch(input, init)
    if (res.status !== 401 && res.status !== 403) return res
    if (isAuthEndpoint(input)) return res

    // 本文は1度しか読めない。判定用に写しを読む(元は呼び出し側に返す)
    let body = ''
    try {
      body = await res.clone().text()
    } catch {
      return res
    }
    if (!isExpiredTokenResponse(res.status, body)) return res

    const { accessToken } = await refresher.refreshSession()
    if (!accessToken) return res
    // 送り直しは1回だけ。ここで返ってきたものが最終の答えになる
    return baseFetch(input, withAuthHeader(input, init, accessToken))
  }
}

/**
 * 更新をひとまとめにする(同時多発を防ぐ)。
 *
 * 画面に戻った瞬間は、取り込み・保留の送信・コメントの読み込みが一斉に
 * 走る。それぞれが更新トークンを使うと、Supabase 側が「使い回された」と
 * 見て失効させかねない。走っている更新があればそれに相乗りする。
 */
export function createRefresher(supabase: SupabaseClient): SessionRefresher {
  let inFlight: Promise<{ accessToken: string | null }> | null = null
  return {
    refreshSession() {
      if (inFlight) return inFlight
      const p = (async () => {
        try {
          const { data, error } = await supabase.auth.refreshSession()
          if (error) return { accessToken: null }
          return { accessToken: data.session?.access_token ?? null }
        } catch {
          // 通信できないだけのこともある。ここで例外を外に出さない
          return { accessToken: null }
        }
      })()
      inFlight = p
      void p.then(
        () => {
          if (inFlight === p) inFlight = null
        },
        () => {
          if (inFlight === p) inFlight = null
        }
      )
      return p
    },
  }
}

/**
 * 切れかけていれば先に更新しておく。
 * 「アプリを見ていない時間」が終わったところで呼ぶ。
 */
export async function ensureFreshSession(
  supabase: SupabaseClient,
  refresher: SessionRefresher,
  nowSec: number = Math.floor(Date.now() / 1000)
): Promise<'none' | 'fresh' | 'refreshed' | 'failed'> {
  let expiresAt: number | null | undefined
  try {
    const { data } = await supabase.auth.getSession()
    if (!data.session) return 'none' // ログインしていない。何もしない
    expiresAt = data.session.expires_at
  } catch {
    return 'none'
  }
  if (!needsRefresh(expiresAt, nowSec)) return 'fresh'
  const { accessToken } = await refresher.refreshSession()
  return accessToken ? 'refreshed' : 'failed'
}

/**
 * セッションを切らさないための見張りを付ける。後始末の関数を返す。
 *
 * 見に行く時機は「止まっていた時間が終わったところ」:
 *   visibilitychange … ホーム画面から戻ってきた / タブを表に出した
 *   focus           … 別の窓から戻ってきた
 *   online          … 圏外・機内モードから復帰した
 * 加えて、開きっぱなしのまま日をまたぐ使い方に備えて時々も見に行く。
 */
export function startSessionKeepAlive(
  supabase: SupabaseClient,
  refresher: SessionRefresher
): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}

  const check = () => {
    void ensureFreshSession(supabase, refresher)
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') check()
  }

  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', check)
  window.addEventListener('online', check)
  const timer = window.setInterval(check, KEEP_ALIVE_INTERVAL_MS)

  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', check)
    window.removeEventListener('online', check)
    window.clearInterval(timer)
  }
}
