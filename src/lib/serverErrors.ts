// ============================================================
// Supabase(PostgREST)のエラー分類
//
// 取引の同期(useTransactions)だけでなく、後から足したマスタデータ
// (store_categories / recurring_rules / transaction_templates)からも
// 同じ基準で「マイグレーション未実行」を見分けたいので、ここに切り出している。
// ============================================================

// code / details / hint まで見て分類する。
// catch した例外は message しか無いので、message 以外は任意。
export interface ServerErrorLike {
  message: string
  code?: string | null
  details?: string | null
  hint?: string | null
}

// supabase-js は fetch の失敗を「TypeError: Failed to fetch」(Chrome)や
// 「TypeError: Load failed」(Safari)といった message の error として返す。
// これらは「後で再試行すべき」失敗で、サーバーの拒否(制約違反等)とは区別する。
export function isNetworkError(message: string): boolean {
  // navigator.onLine が false と明示されているときだけオフライン扱い
  // (非ブラウザ環境では undefined になるため === false で判定する)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  return /fetch|network|load failed|接続|タイムアウト|timeout/i.test(message)
}

// スキーマ未適用(migration 未実行)による拒否。
// マイグレーションを実行すれば通るので、キューを捨ててはいけない。
//   PGRST204 … schema cache に列が無い
//   42703    … undefined_column
//   42P01    … undefined_table
const SCHEMA_ERROR_CODES = new Set(['PGRST204', '42703', '42P01'])

export function isSchemaError(err: ServerErrorLike): boolean {
  if (err.code && SCHEMA_ERROR_CODES.has(err.code)) return true
  const text = [err.message, err.details, err.hint].filter(Boolean).join(' ')
  return /schema cache|does not exist|could not find/i.test(text)
}

// 「あとで直せる(再試行すべき)」失敗か。
// true のとき op はキューに残す = 入力した記録は絶対に失わない。
export function isRetryableServerError(err: ServerErrorLike): boolean {
  return isSchemaError(err) || isNetworkError(err.message)
}

/**
 * 例外・エラーオブジェクトを ServerErrorLike に寄せる。
 * try/catch で受けた unknown をそのまま判定に流せるようにするためのもの。
 */
export function toServerError(e: unknown): ServerErrorLike {
  if (e !== null && typeof e === 'object' && 'message' in e) {
    const o = e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown }
    return {
      message: typeof o.message === 'string' ? o.message : String(e),
      code: typeof o.code === 'string' ? o.code : null,
      details: typeof o.details === 'string' ? o.details : null,
      hint: typeof o.hint === 'string' ? o.hint : null,
    }
  }
  return { message: e instanceof Error ? e.message : String(e) }
}
