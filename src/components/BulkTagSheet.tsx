// ============================================================
// 選んだ記録に、まとめてタグを付ける / 外す(共通のシート)
//
// ---- なぜ1つに切り出したか ----
// 入り口は2つある:
//   ・レポート → タグ別 → 「回ごと」の行(report/EventTagSheet が呼ぶ)
//   ・履歴の複数選択 → 「タグ」(HistoryTab が呼ぶ)
// 見せるものも守ることも完全に同じなので、**同じ見た目のシートを2つ** 置くと
// 「確認を出す」「上限で落ちた件数を伝える」のどちらか片方だけ直す事故が起きる。
// 違うのは呼び名(この回 / 選んだ35件)と説明文だけなので、そこだけ props で受ける。
//
// ---- 必ず守っていること(どちらの入り口からでも同じ) ----
//   ・**付ける前に件数を見せて、確認を取ってから**実行する(35件が一度に変わる)
//   ・すでに付いている記録は書き換えない(中身の無い変更履歴を残さない)
//   ・タグの上限(5個)で付けられなかった件数は、**黙って飛ばさず**必ず伝える
//   ・書き込みは呼び出し元の updateMany(= オフラインキュー経由)。1件ずつ op が
//     積まれるので、途中で通信が切れても記録は失われない
//   ・付け間違えたら、同じ入り口からまとめて外せる
// 判断そのものは lib/bulkTags.ts(純粋関数)にあり、ここは表示の組み立てだけ。
// ============================================================

import { useState, type ReactNode } from 'react'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import type { TransactionInput } from '../hooks/useTransactions'
import type { Transaction } from '../lib/types'
import { normalizeTag } from '../lib/tags'
import {
  bulkTagConfirmText,
  bulkTagDoneText,
  bulkTagUpdates,
  planAddTag,
  planRemoveTag,
  tagsOnTransactions,
  type BulkTagPlan,
} from '../lib/bulkTags'

interface Props {
  /** タグを付け外しする対象 */
  targets: readonly Transaction[]
  /**
   * 対象の呼び名。「この回」「選んだ35件」など。
   * 見出し・外す欄の見出し・読み上げ名はすべてこれから作る(言い回しをそろえるため)
   */
  scopeLabel: string
  /** 見出しの下の説明。何のためにタグを付けるのかは入り口ごとに違う */
  lead: ReactNode
  /** 候補の見出し(「前に使った行き先」「よく使うタグ」) */
  suggestionsLabel: string
  /** タグの候補(打ち直さずに済むように) */
  suggestions: readonly string[]
  /** ここからは外せないタグ。渡さなければ全部外せる */
  keepTags?: readonly string[]
  /** 外せないことの断り書き(理由は入り口ごとに違う) */
  keepNote?: ReactNode
  onApply: (updates: { id: string; input: TransactionInput }[]) => void
  onClose: () => void
}

type Pending = { plan: BulkTagPlan; mode: 'add' | 'remove' }

export default function BulkTagSheet({
  targets,
  scopeLabel,
  lead,
  suggestionsLabel,
  suggestions,
  keepTags = [],
  keepNote,
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
          <h2>{scopeLabel}にタグを付ける</h2>
          <button type="button" className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <p className="muted">{lead}</p>

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
            <span>{suggestionsLabel}</span>
            <div className="trip-tag-options" role="group" aria-label={suggestionsLabel}>
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
          <div className="bulk-tag-confirm" role="status">
            <p className="bulk-tag-confirm-text">{bulkTagConfirmText(pending.plan, pending.mode)}</p>
            <div className="bulk-tag-actions">
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
          <p className="muted bulk-tag-done" role="status">
            ✅ {done}
          </p>
        )}

        {/* 付け間違えたときの逃げ道。35件に付けたものを1件ずつ剥がすのは現実的でない */}
        {attached.length > 0 && (
          <div className="settings-section">
            <h3>{scopeLabel}のタグを外す</h3>
            <div
              className="trip-tag-options"
              role="group"
              aria-label={`${scopeLabel}に付いているタグ`}
            >
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
              {keepTags.length > 0 && keepNote}
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
