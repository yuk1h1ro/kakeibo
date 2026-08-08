// ============================================================
// 「この回」にまとめて行き先タグを付ける / 外す
//
// ---- なぜレポートの「回ごと」から入るのか ----
// 共起タグのドリルダウンは「旅行」と「2026和歌山」が2つ付いていて初めて効くが、
// 行き先タグが自動で付くのは旅行モードを使ったときだけで、**すでに終わった旅行**
// には何も付いていない。先週の旅行35件を履歴から手で選ぶのは現実的ではない。
// レポートの「回ごと」はすでに 8月6日〜8月8日 の1回ぶんを特定できているので、
// その行から1タップで開けるようにした(選ぶ操作がゼロで済む)。
//
// ---- 必ず守っていること ----
//   ・**付ける前に件数を見せて、確認を取ってから**実行する(35件が一度に変わる)
//   ・すでに付いている記録は書き換えない(中身の無い変更履歴を残さない)
//   ・タグの上限(5個)で付けられなかった件数は、**黙って飛ばさず**必ず伝える
//   ・書き込みは updateMany(= オフラインキュー経由)。1件ずつ op が積まれるので、
//     途中で通信が切れても記録は失われない
//   ・付け間違えたら、同じ入り口からまとめて外せる
// ============================================================

import { useState } from 'react'
import useBodyScrollLock from '../../hooks/useBodyScrollLock'
import type { TransactionInput } from '../../hooks/useTransactions'
import type { Transaction } from '../../lib/types'
import { normalizeTag } from '../../lib/tags'
import {
  bulkTagConfirmText,
  bulkTagDoneText,
  bulkTagUpdates,
  planAddTag,
  planRemoveTag,
  tagsOnTransactions,
  type BulkTagPlan,
} from '../../lib/bulkTags'

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

type Pending = { plan: BulkTagPlan; mode: 'add' | 'remove' }

export default function EventTagSheet({
  targets,
  periodText,
  keepTags,
  suggestions,
  onApply,
  onClose,
}: Props) {
  useBodyScrollLock()
  const [draft, setDraft] = useState('')
  // 確認待ち。押した瞬間に35件が書き換わることのないよう、必ず1段挟む
  const [pending, setPending] = useState<Pending | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const drafted = normalizeTag(draft)
  const attached = tagsOnTransactions(targets, keepTags)

  const ask = (tag: string, mode: 'add' | 'remove') => {
    const plan = mode === 'add' ? planAddTag(targets, tag) : planRemoveTag(targets, tag)
    if (plan === null) return
    setDone(null)
    setPending({ plan, mode })
  }

  const run = () => {
    if (pending === null) return
    onApply(bulkTagUpdates(pending.plan, pending.mode))
    setDone(bulkTagDoneText(pending.plan, pending.mode))
    setPending(null)
    setDraft('')
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>この回にタグを付ける</h2>
          <button type="button" className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <p className="muted">
          {periodText}の <strong>{targets.length}件</strong> にまとめてタグを付けます。
          行き先の名前({keepTags.length > 0 ? `#${keepTags[0]}` : '旅行'} と一緒に付ける
          「2026和歌山」など)を付けておくと、レポートでこの旅行だけを選んで見られます。
        </p>

        <label className="field">
          <span>付けるタグ</span>
          <input
            type="text"
            aria-label="付けるタグ"
            placeholder="例: 2026和歌山"
            value={draft}
            autoComplete="off"
            onChange={(e) => {
              setDraft(e.target.value)
              setPending(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                ask(draft, 'add')
              }
            }}
          />
        </label>

        {suggestions.length > 0 && (
          <div className="field">
            <span>前に使った行き先</span>
            <div className="trip-tag-options" role="group" aria-label="前に使った行き先">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`trip-tag-option${drafted === s ? ' is-on' : ''}`}
                  onClick={() => {
                    setDraft(s)
                    setPending(null)
                  }}
                >
                  #{s}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          className="btn-primary"
          disabled={drafted === null}
          onClick={() => ask(draft, 'add')}
        >
          {drafted === null ? 'タグを打ってください' : `${targets.length}件に #${drafted} を付ける`}
        </button>

        {/* 押す前に「何件に何をするか」を必ず出す。飛ばす分の理由もここで言う */}
        {pending !== null && (
          <div className="rp-bulk-confirm" role="status">
            <p className="rp-bulk-confirm-text">{bulkTagConfirmText(pending.plan, pending.mode)}</p>
            <div className="rp-bulk-actions">
              <button type="button" className="btn-ghost" onClick={() => setPending(null)}>
                やめる
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={pending.plan.targets.length === 0}
                onClick={run}
              >
                {pending.mode === 'add' ? '付ける' : '外す'}
              </button>
            </div>
          </div>
        )}

        {done !== null && (
          <p className="muted rp-bulk-done" role="status">
            ✅ {done}
          </p>
        )}

        {/* 付け間違えたときの逃げ道。35件に付けたものを1件ずつ剥がすのは現実的でない */}
        {attached.length > 0 && (
          <div className="settings-section">
            <h3>この回のタグを外す</h3>
            <div className="trip-tag-options" role="group" aria-label="この回に付いているタグ">
              {attached.map((a) => (
                <button
                  key={a.tag}
                  type="button"
                  className="trip-tag-option"
                  onClick={() => ask(a.tag, 'remove')}
                >
                  #{a.tag}({a.count})
                </button>
              ))}
            </div>
            <p className="muted">
              押すと確認が出ます。
              {keepTags.length > 0 && (
                <>
                  いま選んでいる <strong>#{keepTags[0]}</strong>{' '}
                  はここからは外せません(この回そのものが一覧から消えてしまうため、履歴の明細から外してください)
                </>
              )}
            </p>
          </div>
        )}

        <p className="caveat">
          書き込みは1件ずつ順番に積まれ、通信できないときは復帰後に送られます。
          変更は「変更履歴」にも残ります。
        </p>
      </div>
    </div>
  )
}
