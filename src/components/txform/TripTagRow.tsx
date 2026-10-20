import { tripTagsText, type TripMode } from '../../lib/tripMode'

interface Props {
  mode: TripMode
  /** この記録に実際に付くタグ。「この1件だけ外す」を押していれば空 */
  tags: readonly string[]
  onToggleSkip: () => void
}

/**
 * 旅行モードがオンのときだけ、保存ボタンのすぐ上に「何が付くか」を出す。
 * ここに置くのは、押す直前に必ず目に入る最後の場所だから。
 * 同じ行が「この1件だけ外す」の操作も兼ねる — 旅行中でもコンビニで
 * 自分用のものを買うことはあり、そのために毎回モードを切る運用は続かない。
 */
export default function TripTagRow({ mode, tags, onToggleSkip }: Props) {
  const on = tags.length > 0
  return (
    <div className={`trip-tag-row${on ? '' : ' is-off'}`} aria-live="polite">
      <span className="trip-tag-row-text">
        {on ? (
          <>
            この記録に <strong>{tripTagsText(mode)}</strong> が自動で付きます
          </>
        ) : (
          <>
            この記録には <strong>{tripTagsText(mode)}</strong> を付けません
          </>
        )}
      </span>
      <button type="button" className="trip-tag-row-btn" aria-pressed={!on} onClick={onToggleSkip}>
        {on ? 'この1件だけ外す' : 'やっぱり付ける'}
      </button>
    </div>
  )
}
