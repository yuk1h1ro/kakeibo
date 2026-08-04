import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Satisfaction, Transaction } from '../lib/types'
import {
  appendOp,
  loadQueue,
  removeOp,
  type PendingOp,
} from '../lib/offlineQueue'
import {
  isSatisfactionUnavailable,
  markSatisfactionUnavailable,
  withoutSatisfaction,
} from '../lib/satisfaction'
import { buildPartnerOpMessage, sendDiscordMessage } from '../lib/discordNotify'
import {
  isNetworkError,
  isRetryableServerError,
  isSchemaError,
  type ServerErrorLike,
} from '../lib/serverErrors'

export interface TransactionInput {
  date: string
  type: 'expense' | 'partner_deposit'
  amount: number
  category: string | null
  memo: string
  store: string // お店(店名)。任意。支出でのみ使用(空文字 = 未入力)
  partner_amount: number
  // 繰り返し入力が自動生成した行の印。手入力では付けない。
  // (省略時は列自体を送らないので、source 列が無いDBでも手入力は通る)
  source?: 'recurring'
  // 感情スタンプ (機能219 + 143)。migration-satisfaction.sql 未実行の環境では
  // 送信直前にキーごと落とす(下の sendablePayload)
  satisfaction?: Satisfaction | null
}

/**
 * 送信直前に、この環境に無い列を落とした内容を作る。
 * 列が無いと分かっている間 satisfaction を送らないことで、
 * マイグレーション未実行でも記録そのものは必ず通る。
 */
function sendablePayload(payload: TransactionInput | undefined): Partial<TransactionInput> {
  if (!payload) return {}
  return isSatisfactionUnavailable() ? withoutSatisfaction(payload) : payload
}

// ---------- スナップショットキャッシュ(オフライン起動・高速起動用) ----------

const TX_CACHE_KEY = 'kakeibo.txCache'

// 後方互換: store カラム追加以前に保存された行(migration 未実行のサーバー・
// 旧バージョンの localStorage キャッシュ)には store が無い(undefined)。
// 表示側に `?? ''` を散らさず、読み込みの入口で一括して '' に正規化する。
function normalizeRows(rows: Transaction[]): Transaction[] {
  return rows.map((r) => (typeof r.store === 'string' ? r : { ...r, store: '' }))
}

