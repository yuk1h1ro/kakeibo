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

// ---------- 「実はもう入っていた」行の判定 ----------
//
// 行の UUID は **端末側で採番してから** 送っている (offlineQueue.ts の PendingOp.id)。
// だから「自分がいま送ろうとしている id が、すでにサーバーに在る」と断られたなら、
// それは前回の送信がサーバーまで届いて確定し、**応答だけが返ってこなかった**
// ということに他ならない(トンネルに入った瞬間など。端末からは「届かなかった」と
// 区別が付かないのでキューに残り、復帰後に同じ行IDで送り直される)。
//
// つまりこれは失敗ではなく「すでに終わっている」。成功として扱ってキューから外すのが
// 正しい = 同期を冪等にする。隔離してしまうと、同じ行IDで送り直す限り永久に
// 23505 で断られ続け、隔離箱の「もう一度送る」でも二度と復旧できなくなる。
//
// ただし 23505 は主キー以外の一意制約でも起きるので、無関係な重複まで成功に
// 倒してはいけない。実測した PostgREST(Supabase)の応答は
//   code    : "23505"
//   message : duplicate key value violates unique constraint "transactions_pkey"
//   details : Key (id)=(<uuid>) already exists.
// で、**どの列のどの値がぶつかったか** が分かるのは details だけ
// (例えば partner_share_links のトークン重複なら "Key (token)=(...)" になる)。
// そこで「ぶつかった列が id」かつ「その値が今まさに送っている行ID」のときに限る。
// details が読めないときは今までどおり拒否として扱う — 取りこぼしても記録は
// 隔離箱に残るので、安全側に倒しておく。
const UNIQUE_VIOLATION_CODE = '23505'

// details の "Key (列)=(値) already exists." から列と値を取り出す
const DUPLICATE_KEY_DETAIL = /\(([^()]+)\)=\(([^()]*)\)/

export function isDuplicateRowError(err: ServerErrorLike, rowId: string): boolean {
  const unique =
    err.code === UNIQUE_VIOLATION_CODE || /duplicate key value|unique constraint/i.test(err.message)
  if (!unique) return false
  const m = DUPLICATE_KEY_DETAIL.exec(err.details ?? '')
  if (!m) return false
  // uuid の英大小は問わない(PostgreSQL は小文字で返すが、端末側の採番に合わせる)
  return m[1].trim() === 'id' && m[2].trim().toLowerCase() === rowId.trim().toLowerCase()
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
