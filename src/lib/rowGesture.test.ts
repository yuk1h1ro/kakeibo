import { describe, expect, it } from 'vitest'
import {
  AXIS_LOCK_DISTANCE,
  LONG_PRESS_MS,
  SWIPE_COMMIT_DISTANCE,
  SWIPE_MAX_OFFSET,
  SWIPE_REVEAL_DISTANCE,
  committedAction,
  nextPhase,
  shouldFireTap,
  swipeVisual,
} from './rowGesture'

describe('nextPhase(ジェスチャーの優先順位)', () => {
  it('少し触っただけでは何も確定しない', () => {
    expect(nextPhase('pending', 3, 2, 100)).toBe('pending')
  })

  it('縦に動いたらスクロール(スワイプより縦を優先する)', () => {
    expect(nextPhase('pending', 6, 40, 120)).toBe('scroll')
  })

  it('斜めでも縦寄りならスクロール', () => {
    expect(nextPhase('pending', 20, 25, 120)).toBe('scroll')
  })

  it('横にはっきり動いたらスワイプ', () => {
    expect(nextPhase('pending', 40, 5, 120)).toBe('swipe')
  })

  it('軸を判定する距離に届くまではスワイプにならない', () => {
    expect(nextPhase('pending', AXIS_LOCK_DISTANCE - 1, 0, 100)).toBe('pending')
  })

  it('動かずに押し続けたら長押し', () => {
    expect(nextPhase('pending', 2, 3, LONG_PRESS_MS)).toBe('longpress')
  })

  it('指がブレていたら時間が経っても長押しにしない', () => {
    expect(nextPhase('pending', 11, 0, LONG_PRESS_MS + 500)).toBe('pending')
  })

  it('いったん確定した判定は変わらない(途中で意味が変わらない)', () => {
    expect(nextPhase('scroll', 200, 0, 100)).toBe('scroll')
    expect(nextPhase('swipe', 0, 300, 2000)).toBe('swipe')
    expect(nextPhase('longpress', 300, 300, 3000)).toBe('longpress')
  })
})

describe('swipeVisual(指を離す前に何が起きるか見える)', () => {
  it('左へ払うと削除、右へ払うと編集', () => {
    expect(swipeVisual(-60).action).toBe('delete')
    expect(swipeVisual(60).action).toBe('edit')
  })

  it('少し動かすとラベルが見え始める', () => {
    expect(swipeVisual(SWIPE_REVEAL_DISTANCE - 1).revealed).toBe(false)
    expect(swipeVisual(SWIPE_REVEAL_DISTANCE).revealed).toBe(true)
  })

  it('実行される距離まで引くと「離せば実行」の表示になる', () => {
    expect(swipeVisual(SWIPE_COMMIT_DISTANCE - 1).armed).toBe(false)
    expect(swipeVisual(-SWIPE_COMMIT_DISTANCE).armed).toBe(true)
  })

  it('引きすぎても上限で止まる', () => {
    expect(swipeVisual(999).offset).toBe(SWIPE_MAX_OFFSET)
    expect(swipeVisual(-999).offset).toBe(-SWIPE_MAX_OFFSET)
  })
})

describe('committedAction(誤操作しにくいしきい値)', () => {
  it('中途半端な距離では何も起きない', () => {
    expect(committedAction(40)).toBeNull()
    expect(committedAction(-40)).toBeNull()
  })

  it('しきい値を超えて初めて実行される', () => {
    expect(committedAction(SWIPE_COMMIT_DISTANCE)).toBe('edit')
    expect(committedAction(-SWIPE_COMMIT_DISTANCE)).toBe('delete')
  })
})

describe('shouldFireTap', () => {
  it('スワイプ・スクロール・長押しのあとはタップしない(二重に反応させない)', () => {
    expect(shouldFireTap('pending')).toBe(true)
    expect(shouldFireTap('swipe')).toBe(false)
    expect(shouldFireTap('scroll')).toBe(false)
    expect(shouldFireTap('longpress')).toBe(false)
  })
})
