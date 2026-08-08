// ============================================================
// 旅行1回ぶんのまとめを Discord に送る画面
//
// この画面が引き受けるのは「見せる・確認を取る・進み具合を出す」だけ。
//   ・何を送るか(選別・整形・2,000文字での分割) … lib/tripSummary.ts
//   ・1通ずつの送信(間隔・再試行・止めどころ)  … lib/partnerBacklogSends.ts
//     (履歴のまとめ送信と**同じ関数**を呼ぶ。分割も間隔も再開も作り直さない)
//   ・「もう送った」の控え                        … lib/tripSummarySends.ts
//
// 必ず守ること:
//   1. **押す前に通数と1通目の実物を見せる。** 押した瞬間に彼女の通知欄が
//      いくつ埋まるのかを、知らないまま押させない
//   2. **送るのは彼女に関係する分だけ。** 共有ページ・既存の通知・履歴の
//      まとめ送信と同じ条件(partner_amount > 0 または partner_paid > 0)
//   3. **途中で失敗したら、残りだけ送り直せる。** 全部を送り直すと、
//      届いている分が彼女の通知欄に二度並ぶ
//   4. 画面の金額を伏字にしていても、**送る中身は伏せない**(彼女が読む文章)
// ============================================================

import { useMemo, useState } from 'react'
import useBodyScrollLock from '../../hooks/useBodyScrollLock'
import { categoryLabel } from '../../lib/categories'
import { formatDate, yen } from '../../lib/format'
import type { DateRange } from '../../lib/report'
import type { Transaction } from '../../lib/types'
import { discordFailureMessage, type DiscordFailure } from '../../lib/discordNotify'
import { sendMessagesInSequence } from '../../lib/partnerBacklogSends'
import { backlogProgressText } from '../../lib/partnerBacklog'
import { buildTripMessages, buildTripSummary, tripCurrentBalance } from '../../lib/tripSummary'
import {
  findTripSend,
  getTripSends,
  rememberTripSend,
  tripResendNotice,
  tripSendKey,
  useTripSends,
} from '../../lib/tripSummarySends'

interface Props {
  /** 未同期の分も含む、画面が持っている全件 */
  transactions: readonly Transaction[]
  /** この旅行を指すタグ(親 → 行き先) */
  tags: readonly string[]
  /** その回の期間 */
  range: DateRange
  onClose: () => void
}

type Phase = 'idle' | 'sending' | 'done' | 'failed'

