import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { categoryLabel, useCategories } from '../lib/categories'
import { formatDate, todayISO, yen } from '../lib/format'
import {
  WEEKDAY_NAMES,
  describeRecurrence,
  nextOccurrenceOnOrAfter,
  type Recurrence,
  type RecurrenceKind,
} from '../lib/recurrence'
import {
  addRecurringRule,
  deleteRecurringRule,
  setRecurringRuleActive,
  updateRecurringRule,
  useRecurringRules,
  type RecurringRule,
  type RecurringRuleInput,
} from '../lib/recurringRules'
import '../settings.css'
import { describeUnknownError, isOnlineNow } from '../lib/errorGuidance'

interface Props {
  supabase: SupabaseClient
  onClose: () => void
}

interface Draft {
  title: string
  kind: RecurrenceKind
  dayOfMonth: string
  weekday: string
  monthOfYear: string
  amount: string
  category: string
  store: string
  memo: string
  partnerAmount: string
  startDate: string
}

function emptyDraft(defaultCategory: string): Draft {
  return {
    title: '',
    kind: 'monthly',
    dayOfMonth: '1',
    weekday: '1',
    monthOfYear: '1',
    amount: '',
    category: defaultCategory,
    store: '',
    memo: '',
    partnerAmount: '',
    startDate: todayISO(),
  }
}

function draftFromRule(r: RecurringRule): Draft {
  return {
    title: r.title,
    kind: r.recurrence.kind,
    dayOfMonth: String(r.recurrence.dayOfMonth ?? 1),
    weekday: String(r.recurrence.weekday ?? 1),
    monthOfYear: String(r.recurrence.monthOfYear ?? 1),
    amount: String(r.amount),
    category: r.category ?? '',
    store: r.store,
    memo: r.memo,
    partnerAmount: r.partnerAmount > 0 ? String(r.partnerAmount) : '',
    startDate: r.startDate,
  }
}

function recurrenceOf(d: Draft): Recurrence {
  return {
    kind: d.kind,
    dayOfMonth: d.kind === 'weekly' ? null : Number(d.dayOfMonth),
    weekday: d.kind === 'weekly' ? Number(d.weekday) : null,
    monthOfYear: d.kind === 'yearly' ? Number(d.monthOfYear) : null,
  }
}

function toInput(d: Draft): RecurringRuleInput {
  const amount = Number(d.amount)
  return {
    title: d.title.trim(),
    recurrence: recurrenceOf(d),
    amount,
    category: d.category === '' ? null : d.category,
    store: d.store.trim(),
    memo: d.memo.trim(),
    partnerAmount: Math.min(Number(d.partnerAmount || 0), amount),
    startDate: d.startDate,
    active: true,
  }
}

function isValidDraft(d: Draft): boolean {
  const amount = Number(d.amount)
  if (!Number.isInteger(amount) || amount <= 0) return false
  if (d.title.trim() === '') return false
  const partner = Number(d.partnerAmount || 0)
  if (!Number.isInteger(partner) || partner < 0 || partner > amount) return false
  return true
}

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1)
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

/**
 * 繰り返し(定期)入力の管理画面 (機能070)。
 * 一覧・追加・編集・停止・削除。生成そのものはアプリ起動時に行う。
 */
