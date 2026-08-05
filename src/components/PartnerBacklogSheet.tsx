// ============================================================
// 預かり金の履歴を、まとめて Discord に送る画面
//
// Webhook URL が端末の中にしか無かったあいだ、スマホからの記録は1通も
// 通知されていなかった。彼女は過去の増減をほとんど知らない —— それを
// 追いつかせるための画面。
//
// ここが引き受けるのは「選ばせる・見せる・確認を取る・進み具合を出す」だけ。
//   ・何を送るか(選別・残高・整形・2,000文字での分割) … lib/partnerBacklog.ts
//   ・どこまで送ったか / 逐次送信                      … lib/partnerBacklogSends.ts
// どちらも純粋関数と単体テストで固めてある。
//
// この画面で必ず守ること:
//   1. **押す前に件数と通数を見せる。** 押した瞬間に彼女の通知欄が
//      何通で埋まるのかを、知らないまま押させない
//   2. **送信中であることを出す。** 100件なら数秒〜十数秒かかる。
//      無言だと壊れたと思って二度押しされる
//   3. **既定は「前回の続き」。** 二度目に開いたときに全部を送り直させない
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { categoryLabel } from '../lib/categories'
import { formatDate } from '../lib/format'
import { discordFailureMessage, type DiscordFailure } from '../lib/discordNotify'
import type { Transaction } from '../lib/types'
import {
  backlogCurrentBalance,
  backlogDoneText,
  backlogMonths,
  backlogPartialText,
  backlogProgressText,
  backlogYears,
  buildBacklogEntries,
  buildBacklogMessages,
  describeBacklogRange,
  filterBacklogEntries,
  isSameBacklogRange,
  type BacklogRange,
} from '../lib/partnerBacklog'
import {
  EMPTY_BACKLOG_STATE,
  fetchBacklogState,
  isBacklogSyncUnavailable,
  runBacklogSend,
  type BacklogSendState,
} from '../lib/partnerBacklogSends'
import '../settings.css'

interface Props {
  supabase: SupabaseClient
  /** 未同期の分も含む、画面が持っている全件 */
  transactions: readonly Transaction[]
  onClose: () => void
}

type Phase = 'idle' | 'sending' | 'done' | 'failed'

