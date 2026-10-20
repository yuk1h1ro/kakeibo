import { useCallback, useEffect, useRef, useState } from 'react'
import type { Transaction } from '../lib/types'

/** 削除を取り消せる時間 (機能159)。短いと間に合わず、長いと画面を塞ぐ */
const UNDO_WINDOW_MS = 7000

/**
 * 直前に削除した行を、数秒だけ取り消せるように持っておく (機能159)。
 *
 * 「削除を取り消せる状態」は画面ではなく useTransactions 側に持たせる。
 * どの画面から消しても(編集シート・スワイプ・長押し・一括)同じように
 * 取り消せるようにするため、そして画面を離れても数秒で必ず期限切れになるため
 * (取り消しバーの寿命を画面の寿命に紐付けると、あとから古いバーが出てしまう)。
 */
export function useUndoableDeletes() {
  const [undoableDeletes, setUndoableDeletes] = useState<Transaction[] | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  /** 消した行を取り消せる状態にする。前に消した分は上書きされる */
  const armUndo = useCallback((txs: readonly Transaction[]) => {
    clearTimer()
    setUndoableDeletes(txs.length > 0 ? [...txs] : null)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setUndoableDeletes(null)
    }, UNDO_WINDOW_MS)
  }, [])

  /** 取り消したので、もう取り消せる状態にしない */
  const dismissUndo = useCallback(() => {
    clearTimer()
    setUndoableDeletes(null)
  }, [])

  useEffect(() => clearTimer, [])

  return { undoableDeletes, armUndo, dismissUndo }
}