export default function TripSummarySheet({ transactions, tags, range, onClose }: Props) {
  useBodyScrollLock()

  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState({ sent: 0, total: 0 })
  const [failure, setFailure] = useState<DiscordFailure | null>(null)
  // 途中で失敗したときに「残りだけ」送り直すための位置。0 なら先頭から
  const [resumeFrom, setResumeFrom] = useState(0)
  const [result, setResult] = useState<string | null>(null)

  const sends = useTripSends()
  const key = tripSendKey(tags, range)
  const previous = findTripSend(sends, key)
  // 「送り直し」の印は**開いた時点**で決める。送信の途中で控えが増えても、
  // 3通目だけ見出しが変わるようなことが起きないようにするため
  const [resend] = useState(() => findTripSend(getTripSends(), tripSendKey(tags, range)) !== null)

  const summary = useMemo(
    () => buildTripSummary(transactions, { tags, range, labelOf: categoryLabel }),
    [transactions, tags, range]
  )
  const currentBalance = useMemo(() => tripCurrentBalance(transactions), [transactions])
  // 押す前に「実物」を見せるため、ここで組み立ててしまう
  const plan = useMemo(
    () =>
      buildTripMessages({
        summary,
        currentBalance,
        // 2回目からは、彼女が「2回ぶん使った」と読み違えないよう見出しに印を付ける
        resend,
      }),
    [summary, currentBalance, resend]
  )

  const rest = plan.slice(resumeFrom)
  const sending = phase === 'sending'
  const canSend = rest.length > 0 && !sending

  const run = async () => {
    if (!canSend) return
    setPhase('sending')
    setProgress({ sent: 0, total: rest.length })
    setResult(null)
    setFailure(null)

    const outcome = await sendMessagesInSequence(rest, {
      onProgress: (sent, total) => setProgress({ sent, total }),
    })

    if (outcome.failure) {
      setPhase('failed')
      setFailure(outcome.failure)
      // 送れたところまでを覚える。もう一度押すと**残りだけ**が飛ぶ
      setResumeFrom(resumeFrom + outcome.sentMessages)
      setResult(
        outcome.sentMessages === 0
          ? `1通も送れませんでした(残り${rest.length}通)。まだ何も届いていません`
          : `${rest.length}通のうち${outcome.sentMessages}通目までが届きました。残りの${rest.length - outcome.sentMessages}通は、下のボタンでそのまま送り直せます`
      )
    } else {
      setPhase('done')
      setResumeFrom(plan.length)
      setResult(`${summary.entries.length}件を${plan.length}通に分けて送りました`)
    }
    // 送れた通が1通でもあれば控えに残す(次に開いたときに「送信済み」と出る)
    if (outcome.sentMessages > 0) {
      rememberTripSend({
        key,
        sentAt: new Date().toISOString(),
        entries: summary.entries.length,
        messages: resumeFrom + outcome.sentMessages,
      })
    }
  }

  const periodText =
    range.start === range.end
      ? formatDate(range.start)
      : `${formatDate(range.start)} 〜 ${formatDate(range.end)}`

  return (
    <div className="modal-backdrop" onClick={sending ? undefined : onClose}>
      <div className="modal-sheet backlog-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>この旅行のまとめを送る</h2>
          <button className="btn-ghost" onClick={onClose} disabled={sending}>
            閉じる
          </button>
        </div>

        <p className="muted">
          {tags.map((t) => `#${t}`).join(' ')}・{periodText}
          <br />
          <strong>彼女に関係する記録だけ</strong>
          (彼女の負担がある支出・彼女が払った回)を、共有ページとまったく同じ範囲で送ります。
          あなた個人の支出は1件も含みません
          {summary.skippedCount > 0 && `(この旅行では${summary.skippedCount}件を除きました)`}。
        </p>

        {previous !== null && (
          <p className="error-text backlog-warn" role="status">
            {tripResendNotice(previous, (iso) => new Date(iso).toLocaleString('ja-JP'))}
          </p>
        )}

        <div className="settings-section">
          <h3>送る内容</h3>
          <p className="muted">
            {/* 画面の数字はこのアプリの作法どおり目隠し(機能169)に従う。
                送る本文(下のプレビュー)は彼女が読む文章なので伏せない */}
            {summary.entries.length}件・彼女の負担の合計 <strong>{yen(summary.shareTotal)}</strong>
            {plan.length > 0 && (
              <>
                <br />
                <strong>{plan.length}通</strong>に分けて送ります
                {resumeFrom > 0 && rest.length > 0 && `(残り${rest.length}通)`}
              </>
            )}
          </p>

          {plan.length > 0 && (
            <>
              <p className="muted backlog-preview-label">
                1通目に届くもの({plan[0].text.length}文字)
              </p>
              <pre className="backlog-preview">{plan[0].text}</pre>
              {plan.length > 1 && (
                <details className="backlog-details">
                  <summary>最後の1通も見る</summary>
                  <pre className="backlog-preview">{plan[plan.length - 1].text}</pre>
                </details>
              )}
            </>
          )}

          {plan.length === 0 && (
            <p className="muted">
              この旅行に、彼女に関係する記録はありません(あなた個人の支出だけです)。
              送るものが無いので、通知は1通も飛びません
            </p>
          )}

          <button
            type="button"
            className="btn-primary backlog-run"
            disabled={!canSend}
            onClick={() => void run()}
          >
            {sending
              ? backlogProgressText(progress.sent, progress.total)
              : phase === 'failed'
                ? `残りの${rest.length}通を送る`
                : `Discord に送る(${summary.entries.length}件・${rest.length}通)`}
          </button>

          {sending && (
            <p className="muted backlog-progress" role="status" aria-live="polite">
              {backlogProgressText(progress.sent, progress.total)} —
              1通ずつ間隔を空けて送っています。このまま閉じずにお待ちください
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
            Discord は1通2,000文字までなので、長い旅行は自動で分けて送ります。まとめて投げると
            混雑して弾かれるため、<strong>1通ずつ間隔を空けて</strong>順番に送ります
            (履歴のまとめ送信とまったく同じ仕組みです)。
          </p>
          <p className="muted">
            同じ旅行を<strong>もう一度送ることもできます</strong>。そのときは見出しに
            「送り直し」と入るので、彼女が2回ぶんの支出と読み違えることはありません。
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
