// ============================================================
// 繰り返し(定期)入力の登録と自動生成 (機能070)
//
// 保存先は Supabase の recurring_rules + localStorage キャッシュ
// (categories.ts と同じ「モジュールレベルのストア + useSyncExternalStore」構成)。
// 日付の計算は recurrence.ts の純粋関数に任せ、ここは永続化と生成の手順だけを持つ。
// ============================================================

import { useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TransactionInput } from '../hooks/useTransactions'
import { isSchemaError } from './serverErrors'
import { throwOnServerError } from './errorGuidance'
import { pendingOccurrences, type Recurrence, type RecurrenceKind } from './recurrence'
import { hasGeneratedMark, recordGeneratedMark } from './recurringLedger'

export interface RecurringRule {
  id: string
  /** 一覧に出す名前(例: 家賃) */
  title: string
  recurrence: Recurrence
  amount: number
  category: string | null
  store: string
  memo: string
  partnerAmount: number
  startDate: string
  /** この日までは生成済み。null なら一度も生成していない */
  lastGeneratedDate: string | null
  /** false = 停止中(生成しない) */
  active: boolean
}

/** 新規登録の入力値(id と生成状況はストア側が付ける) */
export type RecurringRuleInput = Omit<RecurringRule, 'id' | 'lastGeneratedDate'>

// ---------- 純粋関数 ----------

/** ルールと日付から、登録する取引の内容を組み立てる。(純粋関数) */
export function buildRecurringTransaction(rule: RecurringRule, date: string): TransactionInput {
  return {
    date,
    type: 'expense',
    amount: rule.amount,
    category: rule.category,
    memo: rule.memo,
    store: rule.store,
    // 総額を超える負担分は保存できないので、念のためここでも丸める
    partner_amount: Math.max(0, Math.min(rule.partnerAmount, rule.amount)),
    source: 'recurring',
  }
}

/** 各ルールの未生成分を平坦化する。(純粋関数) */
export function planGeneration(
  rules: readonly RecurringRule[],
  today: string
): { rule: RecurringRule; dates: string[] }[] {
  const out: { rule: RecurringRule; dates: string[] }[] = []
  for (const rule of rules) {
    const dates = pendingOccurrences(
      {
        active: rule.active,
        recurrence: rule.recurrence,
        startDate: rule.startDate,
        lastGeneratedDate: rule.lastGeneratedDate,
      },
      today
    )
    if (dates.length > 0) out.push({ rule, dates })
  }
  return out
}

// ---------- localStorage キャッシュ ----------

const CACHE_KEY = 'kakeibo.recurringRules'

function loadCache(): RecurringRule[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RecurringRule[]) : []
  } catch {
    return []
  }
}

function saveCache(rows: RecurringRule[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(rows))
  } catch {
    // 容量超過等は無視(キャッシュはあくまで補助)
  }
}

// ---------- モジュールレベルのストア ----------

let rules: RecurringRule[] = loadCache()
const listeners = new Set<() => void>()

// recurring_rules テーブルが無い(マイグレーション未実行)場合は true。
// 繰り返し入力の画面を出さず、生成も試みない = 既存の入力には一切触らない。
let tableMissing = false

function setRules(rows: RecurringRule[]): void {
  rules = rows
  saveCache(rows)
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): RecurringRule[] {
  return rules
}

export function useRecurringRules(): RecurringRule[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** テーブルが無いと分かっているか(設定シートの表示可否に使う) */
export function isRecurringUnavailable(): boolean {
  return tableMissing
}

// ---------- Supabase 連携 ----------

interface RecurringRuleRow {
  id: string
  title: string
  kind: string
  day_of_month: number | null
  weekday: number | null
  month_of_year: number | null
  amount: number
  category: string | null
  store: string | null
  memo: string | null
  partner_amount: number | null
  start_date: string
  last_generated_date: string | null
  active: boolean
}

function fromRow(r: RecurringRuleRow): RecurringRule {
  return {
    id: r.id,
    title: r.title,
    recurrence: {
      kind: (r.kind === 'weekly' || r.kind === 'yearly' ? r.kind : 'monthly') as RecurrenceKind,
      dayOfMonth: r.day_of_month,
      weekday: r.weekday,
      monthOfYear: r.month_of_year,
    },
    amount: r.amount,
    category: r.category,
    store: r.store ?? '',
    memo: r.memo ?? '',
    partnerAmount: r.partner_amount ?? 0,
    startDate: r.start_date,
    lastGeneratedDate: r.last_generated_date,
    active: r.active,
  }
}

function toRow(rule: RecurringRuleInput): Omit<RecurringRuleRow, 'id' | 'last_generated_date'> {
  return {
    title: rule.title,
    kind: rule.recurrence.kind,
    day_of_month: rule.recurrence.kind === 'weekly' ? null : rule.recurrence.dayOfMonth,
    weekday: rule.recurrence.kind === 'weekly' ? rule.recurrence.weekday : null,
    month_of_year: rule.recurrence.kind === 'yearly' ? rule.recurrence.monthOfYear : null,
    amount: rule.amount,
    category: rule.category,
    store: rule.store,
    memo: rule.memo,
    partner_amount: rule.partnerAmount,
    start_date: rule.startDate,
    active: rule.active,
  }
}

const SELECT_COLUMNS =
  'id, title, kind, day_of_month, weekday, month_of_year, amount, category, store, memo, partner_amount, start_date, last_generated_date, active'

/**
 * Supabase からルールを読み込む。
 * テーブルが無ければ静かに無効化する(マイグレーション未実行でも
 * 既存の記録・入力は一切妨げない)。失敗時はキャッシュのまま継続。
 */
export async function initRecurringRules(supabase: SupabaseClient): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('recurring_rules')
      .select(SELECT_COLUMNS)
      .order('created_at', { ascending: true })
    if (error) {
      if (isSchemaError(error)) {
        tableMissing = true
        // 別環境のキャッシュが残っていても、テーブルが無い以上は使わせない
        setRules([])
      }
      return
    }
    tableMissing = false
    setRules(((data ?? []) as unknown as RecurringRuleRow[]).map(fromRow))
  } catch {
    // ネットワーク例外等 — キャッシュのまま継続
  }
}

