// ============================================================
// 月の予算(端末ごと・機能026の参照線の基準)
//
// サーバーに列を足すと他の作業とぶつかるため、この設定は端末の
// localStorage にだけ置く(keypadSettings.ts と同じ作り)。
// 未設定を「0」ではなく null で表すのが肝心 — 0 を予算として扱うと
// 「1円でも使えば使いすぎ」という無意味な参照線になってしまう。
// ============================================================

import { useSyncExternalStore } from 'react'
import { createLocalSetting } from './localSetting'

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

const setting = createLocalSetting<number | null>({
  key: STORAGE_KEY,
  // localStorage が使えない環境では未設定として扱う(過去平均に自動で切り替わる)
  fallback: null,
  parse: parseBudget,
  // 未設定はキーごと消す。「0」を書いて残すと、次に読んだときに
  // 予算 0円 と区別できなくなる(冒頭のとおり、それは無意味な参照線になる)
  serialize: (value) => (value === null ? null : String(value)),
})

export function getMonthlyBudget(): number | null {
  return setting.get()
}

/** null を渡すと設定を消す(= 過去平均から参照線を引く状態に戻る) */
export function setMonthlyBudget(value: number | null): void {
  setting.set(value)
}

export function useMonthlyBudget(): number | null {
  return useSyncExternalStore(setting.subscribe, setting.get, setting.get)
}
