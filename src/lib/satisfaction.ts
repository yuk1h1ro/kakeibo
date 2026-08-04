// ============================================================
// 感情スタンプ (機能219 + 143)
//
// transactions.satisfaction という1列だけを、
//   - 入力フォームの1タップ(219)
//   - あとからまとめて仕分ける画面(143)
//   - レポートの振り返り
// の3か所で共有する。データを二重に持たない。
//
// この列は migration-satisfaction.sql を実行するまで存在しない。
// 未実行のまま値を送ると同期が止まり、入力した記録が滞留してしまうので、
// 「列があるか」を起動時に確かめ、無ければ静かに機能ごと無効化する
// (店名の学習・テンプレートと同じ考え方)。
// ============================================================

import { useSyncExternalStore } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Satisfaction, Transaction } from './types'
import { satisfactionOf } from './types'
import { isSplitPart } from './splits'
import { isSchemaError } from './serverErrors'

export interface SatisfactionOption {
  value: Satisfaction
  label: string
  emoji: string
  /** 仕分け画面で「何をしたか」を短く返すときの言い回し */
  done: string
}

// 並びは「良い → 普通 → 悪い」で固定。入力・仕分け・レポートで同じ順に出す
export const SATISFACTION_OPTIONS: readonly SatisfactionOption[] = [
  { value: 'good', label: '満足', emoji: '😊', done: '満足にしました' },
  { value: 'neutral', label: '普通', emoji: '😐', done: '普通にしました' },
  { value: 'regret', label: '後悔', emoji: '😣', done: '後悔にしました' },
]

// ---------- 純粋関数 ----------

export function satisfactionLabel(value: Satisfaction | null): string {
  return SATISFACTION_OPTIONS.find((o) => o.value === value)?.label ?? '未設定'
}

/**
 * まとめて仕分ける対象(機能143)。スタンプが未設定の支出を新しい順に返す。(純粋関数)
 * 古い記録ほど「どう感じたか」を思い出せないので、新しい順のまま上限で打ち切る。
 *
 * 分割した会計 (機能096) は束ねごとに代表1件だけを返す。分割は
 * 「1回の買い物をカテゴリで割った行」なので、そのまま並べると同じ店・同じ日の
 * 断片が N 件続けて出てきて、同じ買い物に何度も同じ気分を付けさせることになる。
 * 代表に付けた気分は、呼び出し側が同じ束ねの行すべてに書く
 * (SatisfactionSortSheet の groupOf)。
 */
export function pendingSatisfactionTargets(
  txs: readonly Transaction[],
  limit = 100
): Transaction[] {
  const pending = txs
    .filter((t) => t.type === 'expense' && satisfactionOf(t) === null)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))

  const seenGroups = new Set<string>()
  const out: Transaction[] = []
  for (const t of pending) {
    if (isSplitPart(t)) {
      const group = t.split_group as string
      if (seenGroups.has(group)) continue
      seenGroups.add(group)
    }
    out.push(t)
    if (out.length >= limit) break
  }
  return out
}

/**
 * satisfaction を含まない送信内容を作る。(純粋関数)
 * undefined を入れるのではなくキーごと落とす — 列が無いDBに対して
 * キーが存在するだけで PostgREST が弾くため。
 */
export function withoutSatisfaction<T extends { satisfaction?: Satisfaction | null }>(
  payload: T
): Omit<T, 'satisfaction'> {
  const { satisfaction: _omit, ...rest } = payload
  return rest
}

// ---------- 列があるかどうか(端末ごとの実行時判定) ----------

let columnMissing = false
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

/** 列が無い(マイグレーション未実行)と分かっている状態か */
export function isSatisfactionUnavailable(): boolean {
  return columnMissing
}

/** 同期時に列が無いと分かったときに呼ぶ。以後この列は送らない */
export function markSatisfactionUnavailable(): void {
  if (columnMissing) return
  columnMissing = true
  notify()
}

function getSnapshot(): boolean {
  return !columnMissing
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 感情スタンプの導線を出してよいか。列が無いと分かった時点で消える */
export function useSatisfactionAvailable(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * 起動時に列の有無を1回だけ確かめる。
 * 通信できないときは判定を変えない — オフラインで機能が消えるほうが不便で、
 * 実際に送るときには同期側でも同じ判定をするため安全側に倒せる。
 */
export async function initSatisfaction(supabase: SupabaseClient): Promise<void> {
  try {
    const { error } = await supabase.from('transactions').select('satisfaction').limit(1)
    if (error) {
      if (isSchemaError(error)) markSatisfactionUnavailable()
      return
    }
    if (columnMissing) {
      columnMissing = false
      notify()
    }
  } catch {
    // ネットワーク例外等 — 判定は据え置き
  }
}
