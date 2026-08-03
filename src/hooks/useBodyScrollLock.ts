import { useEffect } from 'react'
import { acquireBodyScrollLock } from '../lib/bodyScrollLock'

/**
 * モーダル(.modal-backdrop)を表示している間、背面ページのスクロールを止める。
 *
 * 参照カウント方式なので、複数のモーダルが同時に開いていても
 * 最後の1つが閉じるまでロックは解除されない。閉じたときは元のスクロール位置へ戻る。
 *
 * @param enabled false の間はロックしない(モーダルの開閉を props で持つ場合に使う)
 */
export default function useBodyScrollLock(enabled: boolean = true): void {
  useEffect(() => {
    if (!enabled) return
    return acquireBodyScrollLock()
  }, [enabled])
}
