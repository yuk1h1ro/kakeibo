// ============================================================
// 初期設定(Supabase の接続情報)の入力チェック
//
// 以前は条件を満たさないとボタンが灰色になるだけで、何が足りないのか
// 画面のどこにも出なかった。URL を `xxxx.supabase.co`(https:// 無し)で
// 貼っただけでも、理由が分からないまま先に進めなかった。
// ============================================================

/** キーとして短すぎる長さ。コピーが途中で切れたときに気付けるように */
export const MIN_KEY_LENGTH = 20

/**
 * Project URL の頭に https:// を補う。(純粋関数)
 * `xxxx.supabase.co` だけを貼っても通るようにする。http:// など別の
 * 書き方が付いているものはそのまま返す(下の setupProblem が理由を言う)。
 */
export function withHttps(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') return ''
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/**
 * 保存できない理由。保存できるなら null。(純粋関数)
 * 上から順に、最初に引っかかった1つだけを返す。
 *
 * @param normalizedUrl 保存されるときの形(normalizeUrl を通したもの)
 */
export function setupProblem(normalizedUrl: string, anonKey: string): string | null {
  if (normalizedUrl.trim() === '') return 'Project URL を入れてください'
  if (!normalizedUrl.startsWith('https://')) {
    return 'Project URL は https:// で始まる形です(例: https://xxxx.supabase.co)'
  }
  const key = anonKey.trim()
  if (key === '') return 'anon public キーを入れてください'
  if (key.length <= MIN_KEY_LENGTH) {
    return 'キーが短すぎます。コピーが途中で切れていないか確かめてください'
  }
  return null
}
