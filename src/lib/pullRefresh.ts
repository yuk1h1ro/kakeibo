// ============================================================
// 引き下げて更新 + 最終同期時刻 (機能154)
//
// 「いつのデータを見ているのか」が分からないと、表示を信じられなくなる。
// バナー(オフライン/同期中/未同期)は "異常があるとき" の表示なので、
// こちらは "正常なときに、いつ取り込んだか" だけを静かに出す(役割を分ける)。
//
// iOS Safari のオーバースクロール(ゴムのように跳ねる動き)と喧嘩しないよう、
// 判定は「一番上にいて、下向きに引いたとき」だけに限る。
// ============================================================

/** これ以上引いたら更新する(px) */
export const PULL_TRIGGER_DISTANCE = 64

/** 指に付いてくる上限(px)。これ以上は伸びない */
export const PULL_MAX_DISTANCE = 92

/** 引き始めたと認めるまでの遊び(px)。縦スクロールの開始と区別する */
export const PULL_START_SLOP = 8

/**
 * 引き下げを始めてよいか。(純粋関数)
 * 一番上にいない・すでに更新中・下向きでない、のいずれかなら始めない。
 * ページが一番上でないときに横取りすると、通常のスクロールを壊してしまう。
 */
export function canStartPull(scrollTop: number, dy: number, busy: boolean): boolean {
  if (busy) return false
  if (scrollTop > 0) return false
  return dy > PULL_START_SLOP
}

/**
 * 指の移動量から、実際に表示をずらす量を出す。(純粋関数)
 * だんだん重くなる(0.5倍 + 上限)ことで「引ききった」感触を出す。
 */
export function pullOffset(dy: number): number {
  if (dy <= 0) return 0
  return Math.min(PULL_MAX_DISTANCE, dy * 0.5)
}

/** 指を離したときに更新するか。(純粋関数) */
export function shouldTriggerRefresh(offset: number): boolean {
  return offset >= PULL_TRIGGER_DISTANCE
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 最終同期時刻の表示。(純粋関数)
 *
 * 今日なら「10:32 に更新」、昨日以前は日付も出す。
 * 未取得(null)のときは null を返し、呼び出し側で何も出さない
 * (「まだ一度も取れていない」ことはバナー側の役割なので、ここでは黙る)。
 */
export function formatSyncedAt(iso: string | null, now: Date): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return `${time} に更新`
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  if (isYesterday) return `昨日 ${time} に更新`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${time} に更新`
}
