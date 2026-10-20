import type { Ref } from 'react'
import { IconUndo } from './historyIcons'

interface Props {
  /** 取り消せる件数 */
  count: number
  onUndo: () => void
  /** 履歴タブは一覧の下にバーの高さぶんの余白を空けるので、実測用に受け取る */
  barRef?: Ref<HTMLDivElement>
}

/**
 * 削除直後の「元に戻す」 (機能159)。
 *
 * 削除は確認を出さず、消したあとの数秒だけ取り消せる、という作りにしている。
 * その約束は **どのタブから消しても** 成り立たないといけない —
 * 履歴タブにしかこのバーが無かったころは、彼女タブから開いた記録を
 * 編集シートで消すと、確認も取り消しも無いまま消えていた。
 * 取り消せる状態そのものは useTransactions が持っているので、ここは表示だけ。
 */
export default function UndoDeleteBar({ count, onUndo, barRef }: Props) {
  return (
    <div ref={barRef} className="hist-bottom-bar hist-undo-bar" role="status">
      <span className="hist-bar-text">{count === 1 ? '1件を削除しました' : `${count}件を削除しました`}</span>
      <button className="hist-bar-undo" onClick={onUndo}>
        <IconUndo /> 元に戻す
      </button>
    </div>
  )
}
