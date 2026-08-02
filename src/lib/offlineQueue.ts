import type { TransactionInput } from '../hooks/useTransactions'

// オフライン中(または送信失敗時)に保留される Supabase への書き込み操作。
// 同一行への連続操作は圧縮せず、素直に順番どおり積んで順番どおり送る。
export interface PendingOp {
  opId: string // キュー内で op を一意に識別するID
  kind: 'insert' | 'update' | 'delete'
  id: string // 対象行のID(クライアント側で採番した uuid)
  payload?: TransactionInput // insert / update のときの内容
  queuedAt: string // ISO8601。insert の楽観表示では created_at の仮置きに使う
}

const QUEUE_KEY = 'kakeibo.pendingOps'

export function loadQueue(): PendingOp[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as PendingOp[]) : []
  } catch {
    // 壊れたJSON等は空キュー扱い(致命的にしない)
    return []
  }
}

export function saveQueue(ops: PendingOp[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(ops))
  } catch {
    // 容量超過等。保存できなくてもアプリは落とさない
  }
}

export function appendOp(op: PendingOp): PendingOp[] {
  const ops = [...loadQueue(), op]
  saveQueue(ops)
  return ops
}

export function removeOp(opId: string): PendingOp[] {
  const ops = loadQueue().filter((o) => o.opId !== opId)
  saveQueue(ops)
  return ops
}

export function clearQueue(): void {
  try {
    localStorage.removeItem(QUEUE_KEY)
  } catch {
    // no-op
  }
}
