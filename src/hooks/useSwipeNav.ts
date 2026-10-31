import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { swipeDirection } from '../lib/swipe'

/**
 * 払う操作の始まりとして拾わない要素の既定。
 * 入力欄の上の横の指は「文字の選択・カーソル移動」であって、画面をめくる指ではない。
 * それ以外に外したい要素(横に動かす部品など)は data-swipe-ignore を付ければ外れる。
 */
export const SWIPE_IGNORE_DEFAULT = 'input, textarea, select, [data-swipe-ignore]'

interface Options {
  /** 右へ払ったとき */
  onSwipeRight: () => void
  /** 左へ払ったとき */
  onSwipeLeft: () => void
  /** false のとき(任意期間表示など)は何もしない */
  enabled?: boolean
  /**
   * 押し始めの場所がこれに当たる指は拾わない(Element.closest に渡すセレクタ)。
   * 既定は SWIPE_IGNORE_DEFAULT。
   */
  ignore?: string
  /**
   * 指を離した瞬間に「いまは払っても何もしない」かを聞く。
   * enabled と違って、引き下げ更新の最中のような **一瞬だけの状態** に使う
   * (enabled を切り替えると touch-action まで付け外しすることになり、
   *  指を置いている最中にブラウザの判定が変わってしまう)。
   */
  isBlocked?: () => boolean
}

/**
 * 要素の左右スワイプを拾う。
 * ポインタイベントで実装しているのでマウスのドラッグでも動く。
 * 移動中に preventDefault しないため、縦スクロールやタップは今までどおり効く。
 *
 * 払った向きだけを渡し、それが「前の月」なのか「満足」なのかは呼び出し側が決める
 * (月送り以外にも使うようになったため、前後ではなく左右で受け渡している)。
 *
 * ---- touch-action: pan-y を付ける理由 ----
 * 何も指定しない要素(touch-action: auto)の上で指を横に動かすと、
 * ブラウザがその指を「ページの操作(横スクロール・拡大)」として引き取り、
 * pointerdown の直後に pointercancel を投げてくる。すると pointerup が来ないので、
 * スワイプは **タッチでは一度も成立しない**(マウスでしか動かない)。
 * レポートの月送りがまさにこの状態で、スマホでは払っても何も起きていなかった(実測)。
 * pan-y にすれば縦スクロールはブラウザに任せたまま、横の指だけがこちらに届く
 * (行のスワイプ .hist-row や気分の仕分け .sort-card が CSS で同じことをしている)。
 * 呼ぶ側の CSS に書かせると付け忘れで同じ不具合が再発するので、このフックが付ける。
 * 有効な間だけ付け、外すときは元のインラインの値に戻す。
 */
export function useSwipeNav(
  ref: RefObject<HTMLElement>,
  { onSwipeRight, onSwipeLeft, enabled = true, ignore = SWIPE_IGNORE_DEFAULT, isBlocked }: Options
) {
  // ハンドラを毎回付け替えると押している最中に取りこぼすので、最新の関数は ref 経由で読む
  const handlers = useRef({ onSwipeRight, onSwipeLeft, isBlocked })
  handlers.current = { onSwipeRight, onSwipeLeft, isBlocked }

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    const prevTouchAction = el.style.touchAction
    el.style.touchAction = 'pan-y'

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
      // 入力欄など、横の指に別の意味がある場所から始まった指は拾わない
      if (ignore !== '' && e.target instanceof Element && e.target.closest(ignore)) return
      pointerId = e.pointerId
      startX = e.clientX
      startY = e.clientY
      startedAt = e.timeStamp
    }

    const onPointerUp = (e: PointerEvent) => {
      if (pointerId !== e.pointerId) return
      pointerId = null
      if (handlers.current.isBlocked?.()) return
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
      el.style.touchAction = prevTouchAction
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [ref, enabled, ignore])
}
