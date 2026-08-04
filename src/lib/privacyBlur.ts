// ============================================================
// アプリ切替時に画面を隠す (機能208) — 判定と設定の純粋関数
//
// 「離れている間だけ隠す」の判定をここに集約し、DOM を触る処理 (privacyShield.ts)
// から切り離してテストできるようにしている。
// ============================================================

/** 画面の状態。document.hidden と window のフォーカスの2つだけで決める */
export type ScreenState = {
  /** document.hidden 相当。タブが裏に回った / アプリが背面に行った */
  hidden: boolean
  /** window がフォーカスを持っているか (document.hasFocus() 相当) */
  focused: boolean
}

/**
 * 目隠しを出すか。(純粋関数)
 *
 * hidden だけを見ないのは、iOS Safari のタブ一覧やアプリスイッチャーの
 * 呼び出しでは visibilitychange より先に window の blur だけが来ることがあるため。
 * 「見えていないかもしれない」側に倒して、フォーカスを失った時点で隠す。
 */
export function shouldShield(state: ScreenState): boolean {
  return state.hidden || !state.focused
}

// ---------- 設定 (localStorage) ----------

export const PRIVACY_BLUR_KEY = 'kakeibo.privacyBlur'
export const PRIVACY_BLUR_HINT_KEY = 'kakeibo.privacyBlurHintCount'

/**
 * 保存値から有効・無効を決める。(純粋関数)
 * 既定は「オン」。金額を隠す機能なので、知らないうちに無防備になる側の既定は選ばない。
 */
export function parseEnabled(raw: string | null): boolean {
  return raw !== 'off'
}

/** localStorage に書く文字列 */
export function serializeEnabled(enabled: boolean): string {
  return enabled ? 'on' : 'off'
}

/** 目隠しが出た回数。壊れた値・未設定は 0 として扱う */
export function parseHintCount(raw: string | null): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** 「もう隠さない」への導線を出すか。最初の数回だけ出し、以降は黙る */
export const HINT_LIMIT = 3

export function shouldShowHint(count: number): boolean {
  return count < HINT_LIMIT
}
