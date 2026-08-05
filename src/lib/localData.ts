// ============================================================
// 端末に残る家計簿のデータを片付ける (ログアウト / 接続設定のやり直し)
//
// これまで signOut() は Supabase のセッションを消すだけで、
//   - 全明細のキャッシュ (kakeibo.txCache)
//   - Gemini の APIキー / Discord の Webhook URL
//   - 未同期の記録 (kakeibo.pendingOps)
//   - 目隠しや予算などの設定
// が端末にそのまま残っていた。リモートからは触れないので、これは
// 「端末を貸す・修理に出す・売る・失くす」ときにだけ効いてくる問題になる。
//
// ---- ここで一番大事にしていること ----
// **未同期の記録を黙って消さない。** 保留中の記録はまだサーバーに無い
// 「その端末にしかない記録」なので、消せば1件も取り返せない。
// 残っているときは片付けを行わず、その旨を伝えるだけにする。
// 未同期が無いときも、消える物を並べて確認を取ってから消す
// (APIキーや Webhook URL の入れ直しは手間で、黙って消えると事故に見える)。
//
// ---- 消さずに残すもの (KEEP_ON_SIGN_OUT) ----
//   kakeibo.supabaseUrl / kakeibo.supabaseAnonKey
//     … 接続設定。消すと初期設定画面に戻り、anon キーを持ってこないと
//        ログイン画面にすらたどり着けなくなる。RLS があるので、
//        ログインしていない anon キー単体では1件も読めない。
//        意図的に消す導線は別にある(AuthScreen の「接続設定をやり直す」)。
//   kakeibo.amountMask
//     … 金額の目隠し (機能169) を自分でオンにしていた状態。消すと次に
//        ログインしたとき金額が丸見えの既定に戻ってしまい、
//        端末を人に見せる場面での備えが1つ弱くなる。中身は on/off の2値だけ。
// (目隠しの機能208 kakeibo.privacyBlur は既定がオンなので、消しても
//  弱くならない。ここでは消す側に入れている)
//
// ---- Discord の Webhook URL について ----
//   kakeibo.discordWebhook は **消す側のまま**にしてある。
//   この値は Supabase の discord_settings に同期されるようになったので、
//   端末から消しても失われない(次にログインすれば戻ってくる)。
//   むしろ「知っていれば誰でもそのチャンネルに投稿できる」トークンなので、
//   端末を貸す・売るときには消えてくれた方がよい。
//   KEEP_ON_SIGN_OUT に足すと、消したい物が端末に残るだけで得が無い。
//   (Gemini の APIキーは同期しないので、こちらは消したら入れ直しになる。
//    それでも鍵を端末に残す方が危ないので、従来どおり消す側)
// ============================================================

import { loadQueue } from './offlineQueue'

/** この家計簿が端末に置くキーの接頭辞 */
export const KAKEIBO_PREFIX = 'kakeibo.'

/** ログアウトでも消さないキー(理由はファイル冒頭) */
export const KEEP_ON_SIGN_OUT: readonly string[] = [
  'kakeibo.supabaseUrl',
  'kakeibo.supabaseAnonKey',
  'kakeibo.amountMask',
]

/** 消す対象のキーを選ぶ。(純粋関数) */
export function keysToClear(allKeys: readonly string[], keep: readonly string[]): string[] {
  return allKeys.filter((k) => k.startsWith(KAKEIBO_PREFIX) && !keep.includes(k))
}

/**
 * Supabase がログイン状態を置くキー(`sb-<プロジェクト>-auth-token` の形)。(純粋関数)
 * 接続設定をやり直すときは、前の接続先のログイン状態を残さない。
 */
export function supabaseSessionKeys(allKeys: readonly string[]): string[] {
  return allKeys.filter((k) => /^sb-.+-auth-token/.test(k))
}

function allKeysOf(storage: Storage): string[] {
  const out: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key !== null) out.push(key)
  }
  return out
}

/** 未同期(まだサーバーに送れていない)の記録の件数 */
export function unsyncedCount(): number {
  try {
    return loadQueue().length
  } catch {
    // 読めないときは「あるかもしれない」側に倒す(消さない方向に効く)
    return 1
  }
}

/** ログアウト時に出す確認文。何が消えるかを並べる。(純粋関数) */
export function signOutConfirmText(): string {
  return [
    'ログアウトしました。この端末に残っている家計簿のデータも消しますか?',
    '',
    '・全明細のキャッシュ',
    '・Gemini APIキー(入れ直しが必要です)',
    '・Discord Webhook URL(サーバーにも保存されているので、次のログインで戻ります)',
    '・保存した絞り込み条件・予算などの設定',
    '',
    'サーバー上の記録は1件も消えません(次にログインすれば元どおりです)。',
    '端末を貸す・修理に出す・売るときは「OK」を押してください。',
  ].join('\n')
}

/** 未同期が残っているときの警告文。(純粋関数) */
export function unsyncedWarningText(pending: number): string {
  return [
    `未同期の記録が ${pending}件あります。`,
    'この端末にしかない記録なので、端末内のデータは消していません。',
    'もう一度ログインして同期してから、ログアウトし直してください。',
  ].join('\n')
}

/**
 * 端末内のデータを消す。消したキーを返す。
 * @param keep 消さないキー。ログアウトは KEEP_ON_SIGN_OUT、
 *             接続設定のやり直しでは空(接続情報ごと消す)
 */
export function clearLocalData(
  keep: readonly string[] = KEEP_ON_SIGN_OUT,
  storage: Storage = localStorage
): string[] {
  const targets = keysToClear(allKeysOf(storage), keep)
  for (const key of targets) storage.removeItem(key)
  return targets
}

/** 前の接続先のログイン状態(Supabase のセッション)を消す。消したキーを返す */
export function clearSupabaseSession(storage: Storage = localStorage): string[] {
  const targets = supabaseSessionKeys(allKeysOf(storage))
  for (const key of targets) storage.removeItem(key)
  return targets
}

// 利用者が自分でログアウトを押したかどうか。
//
// Supabase の SIGNED_OUT は、セッションの期限切れやトークンの失効でも飛ぶ。
// そのたびに「端末のデータを消しますか」と聞くと、何もしていないのに
// 消去の確認が出ることになり、驚かせるうえ誤って消させかねない。
// 後始末をするのは「押した本人が意図したログアウト」のときだけにする。
let signOutRequested = false

/** ログアウトの意図を立てる。押した直後に signOut を呼ぶこと */
export function markSignOutRequested(): void {
  signOutRequested = true
}

/** 立っている意図を1回だけ取り出す。(取り出したら倒す) */
export function takeSignOutRequest(): boolean {
  const requested = signOutRequested
  signOutRequested = false
  return requested
}

/**
 * ログアウトの後始末。
 *
 * 未同期があるときは何も消さずに知らせるだけ。無ければ確認を取ってから消す。
 * ダイアログは差し替えられるようにしてある(テストと、将来 UI を変えるとき用)。
 */
export function cleanupAfterSignOut(
  io: {
    confirm: (message: string) => boolean
    alert: (message: string) => void
  } = { confirm: (m) => window.confirm(m), alert: (m) => window.alert(m) },
  storage: Storage = localStorage
): 'cleared' | 'kept' | 'blocked' {
  const pending = unsyncedCount()
  if (pending > 0) {
    io.alert(unsyncedWarningText(pending))
    return 'blocked'
  }
  if (!io.confirm(signOutConfirmText())) return 'kept'
  clearLocalData(KEEP_ON_SIGN_OUT, storage)
  return 'cleared'
}