/** ルールを追加する。編集系はオンライン前提で、失敗時は throw する */
export async function addRecurringRule(
  supabase: SupabaseClient,
  input: RecurringRuleInput
): Promise<void> {
  const { data, error } = await supabase
    .from('recurring_rules')
    .insert(toRow(input))
    .select(SELECT_COLUMNS)
    .single()
  throwOnServerError(error)
  if (!data) throw new Error('繰り返し入力を登録できませんでした。通信が不安定な可能性があります。もう一度お試しください')
  setRules([...rules, fromRow(data as unknown as RecurringRuleRow)])
}

export async function updateRecurringRule(
  supabase: SupabaseClient,
  id: string,
  input: RecurringRuleInput
): Promise<void> {
  const { error } = await supabase.from('recurring_rules').update(toRow(input)).eq('id', id)
  throwOnServerError(error)
  setRules(rules.map((r) => (r.id === id ? { ...r, ...input, id, lastGeneratedDate: r.lastGeneratedDate } : r)))
}

/** 停止 / 再開。停止中は生成されない */
export async function setRecurringRuleActive(
  supabase: SupabaseClient,
  id: string,
  active: boolean
): Promise<void> {
  const { error } = await supabase.from('recurring_rules').update({ active }).eq('id', id)
  throwOnServerError(error)
  setRules(rules.map((r) => (r.id === id ? { ...r, active } : r)))
}

export async function deleteRecurringRule(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('recurring_rules').delete().eq('id', id)
  throwOnServerError(error)
  setRules(rules.filter((r) => r.id !== id))
}

/**
 * 未生成分をまとめて生成する。アプリを開いたときに1回だけ呼ぶ。
 *
 * 手順が肝心: **先に last_generated_date をサーバーへ書き込み、成功したときだけ**
 * 取引を積む。逆順にすると、書き込みに失敗した次回起動で同じ日をもう一度
 * 生成してしまう。取引側はオフラインキュー経由なので、積んだあとに通信が
 * 切れても失われない(重複生成の回避を、生成漏れの回避より優先している)。
 *
 * この優先順位は変えていない。副作用として残る「印だけ進んで取引が無い」状態は、
 * 生成のたびに端末へ控えを残し(recurringLedger.ts)、起動時に突き合わせて
 * **あとから積み直す**ことで手当てする。行IDを自分で採って控えに残しておくのは、
 * 積み直しのときに同じIDを使うため — 万一二重に積んでも、同じIDの行は
 * データベースの主キーが弾く。家賃が2件になることはこの一点で防いでいる。
 *
 * 戻り値は生成した件数。テーブルが無い・オフライン・未生成なしなら 0。
 */
export async function generateDueTransactions(
  supabase: SupabaseClient,
  today: string,
  enqueue: (input: TransactionInput, id?: string) => Promise<void>
): Promise<number> {
  if (tableMissing) return 0
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0

  let generated = 0
  for (const { rule, dates } of planGeneration(rules, today)) {
    try {
      // 「読んだときの last_generated_date のままなら書き換える」という条件付き更新。
      // 別の端末が先に生成していた場合は1行も更新されないので、そこで諦める
      const query = supabase.from('recurring_rules').update({ last_generated_date: today })
      const scoped =
        rule.lastGeneratedDate === null
          ? query.is('last_generated_date', null)
          : query.eq('last_generated_date', rule.lastGeneratedDate)
      const { data, error } = await scoped.eq('id', rule.id).select('id')
      if (error) {
        if (isSchemaError(error)) tableMissing = true
        continue // 生成済みの印を残せないうちは作らない
      }
      if (!data || data.length === 0) continue // 他の端末が先に生成した
    } catch {
      continue
    }
    setRules(rules.map((r) => (r.id === rule.id ? { ...r, lastGeneratedDate: today } : r)))
    for (const date of dates) {
      // 念のための二重生成止め。印が何らかの理由で巻き戻っても、
      // 同じ(ルール, 日)の控えがすでにあれば作らない
      if (hasGeneratedMark(rule.id, date)) continue
      const input = buildRecurringTransaction(rule, date)
      const txId = crypto.randomUUID()
      // 控えは **積む前に** 残す。積んだあとに残すと、控えを残せないまま
      // op だけが失われたときに「作ったはずのもの」を誰も知らない状態になる
      recordGeneratedMark({ ruleId: rule.id, date, txId, input })
      await enqueue(input, txId)
      generated += 1
    }
  }
  return generated
}
