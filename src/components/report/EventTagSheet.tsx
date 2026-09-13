// ============================================================
// 「この回」にまとめて行き先タグを付ける / 外す
//
// ---- なぜレポートの「回ごと」から入るのか ----
// 共起タグのドリルダウンは「旅行」と「2026和歌山」が2つ付いていて初めて効くが、
// 行き先タグが自動で付くのは旅行モードを使ったときだけで、**すでに終わった旅行**
// には何も付いていない。レポートの「回ごと」はすでに 8月6日〜8月8日 の1回ぶんを
// 特定できているので、その行から1タップで開ける(選ぶ操作がゼロで済む)。
// ただし **すでに何かタグが付いている記録にしか入れない** 入り口なので、
// タグが1つも無い旅行は履歴の複数選択(HistoryTab)から付ける。
//
// ---- 中身は共通のシート ----
// 「件数を見せて確認を取る」「すでに付いている記録は飛ばす」「上限で付けられなかった
// 件数を伝える」は履歴側とまったく同じ。**同じシートを2つ持つと片方だけ直す事故**が
// 起きるので、中身は ../BulkTagSheet に置き、ここは「この回」に固有の言い回し
// (呼び名・説明文・外せないタグの断り書き)だけを渡す。
// ============================================================

import type { TransactionInput } from '../../hooks/useTransactions'
import type { Transaction } from '../../lib/types'
import BulkTagSheet from '../BulkTagSheet'

interface Props {
  /** この回の記録(タグを付け外しする対象) */
  targets: readonly Transaction[]
  /** 「8月6日 〜 8月8日」など、どの回かが分かる呼び名 */
  periodText: string
  /** いま選んでいるタグ。ここからは外せないようにする(回そのものが消えるため) */
  keepTags: readonly string[]
  /** 過去に使った行き先タグ(打ち直さずに済むように) */
  suggestions: readonly string[]
  onApply: (updates: { id: string; input: TransactionInput }[]) => void
  onClose: () => void
}

export default function EventTagSheet({
  targets,
  periodText,
  keepTags,
  suggestions,
  onApply,
  onClose,
}: Props) {
  return (
    <BulkTagSheet
      targets={targets}
      scopeLabel="この回"
      lead={
        <>
          {periodText}の <strong>{targets.length}件</strong> にまとめてタグを付けます。
          行き先の名前({keepTags.length > 0 ? `#${keepTags[0]}` : '旅行'} と一緒に付ける
          「2026和歌山」など)を付けておくと、レポートでこの旅行だけを選んで見られます。
        </>
      }
      suggestionsLabel="前に使った行き先"
      suggestions={suggestions}
      keepTags={keepTags}
      keepNote={
        <>
          いま選んでいる <strong>#{keepTags[0]}</strong>{' '}
          はここからは外せません(この回そのものが一覧から消えてしまうため、履歴の明細から外してください)
        </>
      }
      onApply={onApply}
      onClose={onClose}
    />
  )
}
