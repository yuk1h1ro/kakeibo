// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSwipeNav } from './useSwipeNav'

// ============================================================
// 左右スワイプのフック。
//
// ここで固定すること:
//   ・有効な間は要素に touch-action: pan-y を付け、外したら元に戻す
//     (付いていないとタッチでは pointercancel が先に来て、一度も成立しない。
//      レポートの月送りが実際にそうだった)
//   ・入力欄など ignore に当たる場所から始まった指は拾わない
//   ・isBlocked が true を返す瞬間に離した指は何もしない(引き下げ更新の最中など)
//
// jsdom には PointerEvent が無い(素の Event になり clientX が落ちる)ので、
// MouseEvent に pointerId / pointerType を足した最小のものを自分で投げる。
// また jsdom の CSS は touch-action を知らないので、確かめられるのは
// 「el.style.touchAction に書いた/戻した」までで、実際に効くかどうかは
// 実機幅のブラウザ(タッチ)で確かめている。
// ============================================================

afterEach(cleanup)

function pointer(type: string, init: { x: number; y: number; id?: number; kind?: string }) {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.x,
    clientY: init.y,
    button: 0,
  })
  Object.defineProperty(ev, 'pointerId', { value: init.id ?? 1 })
  Object.defineProperty(ev, 'pointerType', { value: init.kind ?? 'touch' })
  return ev
}

/** from から dx だけ横に払う(縦は動かさない) */
function swipe(target: Element, dx: number, from = { x: 150, y: 100 }) {
  target.dispatchEvent(pointer('pointerdown', from))
  target.dispatchEvent(pointer('pointerup', { x: from.x + dx, y: from.y }))
}

function Harness(props: {
  onRight: () => void
  onLeft: () => void
  enabled?: boolean
  ignore?: string
  isBlocked?: () => boolean
  initialTouchAction?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useSwipeNav(ref, {
    onSwipeRight: props.onRight,
    onSwipeLeft: props.onLeft,
    enabled: props.enabled,
    ignore: props.ignore,
    isBlocked: props.isBlocked,
  })
  return (
    <div ref={ref} data-testid="area" style={{ touchAction: props.initialTouchAction }}>
      <span data-testid="plain">文字</span>
      <input aria-label="入力欄" />
      <div data-swipe-ignore data-testid="opt-out">
        <span data-testid="inside-opt-out">中</span>
      </div>
    </div>
  )
}

function setup(props: Partial<Parameters<typeof Harness>[0]> = {}) {
  const onRight = vi.fn()
  const onLeft = vi.fn()
  const view = render(<Harness onRight={onRight} onLeft={onLeft} {...props} />)
  return { onRight, onLeft, view, area: view.getByTestId('area') }
}

describe('useSwipeNav', () => {
  it('右へ払うと onSwipeRight、左へ払うと onSwipeLeft', () => {
    const { onRight, onLeft, view } = setup()
    swipe(view.getByTestId('plain'), 120)
    swipe(view.getByTestId('plain'), -120)
    expect(onRight).toHaveBeenCalledTimes(1)
    expect(onLeft).toHaveBeenCalledTimes(1)
  })

  it('有効な間は touch-action: pan-y を付ける(付けないとタッチでは払えない)', () => {
    const { area } = setup()
    expect(area.style.touchAction).toBe('pan-y')
  })

  it('無効にしたら元のインラインの値に戻す', () => {
    const { area, view, onRight, onLeft } = setup({ initialTouchAction: '' })
    view.rerender(<Harness onRight={onRight} onLeft={onLeft} enabled={false} />)
    expect(area.style.touchAction).toBe('')
  })

  it('無効の間は払っても何もしない', () => {
    const { onRight, view } = setup({ enabled: false })
    swipe(view.getByTestId('plain'), 120)
    expect(onRight).not.toHaveBeenCalled()
  })

  it('入力欄から始まった指は拾わない(文字の選択と取り合わない)', () => {
    const { onRight, view } = setup()
    swipe(view.getByLabelText('入力欄'), 120)
    expect(onRight).not.toHaveBeenCalled()
  })

  it('data-swipe-ignore の中から始まった指も拾わない', () => {
    const { onLeft, view } = setup()
    swipe(view.getByTestId('inside-opt-out'), -120)
    expect(onLeft).not.toHaveBeenCalled()
  })

  it('ignore を差し替えられる(空文字ならどこから始まっても拾う)', () => {
    const { onRight, view } = setup({ ignore: '' })
    swipe(view.getByLabelText('入力欄'), 120)
    expect(onRight).toHaveBeenCalledTimes(1)
  })

  it('離した瞬間に isBlocked が true なら何もしない(引き下げ更新の最中など)', () => {
    let blocked = true
    const { onRight, view } = setup({ isBlocked: () => blocked })
    swipe(view.getByTestId('plain'), 120)
    expect(onRight).not.toHaveBeenCalled()

    // 状態は離すたびに聞き直す(押したときの値を覚えておかない)
    blocked = false
    swipe(view.getByTestId('plain'), 120)
    expect(onRight).toHaveBeenCalledTimes(1)
  })

  it('途中でブラウザが指を引き取ったら(pointercancel)何もしない', () => {
    const { onRight, view } = setup()
    const el = view.getByTestId('plain')
    el.dispatchEvent(pointer('pointerdown', { x: 150, y: 100 }))
    el.dispatchEvent(pointer('pointercancel', { x: 160, y: 100 }))
    el.dispatchEvent(pointer('pointerup', { x: 280, y: 100 }))
    expect(onRight).not.toHaveBeenCalled()
  })
})
