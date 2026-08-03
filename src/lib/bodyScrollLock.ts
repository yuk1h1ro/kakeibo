// モーダル表示中に背面ページがスクロールしないようにするロック。
//
// iOS Safari は `overflow: hidden` を body に付けただけでは背面のドラッグスクロールを
// 止めきれない(オーバーレイが position: fixed でも下のページが動く)。確実に止まるのは
// body 自体を position: fixed にして文書のスクロール可能領域を消す方法なので、それを使う。
// ただし fixed にした瞬間スクロール位置は 0 に戻ってしまうため、
//   - ロック時: 現在の scrollX / scrollY を保存し、body に top: -scrollY / left: -scrollX を当てて
//     「見えている場所」を据え置く
//   - 解除時: インラインスタイルを元に戻してから window.scrollTo(scrollX, scrollY) で復帰
// という手順を踏む。これで閉じた瞬間に先頭へ飛ぶことがない。
//
// 複数のモーダルが同時に開くケース(カテゴリ設定 → 別モーダル など)があるので参照カウント方式。
// 最初の acquire でだけ適用し、最後の release でだけ復元する。

interface SavedState {
  scrollX: number
  scrollY: number
  bodyPosition: string
  bodyTop: string
  bodyLeft: string
  bodyWidth: string
  bodyOverflow: string
  htmlScrollBehavior: string
}

let lockCount = 0
let saved: SavedState | null = null

function isDomAvailable(): boolean {
  return typeof document !== 'undefined' && typeof window !== 'undefined'
}

function applyLock(): void {
  if (!isDomAvailable()) return
  const body = document.body
  const html = document.documentElement
  const scrollX = window.scrollX || 0
  const scrollY = window.scrollY || 0

  saved = {
    scrollX,
    scrollY,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyLeft: body.style.left,
    bodyWidth: body.style.width,
    bodyOverflow: body.style.overflow,
    htmlScrollBehavior: html.style.scrollBehavior,
  }

  // position: fixed で文書のスクロール可能領域そのものを無くす(縦・横とも動かなくなる)
  body.style.position = 'fixed'
  body.style.top = `${-scrollY}px`
  body.style.left = `${-scrollX}px`
  body.style.width = '100%'
  body.style.overflow = 'hidden'
  // scroll-behavior: smooth が効いていると復元がアニメーションして中途半端な位置で止まりうる
  html.style.scrollBehavior = 'auto'
}

function restore(): void {
  const s = saved
  saved = null
  if (!s || !isDomAvailable()) return
  const body = document.body
  const html = document.documentElement

  // 先にスタイルを戻して文書をスクロール可能な状態にしてから位置を復元する
  body.style.position = s.bodyPosition
  body.style.top = s.bodyTop
  body.style.left = s.bodyLeft
  body.style.width = s.bodyWidth
  body.style.overflow = s.bodyOverflow
  window.scrollTo(s.scrollX, s.scrollY)
  html.style.scrollBehavior = s.htmlScrollBehavior
}

/**
 * 背面スクロールをロックし、解除用の関数を返す。
 * 返り値は何度呼んでもカウントが壊れないよう、初回のみ有効。
 */
export function acquireBodyScrollLock(): () => void {
  lockCount += 1
  if (lockCount === 1) applyLock()

  let released = false
  return () => {
    if (released) return
    released = true
    lockCount -= 1
    if (lockCount <= 0) {
      lockCount = 0
      restore()
    }
  }
}

/** テスト用: 現在の参照カウント */
export function _lockCount(): number {
  return lockCount
}
