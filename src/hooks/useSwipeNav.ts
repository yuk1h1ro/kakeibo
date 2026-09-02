import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { swipeDirection } from '../lib/swipe'

interface Options {
  /** 右へ払ったとき */
  onSwipeRight: () => void
  /** 左へ払ったとき */
  onSwipeLeft: () => void
  /** false のとき(任意期間表示など)は何もしない */
  enabled?: boolean
}

/**
 * 要素の左右スワイプを拾う。
 * ポインタイベントで実装しているのでマウスのドラッグでも動く。
 * 移動中に preventDefault しないため、縦スクロールやタップは今までどおり効く。
 *
 * 払った向きだけを渡し、それが「前の月」なのか「満足」なのかは呼び出し側が決める
 * (月送り以外にも使うようになったため、前後ではなく左右で受け渡している)。
 */
export function useSwipeNav(
  ref: RefObject<HTMLElement>,
  { onSwipeRight, onSwipeLeft, enabled = true }: Options
) {
  // ハンドラを毎回付け替えると押している最中に取りこぼすので、最新の関数は ref 経由で読む
  const handlers = useRef({ onSwipeRight, onSwipeLeft })
  handlers.current = { onSwipeRight, onSwipeLeft }

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
      // swipeDirection の prev/next は「右へ払った/左へ払った」のこと (src/lib/swipe.ts)
      if (dir === 'prev') handlers.current.onSwipeRight()
      else if (dir === 'next') handlers.current.onSwipeLeft()
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
