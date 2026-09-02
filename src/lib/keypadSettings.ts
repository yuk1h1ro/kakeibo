// ============================================================
// 自前テンキーを使うかどうかの設定(端末ごと)
// タッチ端末では OS のキーボードより自前テンキーの方が速いが、
// PC では物理キーボードの方が速いので、既定は端末の種類で決める。
// 明示的に選んだ場合はそれを優先する。
// ============================================================

import { useSyncExternalStore } from 'react'
import { createLocalSetting } from './localSetting'

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

const setting = createLocalSetting<KeypadPreference>({
  key: STORAGE_KEY,
  fallback: 'auto',
  // 知らない文字列(古い版・手で書き換えた値)は既定に倒す
  parse: (raw) => (raw === 'on' || raw === 'off' || raw === 'auto' ? raw : null),
  serialize: (pref) => pref,
})

export function getKeypadPreference(): KeypadPreference {
  return setting.get()
}

export function setKeypadPreference(pref: KeypadPreference): void {
  setting.set(pref)
}

/** 現在の設定値。設定シートでの変更に追従する */
export function useKeypadPreference(): KeypadPreference {
  return useSyncExternalStore(setting.subscribe, setting.get, setting.get)
}

/** 実際にテンキーを表示するか。設定と端末の性質の両方を見る */
export function useKeypadEnabled(): boolean {
  const pref = useKeypadPreference()
  return resolveKeypadEnabled(pref, isCoarsePointer())
}