export default function RecurringSettingsSheet({ supabase, onClose }: Props) {
  const rules = useRecurringRules()
  const categories = useCategories()
  const defaultCategory = categories[0]?.id ?? ''
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(defaultCategory))
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBodyScrollLock()

  // 登録の編集はオンライン前提。失敗はシート内の .error-text に表示する
  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setError('繰り返し入力の編集はオンライン時のみ可能です')
      } else {
        setError(describeUnknownError(e, isOnlineNow()))
      }
    } finally {
      setBusy(false)
    }
  }

  const startAdd = () => {
    setEditingId(null)
    setDraft(emptyDraft(defaultCategory))
    setShowForm(true)
    setError(null)
  }

  const startEdit = (r: RecurringRule) => {
    setEditingId(r.id)
    setDraft(draftFromRule(r))
    setShowForm(true)
    setError(null)
  }

  const save = () => {
    if (!isValidDraft(draft)) {
      setError('名前と金額を正しく入力してください')
      return
    }
    void run(async () => {
      if (editingId === null) {
        await addRecurringRule(supabase, toInput(draft))
      } else {
        const current = rules.find((r) => r.id === editingId)
        await updateRecurringRule(supabase, editingId, {
          ...toInput(draft),
          active: current?.active ?? true,
        })
      }
      setShowForm(false)
      setEditingId(null)
    })
  }

  const remove = (r: RecurringRule) => {
    if (!confirm(`「${r.title}」を削除しますか?すでに生成された記録は残ります`)) return
    void run(async () => {
      await deleteRecurringRule(supabase, r.id)
      if (editingId === r.id) setShowForm(false)
    })
  }

  const today = todayISO()

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>繰り返し入力</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <p className="muted">
          家賃やサブスクを登録すると、その日が来たときにアプリを開いた時点で自動的に記録されます
        </p>

        {error && <p className="error-text">{error}</p>}

        <ul className="rule-list">
          {rules.length === 0 && !showForm && (
            <li className="muted">まだ登録がありません</li>
          )}
          {rules.map((r) => {
            const next = nextOccurrenceOnOrAfter(r.recurrence, today)
            return (
              <li key={r.id} className={`rule-row ${r.active ? '' : 'rule-paused'}`}>
                <div className="rule-main">
                  <span className="rule-title">{r.title}</span>
                  <span className="rule-sub">
                    {describeRecurrence(r.recurrence)} ・ {yen(r.amount)} ・{' '}
                    {categoryLabel(r.category)}
                  </span>
                  <span className="rule-sub">
                    {r.active
                      ? next
                        ? `次回 ${formatDate(next)}`
                        : ''
                      : '停止中'}
                  </span>
                </div>
                <div className="rule-actions">
                  <button
                    className="btn-ghost cat-action"
                    disabled={busy}
                    onClick={() => void run(() => setRecurringRuleActive(supabase, r.id, !r.active))}
                  >
                    {r.active ? '停止' : '再開'}
                  </button>
                  <button className="btn-ghost cat-action" disabled={busy} onClick={() => startEdit(r)}>
                    編集
                  </button>
                  <button
                    className="btn-ghost cat-action cat-delete"
                    disabled={busy}
                    onClick={() => remove(r)}
                  >
                    削除
                  </button>
                </div>
              </li>
            )
          })}
        </ul>

        {showForm ? (
          <div className="rule-form">
            <h3>{editingId === null ? '+ 繰り返しを追加' : '繰り返しを編集'}</h3>

            <label className="field">
              <span>名前</span>
              <input
                type="text"
                placeholder="例: 家賃"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>

            <div className="field">
              <span>繰り返し</span>
              <div className="rule-kind">
                {(
                  [
                    { id: 'monthly', label: '毎月' },
                    { id: 'weekly', label: '毎週' },
                    { id: 'yearly', label: '毎年' },
                  ] as { id: RecurrenceKind; label: string }[]
                ).map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    className={`date-chip ${draft.kind === k.id ? 'selected' : ''}`}
                    onClick={() => setDraft({ ...draft, kind: k.id })}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rule-when">
              {draft.kind === 'yearly' && (
                <label className="field">
                  <span>月</span>
                  <select
                    value={draft.monthOfYear}
                    onChange={(e) => setDraft({ ...draft, monthOfYear: e.target.value })}
                  >
                    {MONTHS.map((m) => (
                      <option key={m} value={m}>
                        {m}月
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {draft.kind === 'weekly' ? (
                <label className="field">
                  <span>曜日</span>
                  <select
                    value={draft.weekday}
                    onChange={(e) => setDraft({ ...draft, weekday: e.target.value })}
                  >
                    {WEEKDAY_NAMES.map((w, i) => (
                      <option key={w} value={i}>
                        {w}曜
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="field">
                  <span>日にち</span>
                  <select
                    value={draft.dayOfMonth}
                    onChange={(e) => setDraft({ ...draft, dayOfMonth: e.target.value })}
                  >
                    {DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}日
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {draft.kind !== 'weekly' && Number(draft.dayOfMonth) > 28 && (
              <p className="muted">
                その日が無い月は月末に記録されます(例: 31日 → 2月は28日)
              </p>
            )}

            <label className="field">
              <span>金額(円)</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                placeholder="0"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              />
            </label>

            <label className="field">
              <span>カテゴリ</span>
              <select
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              >
                <option value="">未分類</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>お店(任意)</span>
              <input
                type="text"
                value={draft.store}
                onChange={(e) => setDraft({ ...draft, store: e.target.value })}
              />
            </label>

            <label className="field">
              <span>メモ(任意)</span>
              <input
                type="text"
                value={draft.memo}
                onChange={(e) => setDraft({ ...draft, memo: e.target.value })}
              />
            </label>

            <label className="field">
              <span>彼女の負担分(円・任意)</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                placeholder="0"
                value={draft.partnerAmount}
                onChange={(e) => setDraft({ ...draft, partnerAmount: e.target.value })}
              />
            </label>

            <label className="field">
              <span>開始日(この日より前は生成しません)</span>
              <input
                type="date"
                value={draft.startDate}
                onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
              />
            </label>

            <button className="btn-primary" disabled={busy} onClick={save}>
              {busy ? '保存中…' : '保存する'}
            </button>
            <button className="btn-ghost rule-cancel" disabled={busy} onClick={() => setShowForm(false)}>
              キャンセル
            </button>
          </div>
        ) : (
          <button className="btn-primary" disabled={busy} onClick={startAdd}>
            + 繰り返しを追加
          </button>
        )}
      </div>
    </div>
  )
}
