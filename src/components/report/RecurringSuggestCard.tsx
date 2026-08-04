import { useMemo, useState } from 'react'
import type { Transaction } from '../../lib/types'
import { formatDate, yen } from '../../lib/format'
import { categoryLabel } from '../../lib/categories'
import { describeRecurrence, nextOccurrenceOnOrAfter } from '../../lib/recurrence'
import { addRecurringRule, isRecurringUnavailable, useRecurringRules } from '../../lib/recurringRules'
import {
  buildRuleInputFromCandidate,
  detectRecurringCandidates,
  dismissSuggestion,
  useDismissedSuggestions,
  type RecurringCandidate,
} from '../../lib/recurringInsights'
import { getSupabase } from '../../lib/supabaseClient'

interface Props {
  transactions: Transaction[]
  today: string
}

/** 一度に出す提案の数。並べすぎると「片付ける作業」になって読まれなくなる */
const MAX_SHOWN = 3

/**
 * 定期支出の自動検出と登録提案 (機能081)。
 *
 * **提案しかしない。** 登録は必ずこのカードのボタン(+確認ダイアログ)を経る。
 * 誤検出で繰り返し入力が勝手に増えると、身に覚えのない支出が自動生成されて
 * 家計が狂う — 取り返しがつかない方向の失敗なので、自動登録は一切しない。
 */
export default function RecurringSuggestCard({ transactions, today }: Props) {
  const rules = useRecurringRules()
  const dismissed = useDismissedSuggestions()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const candidates = useMemo(
    () => detectRecurringCandidates(transactions, rules, today, dismissed),
    [transactions, rules, today, dismissed]
  )

  const supabase = getSupabase()
  // 登録できない状況(未設定・テーブル無し)で提案だけ出しても行き止まりなので出さない
  if (isRecurringUnavailable() || supabase === null) return null
  if (candidates.length === 0) return null

  const register = async (c: RecurringCandidate) => {
    const input = buildRuleInputFromCandidate(c, today)
    const next = nextOccurrenceOnOrAfter(input.recurrence, input.startDate)
    const ok = confirm(
      `「${c.store}」を繰り返し入力に登録します。\n\n` +
        `${describeRecurrence(input.recurrence)} ・ ${yen(input.amount)}\n` +
        `カテゴリ: ${categoryLabel(input.category)}\n` +
        `${next ? `次回 ${formatDate(next)} から自動で記録されます` : ''}\n` +
        `(すでに入力済みの過去の分は作られません)\n\n` +
        'あとから設定の「繰り返し入力」で変更・削除できます。'
    )
    if (!ok) return
    setBusyKey(c.key)
    setError(null)
    try {
      await addRecurringRule(supabase, input)
      // 登録すると rules に載るので、この候補は次の描画で自動的に消える
    } catch (e) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setError('繰り返し入力の登録はオンライン時のみ可能です')
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="card">
      <h2>繰り返しの登録候補</h2>
      <p className="muted">
        過去の記録から「定期的な支払いかもしれない」ものを探しました。
        <strong>推測なので外れることがあります。</strong>
        登録するまで何も自動では記録されません。
      </p>
      {error && <p className="error-text">{error}</p>}

      <ul className="rp-suggest-list">
        {candidates.slice(0, MAX_SHOWN).map((c) => (
          <li key={c.key} className="rp-suggest-row">
            <div className="rp-suggest-main">
              <span className="rp-suggest-title">{c.store}</span>
              <span className="rp-suggest-sub">
                {describeRecurrence(c.recurrence)}ごろ・
                <span className="rp-num">約{yen(c.medianAmount)}</span>
                {c.recurrence.kind !== 'monthly' && (
                  <>(月あたり 約{yen(c.monthlyEquivalent)})</>
                )}
              </span>
              {/* 何を根拠にそう言っているのかを必ず出す(鵜呑みにさせないため) */}
              <span className="rp-suggest-evidence">
                根拠:過去{c.occurrences}回・間隔は約{c.medianIntervalDays}日・直近は{' '}
                {formatDate(c.lastDate)}・カテゴリ {categoryLabel(c.category)}
              </span>
            </div>
            <div className="rp-suggest-actions">
              <button
                className="btn-primary rp-suggest-add"
                disabled={busyKey !== null}
                onClick={() => void register(c)}
              >
                {busyKey === c.key ? '登録中…' : '繰り返しに登録'}
              </button>
              <button
                className="btn-ghost rp-suggest-skip"
                disabled={busyKey !== null}
                onClick={() => dismissSuggestion(c.key)}
              >
                今は不要
              </button>
            </div>
          </li>
        ))}
      </ul>
      {candidates.length > MAX_SHOWN && (
        <p className="muted">ほかに{candidates.length - MAX_SHOWN}件の候補があります(順に出します)</p>
      )}
    </div>
  )
}
