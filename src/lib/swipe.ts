// 左右スワイプ判定の純粋関数。
// 縦スクロールを邪魔しないことが最優先なので、判定はポインタを離したときに一度だけ行い、
// 移動中に preventDefault はしない(スクロールはブラウザに任せる)。

export type SwipeDirection = 'prev' | 'next'

/** 発火に必要な横移動量(px)。誤爆と取りこぼしの間を取った値 */
export const SWIPE_MIN_DISTANCE = 56
/** 横が縦の何倍動いたら「横スワイプ」とみなすか。縦スクロールを守るため厳しめ */
export const SWIPE_RATIO = 2
/** これより長く触っていたら、スワイプではなく「押さえて読んでいた」とみなす */
export const SWIPE_MAX_DURATION = 800

/**
 * ポインタの移動量から月送りの向きを返す。該当しなければ null。
 * dx > 0(右へ払う)は前の月、dx < 0(左へ払う)は次の月。紙をめくる向きに合わせている。
 */
export function swipeDirection(dx: number, dy: number, durationMs: number): SwipeDirection | null {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (durationMs > SWIPE_MAX_DURATION) return null
  if (ax < SWIPE_MIN_DISTANCE) return null
  if (ax <= ay * SWIPE_RATIO) return null
  return dx > 0 ? 'prev' : 'next'
}
