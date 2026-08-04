import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { swipeDirection } from '../lib/swipe'

interface Options {
  onPrev: () => void
  onNext: () => void
  /** false のとき(任意期間表示など)は何もしない */
  enabled?: boolean
}

/**
 * 要素の左右スワイプで前後へ移動する。
 * ポインタイベントで実装しているのでマウスのドラッグでも動く。
 * 移動中に preventDefault しないため、縦スクロールやタップは今までどおり効く。
 */
export function useSwipeNav(ref: RefObject<HTMLElement>, { onPrev, onNext, enabled = true }: Options) {
  // ハンドラを毎回付け替えると押している最中に取りこぼすので、最新の関数は ref 経由で読む
  const handlers = useRef({ onPrev, onNext })
  handlers.current = { onPrev, onNext }

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    let startX = 0
    let startY = 0
    let startedAt = 0
    let pointerId: number | null = null

    const onPointerDown = (e: PointerEvent) => {
      // マウスは主ボタンのみ。複数指のときは最初の指だけを見る(ピンチ等と競合させない)
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (pointerId !== null) {
        pointerId = null
        return
      }
      pointerId = e.pointerId
      startX = e.clientX
      startY = e.clientY
      startedAt = e.timeStamp
    }

    const onPointerUp = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return
      pointerId = null
      const dir = swipeDirection(e.clientX - startX, e.clientY - startY, e.timeStamp - startedAt)
      if (dir === 'prev') handlers.current.onPrev()
      else if (dir === 'next') handlers.current.onNext()
    }

    const onPointerCancel = () => {
      pointerId = null
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerCancel)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [ref, enabled])
}
