import { describe, expect, it } from 'vitest'
import { SWIPE_MIN_DISTANCE, swipeDirection } from './swipe'

describe('swipeDirection', () => {
  it('右へ払えば前の月、左へ払えば次の月', () => {
    expect(swipeDirection(120, 5, 200)).toBe('prev')
    expect(swipeDirection(-120, 5, 200)).toBe('next')
  })

  it('移動量が足りなければ発火しない(タップの誤爆防止)', () => {
    expect(swipeDirection(SWIPE_MIN_DISTANCE - 1, 0, 100)).toBe(null)
    expect(swipeDirection(0, 0, 100)).toBe(null)
  })

  it('縦の動きが大きいときは発火しない(縦スクロールを邪魔しない)', () => {
    expect(swipeDirection(80, 60, 200)).toBe(null)
    expect(swipeDirection(80, 39, 200)).toBe('prev') // 横が縦の2倍を超えれば横スワイプ
  })

  it('長く触っていた場合は発火しない', () => {
    expect(swipeDirection(200, 0, 1500)).toBe(null)
  })
})
