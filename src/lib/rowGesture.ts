// ============================================================
// 明細行のジェスチャー調停 (機能146 / 149 / 151)
//
// 同じ1行の上で「タップ(編集)」「左右スワイプ(削除・編集)」「長押し(メニュー)」
// 「複数選択」「縦スクロール」が重なる。何が起きるか予測できないリストは
// 触るのが怖くなるので、優先順位をここに1か所だけ書いて全部そこから決める。
//
//   0. 複数選択モード中は、行のタップ = チェックの ON/OFF だけ。
//      スワイプも長押しも無効(モードが最優先。選んでいる最中に消えないこと)
//   1. 縦に動いたらスクロール確定。以後この指ではスワイプも長押しも起きない
//      (一覧は縦に読むものなので、スクロールを一番に守る)
//   2. 横に十分動いたらスワイプ確定。長押しタイマーは取り消す
//   3. 動かさずに押し続けたら長押しメニュー。指を離してもタップは発火しない
//   4. どれでもなければタップ = これまでどおり編集シートを開く
//
// いったん確定した判定は指を離すまで変えない(途中で意味が変わらないこと)。
// ============================================================

/** これ以上押し続けたら長押し。短いと誤爆し、長いと反応が鈍く感じる */
export const LONG_PRESS_MS = 520

/** 長押し中に許す指のブレ(px)。これを超えたら長押しは取り消す */
export const LONG_PRESS_TOLERANCE = 10

/** 縦横どちらの操作か判定を始める移動量(px) */
export const AXIS_LOCK_DISTANCE = 12

/** 横が縦の何倍動いていたら「横スワイプ」とみなすか。縦スクロールを守るため厳しめ */
export const AXIS_RATIO = 1.4

/** 背面のラベル(削除/編集)が見え始める移動量(px) */
export const SWIPE_REVEAL_DISTANCE = 28

/** 指を離したときに実行される移動量(px)。半分近く引かないと実行されない = 誤操作しにくい */
export const SWIPE_COMMIT_DISTANCE = 88

/** 行が動く上限(px)。これ以上引いても付いてこない(引ききった感触を出す) */
export const SWIPE_MAX_OFFSET = 116

export type RowGesturePhase = 'pending' | 'swipe' | 'scroll' | 'longpress'

export type RowSwipeAction = 'edit' | 'delete'

/**
 * 次の判定を返す。(純粋関数)
 * 確定済み(pending 以外)なら、その判定を変えない。
 */
export function nextPhase(
  phase: RowGesturePhase,
  dx: number,
  dy: number,
  elapsedMs: number
): RowGesturePhase {
  if (phase !== 'pending') return phase
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  // 1. 縦優先 — 縦に動いていたらスクロール
  if (ay >= AXIS_LOCK_DISTANCE && ay * AXIS_RATIO >= ax) return 'scroll'
  // 2. 横に十分動いた & 縦よりはっきり大きい → スワイプ
  if (ax >= AXIS_LOCK_DISTANCE && ax > ay * AXIS_RATIO) return 'swipe'
  // 3. ほぼ動かずに押し続けている → 長押し
  if (elapsedMs >= LONG_PRESS_MS && ax < LONG_PRESS_TOLERANCE && ay < LONG_PRESS_TOLERANCE) {
    return 'longpress'
  }
  return 'pending'
}

/**
 * スワイプ中の見え方。(純粋関数)
 *
 * 左へ払う(dx < 0) = 削除、右へ払う(dx > 0) = 編集。
 * iOS のメールと同じ向きに合わせている(左払いで消える、が身についているため)。
 * armed が true の間だけ「離せば実行される」表示にして、
 * 指を離す前に何が起きるか分かるようにする。
 */
export function swipeVisual(dx: number): {
  offset: number
  action: RowSwipeAction | null
  revealed: boolean
  armed: boolean
} {
  const clamped = Math.max(-SWIPE_MAX_OFFSET, Math.min(SWIPE_MAX_OFFSET, dx))
  const ax = Math.abs(dx)
  return {
    offset: clamped,
    action: ax < 1 ? null : dx < 0 ? 'delete' : 'edit',
    revealed: ax >= SWIPE_REVEAL_DISTANCE,
    armed: ax >= SWIPE_COMMIT_DISTANCE,
  }
}

/** 指を離したときに実行する操作。届いていなければ null(= 何も起きずに戻る)。(純粋関数) */
export function committedAction(dx: number): RowSwipeAction | null {
  if (Math.abs(dx) < SWIPE_COMMIT_DISTANCE) return null
  return dx < 0 ? 'delete' : 'edit'
}

/**
 * 指を離したときにタップ(編集を開く)として扱ってよいか。(純粋関数)
 * スワイプ・スクロール・長押しのあとにタップまで起きると二重に反応してしまう。
 */
export function shouldFireTap(phase: RowGesturePhase): boolean {
  return phase === 'pending'
}
