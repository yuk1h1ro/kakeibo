// ============================================================
// 端末に持つ取引の写し (useTransactions が使う)
//
//   - サーバーから取り込んだ行のキャッシュ(オフライン起動・高速起動用)
//   - 最後に取り込めた時刻 (機能154)
//   - サーバーの写しに送信待ちのキューを重ねた「画面に出す一覧」(純粋関数)
//
// どれもフックの状態に依存しないので、フックから切り離してここに置く。
// ============================================================

import type { Transaction } from './types'
import type { PendingOp } from './offlineQueue'

// ---------- スナップショットキャッシュ(オフライン起動・高速起動用) ----------

const TX_CACHE_KEY = 'kakeibo.txCache'

/**
 * 後方互換: store カラム追加以前に保存された行(migration 未実行のサーバー・
 * 旧バージョンの localStorage キャッシュ)には store が無い(undefined)。
 * 表示側に `?? ''` を散らさず、読み込みの入口で一括して '' に正規化する。
 */
export function normalizeRows(rows: Transaction[]): Transaction[] {
  return rows.map((r) => (typeof r.store === 'string' ? r : { ...r, store: '' }))
}

export function loadTxCache(): Transaction[] | null {
  try {
    const raw = localStorage.getItem(TX_CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? normalizeRows(parsed as Transaction[]) : null
  } catch {
    return null
  }
}

export function saveTxCache(rows: Transaction[]): void {
  try {
    localStorage.setItem(TX_CACHE_KEY, JSON.stringify(rows))
  } catch {
    // 容量超過等は無視(キャッシュはあくまで補助)
  }
}

// ---------- 最終同期時刻 (機能154) ----------
// 「いつのデータを見ているのか」は再起動しても引き継ぎたいので端末内に残す。
// 記録できるのは「サーバーから取り込みに成功した時刻」だけで、
// 通信できなかったときは前の値を保つ(嘘の更新時刻を出さないため)。

const LAST_SYNC_KEY = 'kakeibo.lastSyncedAt'

export function loadLastSyncedAt(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY)
  } catch {
    return null
  }
}

export function saveLastSyncedAt(iso: string): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, iso)
  } catch {
    // 保存できなくても表示が出ないだけ
  }
}

// ---------- 画面に出す一覧 ----------

/** 日付の新しい順、同じ日なら作った順に新しいものから。(純粋関数) */
export function sortRows(rows: Transaction[]): Transaction[] {
  return [...rows].sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
}

/**
 * サーバーの写しに、送信待ちのキューを先頭から順に重ねる。(純粋関数)
 * 画面はこの結果を出すので、圏外で入れた記録もすぐ一覧に現れる。
 * 同期の最中に「この op が通ったあとの手元の状態」を作るのにも使う。
 */
export function applyPendingOps(server: Transaction[], ops: readonly PendingOp[]): Transaction[] {
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
