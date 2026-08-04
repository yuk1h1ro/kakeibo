// ============================================================
// 預かり残高の低下アラートのしきい値 (機能010)
//
// 端末ごとの設定として localStorage に持つ。理由:
//   - 「いくらを切ったら気になるか」は端末より人の感覚の問題だが、
//     この設定のために新しいテーブル(= 新しいマイグレーション)を増やすと、
//     未実行の環境で機能が消える面がまた1つ増える。
//   - 通知先の Discord Webhook も同じく端末ごとなので、粒度をそろえた。
// 判定そのもの(またいだ瞬間だけ鳴らす)は partnerBalance.ts の純粋関数。
// ============================================================

import { useSyncExternalStore } from 'react'
import { DEFAULT_LOW_BALANCE_THRESHOLD, normalizeThreshold } from './partnerBalance'

const STORAGE_KEY = 'kakeibo.lowBalanceThreshold'

export function loadLowBalanceThreshold(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_LOW_BALANCE_THRESHOLD
    const n = Number(raw)
    if (!Number.isFinite(n)) return DEFAULT_LOW_BALANCE_THRESHOLD
    return normalizeThreshold(n)
  } catch {
    return DEFAULT_LOW_BALANCE_THRESHOLD
  }
}

const listeners = new Set<() => void>()
let snapshot = loadLowBalanceThreshold()

export function setLowBalanceThreshold(value: number): void {
  const next = normalizeThreshold(value)
  try {
    localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    // 保存できなくても、この起動中は設定した値で動く
  }
  snapshot = next
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): number {
  return snapshot
}

/** いまのしきい値(円)。設定を変えると購読側が再描画される */
export function useLowBalanceThreshold(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
