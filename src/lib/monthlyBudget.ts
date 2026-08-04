// ============================================================
// 月の予算(端末ごと・機能026の参照線の基準)
//
// サーバーに列を足すと他の作業とぶつかるため、この設定は端末の
// localStorage にだけ置く(keypadSettings.ts と同じ作り)。
// 未設定を「0」ではなく null で表すのが肝心 — 0 を予算として扱うと
// 「1円でも使えば使いすぎ」という無意味な参照線になってしまう。
// ============================================================

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'kakeibo.monthlyBudget'

/** 入力文字列を予算として読む。(純粋関数) 未設定・不正・0以下は null */
export function parseBudget(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null
  return n
}

function load(): number | null {
  try {
    return parseBudget(localStorage.getItem(STORAGE_KEY))
  } catch {
    // localStorage が使えない環境では未設定として扱う(過去平均に自動で切り替わる)
    return null
  }
}

let budget: number | null = load()
const listeners = new Set<() => void>()

export function getMonthlyBudget(): number | null {
  return budget
}

/** null を渡すと設定を消す(= 過去平均から参照線を引く状態に戻る) */
export function setMonthlyBudget(value: number | null): void {
  budget = value
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, String(value))
  } catch {
    // 保存できなくてもこのセッションでは反映される
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useMonthlyBudget(): number | null {
  return useSyncExternalStore(subscribe, getMonthlyBudget, getMonthlyBudget)
}
