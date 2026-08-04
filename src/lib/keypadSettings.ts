// ============================================================
// 自前テンキーを使うかどうかの設定(端末ごと)
// タッチ端末では OS のキーボードより自前テンキーの方が速いが、
// PC では物理キーボードの方が速いので、既定は端末の種類で決める。
// 明示的に選んだ場合はそれを優先する。
// ============================================================

import { useSyncExternalStore } from 'react'

/** auto = 端末の種類で決める / on = 常にテンキー / off = 常に OS のキーボード */
export type KeypadPreference = 'auto' | 'on' | 'off'

const STORAGE_KEY = 'kakeibo.keypadPreference'

/**
 * 設定と端末の性質から、テンキーを出すかどうかを決める。(純粋関数)
 * coarsePointer は matchMedia('(pointer: coarse)') の結果 = 指で操作する端末か。
 */
export function resolveKeypadEnabled(pref: KeypadPreference, coarsePointer: boolean): boolean {
  if (pref === 'on') return true
  if (pref === 'off') return false
  return coarsePointer
}

/** 指で操作する端末か。matchMedia が無い環境(テスト等)では false */
export function isCoarsePointer(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

function loadPreference(): KeypadPreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'on' || raw === 'off' || raw === 'auto') return raw
  } catch {
    // localStorage が使えない環境では既定(auto)で動かす
  }
  return 'auto'
}

let preference: KeypadPreference = loadPreference()
const listeners = new Set<() => void>()

export function getKeypadPreference(): KeypadPreference {
  return preference
}

export function setKeypadPreference(pref: KeypadPreference): void {
  preference = pref
  try {
    localStorage.setItem(STORAGE_KEY, pref)
  } catch {
    // 保存できなくてもこのセッションでは反映される
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 現在の設定値。設定シートでの変更に追従する */
export function useKeypadPreference(): KeypadPreference {
  return useSyncExternalStore(subscribe, getKeypadPreference, getKeypadPreference)
}

/** 実際にテンキーを表示するか。設定と端末の性質の両方を見る */
export function useKeypadEnabled(): boolean {
  const pref = useKeypadPreference()
  return resolveKeypadEnabled(pref, isCoarsePointer())
}