function loadTxCache(): Transaction[] | null {
  try {
    const raw = localStorage.getItem(TX_CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? normalizeRows(parsed as Transaction[]) : null
  } catch {
    return null
  }
}

function saveTxCache(rows: Transaction[]): void {
  try {
    localStorage.setItem(TX_CACHE_KEY, JSON.stringify(rows))
  } catch {
    // 容量超過等は無視(キャッシュはあくまで補助)
  }
}

// ---------- 再試行すべきエラーの判定 ----------
// 判定そのものは lib/serverErrors.ts に置き、他のテーブルからも同じ基準で使う。
// 従来この場所から import していた箇所のために再エクスポートする。
export type { ServerErrorLike }
export { isNetworkError, isSchemaError, isRetryableServerError }

export const SCHEMA_ERROR_MESSAGE =
  'データベースの更新が必要です。SupabaseのSQL Editorで migration-store.sql を実行してください' +
  '(記録は保存されており、実行後に自動で同期されます)'

function sortRows(rows: Transaction[]): Transaction[] {
  return [...rows].sort(
    (a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)
  )
}

// サーバースナップショットに保留キューを順に適用した表示用リストを作る
function applyPendingOps(server: Transaction[], ops: PendingOp[]): Transaction[] {
  let rows = server
  for (const op of ops) {
    if (op.kind === 'insert') {
      if (op.payload && !rows.some((r) => r.id === op.id)) {
        rows = [...rows, { id: op.id, created_at: op.queuedAt, ...op.payload }]
      }
    } else if (op.kind === 'update') {
      if (op.payload) {
        const payload = op.payload
        rows = rows.map((r) => (r.id === op.id ? { ...r, ...payload } : r))
      }
    } else {
      rows = rows.filter((r) => r.id !== op.id)
    }
  }
  return sortRows(rows)
}

export function useTransactions(supabase: SupabaseClient) {
  const [serverTx, setServerTx] = useState<Transaction[]>(() => loadTxCache() ?? [])
  const [pendingOps, setPendingOps] = useState<PendingOp[]>(() => loadQueue())
  // キャッシュがあれば即表示できるので loading にしない
  const [loading, setLoading] = useState(() => loadTxCache() === null)
  const [error, setError] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [syncing, setSyncing] = useState(false)

  // StrictMode の二重実行や 'online' イベント連打での flush 多重起動を防ぐ
  const flushingRef = useRef(false)

  // Discord通知の残高計算用に、flush 内から最新のサーバースナップショットを
  // 同期的に参照できるようにしておく(state だけだと閉じ込めが古くなる)
  const serverTxRef = useRef<Transaction[]>(serverTx)

  const refresh = useCallback(async () => {
    // 明らかにオフラインなら何もしない(キャッシュ表示を維持)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setLoading(false)
      return
    }
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) {
        // ネットワーク起因の失敗は「オフライン」扱いで静かに戻る
        if (!isNetworkError(error.message)) setError(error.message)
      } else {
        const rows = normalizeRows(data as Transaction[])
        setServerTx(rows)
        serverTxRef.current = rows
        saveTxCache(rows)
        setError(null)
      }
    } catch {
      // fetch 例外もオフライン扱い。error state は汚さない
    }
    setLoading(false)
  }, [supabase])

  // 保留キューを先頭から順に Supabase へ送る
  const flush = useCallback(async () => {
    if (flushingRef.current) return
    if (loadQueue().length === 0) return
    flushingRef.current = true
    setSyncing(true)
    let flushedSomething = false
    // Discord通知用: この flush 中に成功した op を順に適用したローカル状態。
    // update/delete の旧行の検索と「op適用後の残高」の計算に使う
    // (厳密な整合性より、通知が記録を止めないことを優先する)
    let localRows = serverTxRef.current
    try {
      for (;;) {
        const queue = loadQueue()
        if (queue.length === 0) break
        const op = queue[0]
        // code/details/hint まで保持する(スキーマ関連エラーの判定に使う)
        let err: ServerErrorLike | null = null
        try {
          if (op.kind === 'insert') {
            const { error } = await supabase
              .from('transactions')
              .insert({ id: op.id, ...sendablePayload(op.payload) })
            err = error
          } else if (op.kind === 'update') {
            const { error } = await supabase
              .from('transactions')
              .update({ ...sendablePayload(op.payload) })
              .eq('id', op.id)
            err = error
          } else {
            const { error } = await supabase.from('transactions').delete().eq('id', op.id)
            err = error
          }
        } catch (e) {
          err = { message: e instanceof Error ? e.message : String(e) }
        }
        if (err) {
          if (isSchemaError(err)) {
            // satisfaction(感情スタンプ)は「無くても記録は成り立つ」項目なので、
            // その列が無いだけなら諦めて同じ op をやり直す。ここで中断すると
            // 後続の記録まで送れなくなり、入力が滞留してしまうため。
            // 一度落としたあとは sendablePayload が送らないので無限には回らない。
            if (!isSatisfactionUnavailable() && op.payload?.satisfaction !== undefined) {
              markSatisfactionUnavailable()
              continue
            }
            // それ以外の migration 未実行 — 実行すれば通るので op は必ず残す。
            // 対処法が分かるメッセージを出したうえで中断する
            setError(SCHEMA_ERROR_MESSAGE)
            break
          }
          if (isNetworkError(err.message)) {
            // 通信起因 — キューは保持したまま静かに中断し、次のトリガーで再試行
            break
          }
          // 永続的な拒否(制約違反など)— この op は破棄して先へ進む(無限再試行しない)
          setPendingOps(removeOp(op.opId))
          setError(`同期できなかった記録があります: ${err.message}`)
          flushedSomething = true
        } else {
          // 同期成功 — 彼女残高に影響する op なら Discord に通知する。
          // 旧行の参照(localRows)は「キューから op を消す前」に確保する
          const nextRows = applyPendingOps(localRows, [op])
          const message = buildPartnerOpMessage(op, localRows, nextRows)
          if (message) void sendDiscordMessage(message) // 投げっぱなし。失敗しても記録は止めない
          localRows = nextRows
          setPendingOps(removeOp(op.opId))
          flushedSomething = true
        }
      }
    } finally {
      flushingRef.current = false
      setSyncing(false)
    }
    // 全部さばけたらサーバーの真の状態を取り直す
    if (flushedSomething && loadQueue().length === 0) {
      await refresh()
    }
  }, [supabase, refresh])

  // マウント時: まずキャッシュ表示 → サーバーから取得 → 保留分を再送
  useEffect(() => {
    void refresh().then(() => flush())
  }, [refresh, flush])

  // オンライン/オフラインの追跡。復帰時は自動で再同期
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      void flush()
    }
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [flush])

  const add = useCallback(
    async (input: TransactionInput) => {
      const op: PendingOp = {
        opId: crypto.randomUUID(),
        kind: 'insert',
        // 行IDをクライアント側で採番することで、未同期の行への
        // update/delete も同じIDで一貫して扱える
        id: crypto.randomUUID(),
        payload: input,
        queuedAt: new Date().toISOString(),
      }
      setPendingOps(appendOp(op))
      void flush()
    },
    [flush]
  )

  const update = useCallback(
    async (id: string, input: TransactionInput) => {
      const op: PendingOp = {
        opId: crypto.randomUUID(),
        kind: 'update',
        id,
        payload: input,
        queuedAt: new Date().toISOString(),
      }
      setPendingOps(appendOp(op))
      void flush()
    },
    [flush]
  )

  /**
   * 複数行をまとめて更新する。1件ずつ update と同じ op をキューに積むだけなので、
   * オフラインでも未同期のまま失われない(「過去にも適用」の一括変更で使う)。
   */
  const updateMany = useCallback(
    async (updates: { id: string; input: TransactionInput }[]) => {
      if (updates.length === 0) return
      const queuedAt = new Date().toISOString()
      let ops: PendingOp[] = loadQueue()
      for (const u of updates) {
        ops = appendOp({
          opId: crypto.randomUUID(),
          kind: 'update',
          id: u.id,
          payload: u.input,
          queuedAt,
        })
      }
      setPendingOps(ops)
      void flush()
    },
    [flush]
  )

  const remove = useCallback(
    async (id: string) => {
      const op: PendingOp = {
        opId: crypto.randomUUID(),
        kind: 'delete',
        id,
        queuedAt: new Date().toISOString(),
      }
      setPendingOps(appendOp(op))
      void flush()
    },
    [flush]
  )

  // 表示用: サーバースナップショット + 保留キューの楽観的マージ
  const transactions = useMemo(
    () => applyPendingOps(serverTx, pendingOps),
    [serverTx, pendingOps]
  )

  return {
    transactions,
    loading,
    error,
    refresh,
    add,
    update,
    updateMany,
    remove,
    pendingCount: pendingOps.length,
    isOnline,
    syncing,
  }
}
