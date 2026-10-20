// ============================================================
// テンキーを開いたとき、打っている欄をテンキーより上に見せる
//
// 自前テンキー (機能052) は画面の下に固定で出る。初めての1件では、
// カテゴリを押すとテンキーが開くのに、金額欄はテンキーの **下に隠れた
// まま** だった(390x844 で欄が y=701〜762、テンキーが y=525〜844)。
// 1280 と打っても画面のどこにも出ず、金額を見ないまま保存することになる。
// 日付が今日以外のときに金額欄のすぐ下に出る「この記録は 昨日 で保存
// されます」も一緒に隠れていた。
//
// テンキーの高さぶんの余白は本文にもう足してある (body.keypad-open)。
// 足りなかったのは「開いたあとにそこまで動かす」ことだけ。
// ============================================================

/** 欄とテンキー・画面の上端との間に空ける隙間(px) */
export const REVEAL_MARGIN = 12

/**
 * 欄を見せるのに、どれだけスクロールすればよいか(下向きが正)。(純粋関数)
 *
 * - 欄そのもの (fieldTop) が上に隠れていれば、上へ戻す
 * - 見せたい範囲の下端 (revealBottom) がテンキーに掛かっていれば、下へ送る。
 *   ただし **欄そのものが上にはみ出すほどは送らない** — 狭い画面で
 *   見せたい範囲が入りきらないときは、打っている数字のほうを優先する
 */
export function revealScrollDelta(a: {
  fieldTop: number
  revealBottom: number
  viewTop: number
  viewBottom: number
  margin?: number
}): number {
  const margin = a.margin ?? REVEAL_MARGIN
  const topLimit = a.viewTop + margin
  const bottomLimit = a.viewBottom - margin
  if (a.fieldTop < topLimit) return a.fieldTop - topLimit
  if (a.revealBottom <= bottomLimit) return 0
  return Math.min(a.revealBottom - bottomLimit, a.fieldTop - topLimit)
}

/**
 * いちばん近いスクロールする祖先。無ければ null(= ページそのもの)。
 * 編集シート (.modal-sheet) は自分でスクロールするので、そちらを動かす。
 */
function nearestScroller(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const overflowY = getComputedStyle(p).overflowY
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return null
}

/**
 * 欄(と、その下に見せたい注意書き)を、テンキーより上へスクロールして見せる。
 * テンキーがまだ描かれていない・寸法が取れない環境では何もしない。
 */
export function revealAboveKeypad(field: HTMLElement, alsoShow: HTMLElement | null = null): void {
  const dock = document.querySelector('.keypad-dock')
  if (!dock) return
  const dockRect = dock.getBoundingClientRect()
  if (dockRect.height === 0) return

  const scroller = nearestScroller(field)
  const box = scroller?.getBoundingClientRect()
  const viewTop = box ? box.top : 0
  const viewBottom = Math.min(dockRect.top, box ? box.bottom : window.innerHeight)

  // 欄の見出し・保留中の式・税込ボタンまで含めて見せる(欄の入れ物ごと)
  const container = field.closest('.field') ?? field
  let revealBottom = container.getBoundingClientRect().bottom
  if (alsoShow) revealBottom = Math.max(revealBottom, alsoShow.getBoundingClientRect().bottom)

  const delta = revealScrollDelta({
    fieldTop: field.getBoundingClientRect().top,
    revealBottom,
    viewTop,
    viewBottom,
  })
  if (delta === 0) return
  if (scroller) scroller.scrollBy({ top: delta, behavior: 'smooth' })
  else window.scrollBy({ top: delta, behavior: 'smooth' })
}
