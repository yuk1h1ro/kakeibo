import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Transaction } from '../lib/types'
import {
  appendOp,
  loadQueue,
  removeOp,
  type PendingOp,
} from '../lib/offlineQueue'

export interface TransactionInput {
  date: string
  type: 'expense' | 'partner_deposit'
  amount: number
  category: string | null
  memo: string
  partner_amount: number
}

// ---------- スナップショットキャッシュ(オフライン起動・高速起動用) ----------

const TX_CACHE_KEY = 'kakeibo.txCache'

function loadTxCache(): Transaction[] | null {
  try {
    const raw = localStorage.getItem(TX_CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Transaction[]) : null
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

// ---------- ネットワーク起因エラーの判定 ----------

// supabase-js は fetch の失敗を「TypeError: Failed to fetch」(Chrome)や
// 「TypeError: Load failed」(Safari)といった message の error として返す。
// これらは「後で再試行すべき」失敗で、サーバーの拒否(制約違反等)とは区別する。
function isNetworkError(message: string): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  return /fetch|network|load failed|接続|タイムアウト|timeout/i.test(message)
}

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
        const rows = data as Transaction[]
        setServerTx(rows)
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
    try {
      for (;;) {
        const queue = loadQueue()
        if (queue.length === 0) break
        const op = queue[0]
        let err: { message: string } | null = null
        try {
          if (op.kind === 'insert') {
            const { error } = await supabase
              .from('transactions')
              .insert({ id: op.id, ...op.payload })
            err = error
          } else if (op.kind === 'update') {
            const { error } = await supabase
              .from('transactions')
              .update({ ...op.payload })
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
          if (isNetworkError(err.message)) {
            // 通信起因 — キューは保持したまま中断し、次のトリガーで再試行
            break
          }
          // サーバーが拒否(制約違反など)— この op は破棄して先へ進む(無限再試行しない)
          setPendingOps(removeOp(op.opId))
          setError(`同期できなかった記録があります: ${err.message}`)
          flushedSomething = true
        } else {
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
    remove,
    pendingCount: pendingOps.length,
    isOnline,
    syncing,
  }
}