export default function PartnerBacklogSheet({ supabase, transactions, onClose }: Props) {
  useBodyScrollLock()

  // 前回どこまで送ったか。読み込めるまでは null(この間は送信ボタンを出さない —
  // カーソルを知らないまま送ると、送信済みの分をもう一度送ってしまう)
  const [state, setState] = useState<BacklogSendState | null>(null)
  const [range, setRange] = useState<BacklogRange>({ kind: 'since' })
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState({ sent: 0, total: 0 })
  const [result, setResult] = useState<string | null>(null)
  const [failure, setFailure] = useState<DiscordFailure | null>(null)

  useEffect(() => {
    let alive = true
    void fetchBacklogState(supabase).then((s) => {
      if (alive) setState(s)
    })
    return () => {
      alive = false
    }
  }, [supabase])

  const cursor = state?.cursor ?? null

  // 彼女に見せる明細と、その時点の残高。残高の計算は partnerBalance.ts に一本化
  const entries = useMemo(
    () => buildBacklogEntries(transactions, categoryLabel),
    [transactions]
  )
  const currentBalance = useMemo(() => backlogCurrentBalance(transactions), [transactions])
  const years = useMemo(() => backlogYears(entries), [entries])
  const months = useMemo(() => backlogMonths(entries), [entries])

  const rangeLabel = describeBacklogRange(range, cursor)
  const target = useMemo(
    () => filterBacklogEntries(entries, range, cursor),
    [entries, range, cursor]
  )
  // 押す前に「実物」を見せるため、ここで組み立ててしまう(件数が多くても数ミリ秒)
  const plan = useMemo(
    () => buildBacklogMessages({ entries: target, currentBalance }),
    [target, currentBalance]
  )

  const sending = phase === 'sending'
  const canSend = state !== null && plan.length > 0 && !sending

  const run = async () => {
    if (!canSend) return
    setPhase('sending')
    setProgress({ sent: 0, total: plan.length })
    setResult(null)
    setFailure(null)

    const outcome = await runBacklogSend(supabase, plan, state ?? EMPTY_BACKLOG_STATE, {
      onProgress: (sent, total) => setProgress({ sent, total }),
    })
    // 送れたところまでを画面の状態にも反映する。これで期間の既定(前回の続き)が
    // 「まだ送っていない分」だけになり、同じものをもう一度押せなくなる
    setState(outcome.state)
    if (outcome.failure) {
      setPhase('failed')
      setFailure(outcome.failure)
      setResult(
        backlogPartialText(outcome.sentMessages, outcome.totalMessages, outcome.sentEntries)
      )
    } else {
      setPhase('done')
      setResult(backlogDoneText(outcome.sentEntries, outcome.sentMessages))
    }
    // 続きから送り直せるよう、送ったあとは必ず「前回の続き」に戻す
    setRange({ kind: 'since' })
  }

  const chip = (r: BacklogRange, label: string, key: string) => {
    const isSelected = isSameBacklogRange(range, r)
    return (
      <button
        key={key}
        type="button"
        className={`date-chip ${isSelected ? 'selected' : ''}`}
        aria-pressed={isSelected}
        disabled={sending}
        onClick={() => setRange(r)}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="modal-backdrop" onClick={sending ? undefined : onClose}>
      <div className="modal-sheet backlog-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>これまでの履歴をまとめて送る</h2>
          <button className="btn-ghost" onClick={onClose} disabled={sending}>
            閉じる
          </button>
        </div>

        <p className="muted">
          預かり残高の増減を、Discord にまとめて送ります。
          <strong>彼女に関係する記録だけ</strong>
          (預かり・返金・調整と、彼女の負担がある支出・彼女が払った回)を、
          共有ページと同じ範囲で送ります。あなた個人の支出は1件も含みません。
        </p>

        <div className="settings-section">
          <h3>どこから送るか</h3>
          <div className="csv-range">
            {chip({ kind: 'since' }, cursor ? '前回の続き' : 'まだ送っていない分', 'since')}
            {chip({ kind: 'all' }, '全期間(送り直す)', 'all')}
            {years.map((y) => chip({ kind: 'year', value: y }, `${Number(y)}年`, y))}
          </div>

          {/* 月は数が多いのでチップにせず選択欄にする(CSV 書き出しと同じ作法) */}
          {months.length > 0 && (
            <label className="csv-month">
              <span className="muted">月を選ぶ</span>
              <select
                className="csv-month-select"
                disabled={sending}
                value={range.kind === 'month' ? range.value : ''}
                onChange={(e) => {
                  if (e.target.value) setRange({ kind: 'month', value: e.target.value })
                }}
              >
                <option value="">(選んでいません)</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {describeBacklogRange({ kind: 'month', value: m }, cursor)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {state && (
            <p className="muted backlog-last">
              {state.lastSentAt
                ? `前回の送信: ${new Date(state.lastSentAt).toLocaleString('ja-JP')}(これまでに${state.sentEntries}件・${state.sentMessages}通)`
                : 'まだ一度も送っていません'}
            </p>
          )}
          {isBacklogSyncUnavailable() && (
            <p className="error-text backlog-warn" role="status">
              送った記録をこの端末にしか残せません(<code>supabase/migration-partner-backlog.sql</code>
              が未実行です)。送信そのものは動きますが、
              <strong>別の端末から開くと「前回の続き」が分かりません</strong>
            </p>
          )}
        </div>

        <div className="settings-section">
          <h3>送る内容</h3>
          {/* 押す前に必ず「何件・何通」を出す。押した瞬間に彼女の通知欄が
              いくつ埋まるのかを、知らないまま押させないため */}
          <p className="muted">
            {rangeLabel}の記録 <strong>{target.length}件</strong> を{' '}
            <strong>{plan.length}通</strong>{' '}
            に分けて送ります
            {target.length > 0 && (
              <>
                <br />
                {formatDate(target[0].date)} 〜 {formatDate(target[target.length - 1].date)}
              </>
            )}
          </p>

          {plan.length > 0 && (
            <>
              <p className="muted backlog-preview-label">1通目に届くもの({plan[0].text.length}文字)</p>
              <pre className="backlog-preview">{plan[0].text}</pre>
              {plan.length > 1 && (
                <details className="backlog-details">
                  <summary>最後の1通も見る</summary>
                  <pre className="backlog-preview">{plan[plan.length - 1].text}</pre>
                </details>
              )}
            </>
          )}

          <button
            type="button"
            className="btn-primary backlog-run"
            disabled={!canSend}
            onClick={() => void run()}
          >
            {sending
              ? backlogProgressText(progress.sent, progress.total)
              : `Discord に送る(${target.length}件・${plan.length}通)`}
          </button>

          {/* 送信中であることを、ボタンの外にも出す。数十秒かかることがあるので、
              画面が固まったのではないと分かるようにする */}
          {sending && (
            <p className="muted backlog-progress" role="status" aria-live="polite">
              {backlogProgressText(progress.sent, progress.total)} — 1通ずつ間隔を空けて送っています。
              このまま閉じずにお待ちください
            </p>
          )}

          {plan.length === 0 && state !== null && (
            <p className="muted">
              {range.kind === 'since' && cursor
                ? '前回の続きはありません(すべて送信済みです)'
                : 'この期間に、彼女に関係する記録はありません'}
            </p>
          )}

          {phase === 'done' && result && (
            <p className="muted backlog-result" role="status">
              ✅ {result}
            </p>
          )}
          {phase === 'failed' && result && (
            <p className="error-text backlog-result" role="status">
              {result}
            </p>
          )}
          {phase === 'failed' && failure && (
            <p className="error-text backlog-result">{discordFailureMessage(failure)}</p>
          )}
        </div>

        <div className="settings-section">
          <h3>送り方について</h3>
          <p className="muted">
            Discord は1通2,000文字までなので、長い履歴は自動で分けて送ります。
            まとめて投げると混雑して弾かれるため、
            <strong>1通ずつ間隔を空けて</strong>順番に送ります。
          </p>
          <p className="muted">
            途中で失敗しても、<strong>そこまで送れた分は覚えています</strong>。
            もう一度開いて「前回の続き」を送れば、届いていない分だけが送られます。
          </p>
          <p className="muted">
            画面の金額を伏字にしていても、<strong>送る中身は伏せません</strong>
            (彼女が読む文章のため)。
          </p>
        </div>
      </div>
    </div>
  )
}
