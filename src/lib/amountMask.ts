// ============================================================
// 金額の目隠し (機能169)
//
// ワンタップで画面上の金額を伏字にする。人前でアプリを開くための機能。
//
// 「アプリ切替時に画面を隠す」(機能208) とは別物なので混ぜないこと:
//   208 … アプリを離れている間だけ、画面全体を自動で覆う。自分では出せない
//   169 … 自分の意思で切り替える。画面は開いたまま、金額だけを伏字にする
//
// ---- 状態をどう届けるか ----
// 金額の整形 (format.ts の yen / signedYen) は「文字列を返す関数」なので、
// React の Context では受け取れない (関数の呼び出し側は props も hooks も持たない)。
// そこでこのモジュールに1つだけ状態を置き、format.ts はそれを読む。
// 画面の更新は MainScreen が useSyncExternalStore で購読して丸ごと描き直す
// (keypadSettings.ts と同じ作法)。CSS で伏せる案は採らなかった:
// text が DOM に残ったままだと、開発者ツール・読み上げ・テキスト選択・
// スクリーンショットの OCR から金額が読めてしまうため。
// この方式なら、伏せている間は金額の文字列がそもそも DOM に存在しない。
// ============================================================

import { useSyncExternalStore } from 'react'

export const AMOUNT_MASK_KEY = 'kakeibo.amountMask'

/**
 * 伏字(通常の金額用)。
 * 金額によらず必ず同じ文字列にする — `¥1,234` → `¥•,•••` のように
 * 桁区切りを残すと桁数(= おおよその金額)が読めてしまうため。
 */
export const MASKED_AMOUNT = '¥•••••'

/**
 * 伏字(グラフの軸・カレンダーの日別合計など、¥ を付けずに数字だけ出している狭い場所用)。
 * こちらも中身によらず固定長。
 */
export const MASKED_COMPACT = '•••'

/**
 * 保存値から目隠し中かどうかを決める。(純粋関数)
 *
 * 既定は「表示」。金額を隠す機能なのに既定を隠す側にしないのは、
 * この目隠しが「人が近づいた瞬間に自分で押すもの」だから。
 * 既定で隠れていると、自分ひとりで開く大多数の場面で毎回1タップ増えるうえ、
 * 数字が読めないアプリが初期状態になり「壊れている」と誤解させる。
 * のぞき見全般への備えは、既定オンの機能208(アプリ切替時の覆い)が受け持つ。
 *
 * 一方で、いったんオンにした状態は端末に保存して再読み込みをまたいで残す
 * (人前でリロードやアプリの再起動が起きたときに、勝手に金額が戻っては困る)。
 */
export function parseMasked(raw: string | null): boolean {
  return raw === 'on'
}

/** localStorage に書く文字列 */
export function serializeMasked(masked: boolean): string {
  return masked ? 'on' : 'off'
}

/** 金額表記を、目隠し中なら伏字に置き換える。(純粋関数) */
export function maskedAmountText(plain: string, masked: boolean): string {
  return masked ? MASKED_AMOUNT : plain
}

/**
 * 符号付きの金額表記を伏字に置き換える。(純粋関数)
 * 符号は残す — 増えたか減ったかは金額を明かさないし、
 * 残すことで「何の表示か分からない伏字」になるのを避けられる。
 */
export function maskedSignedText(sign: string, plain: string, masked: boolean): string {
  return masked ? `${sign}${MASKED_AMOUNT}` : plain
}

/**
 * 短い数字表記(軸ラベル等)を伏字に置き換える。(純粋関数)
 * 空文字(支出のない日など)はそのまま返す — 何も無い場所に伏字を置くと、
 * 「隠された値がある」という誤った情報を足してしまうため。
 */
export function maskedCompactText(plain: string, masked: boolean): string {
  if (plain === '') return ''
  return masked ? MASKED_COMPACT : plain
}

/**
 * すでに組み立てられた文章の中の金額だけを伏せる。(純粋関数)
 *
 * 変更履歴 (機能163) のように「保存された時点の文字列」をそのまま出す画面のためのもの。
 * 保存されている文字列は素のままでなければならない (後から真実を読めなくなる) ので、
 * 表示の直前にここで差し替える。`¥` 付きの数字だけを対象にし、
 * 日付や件数のような他の数字は触らない。
 */
export function maskedTextAmounts(text: string, masked: boolean): string {
  if (!masked) return text
  return text.replace(/¥[0-9,]+/g, MASKED_AMOUNT)
}

/** ヘッダーの切り替えボタンの読み上げ名。押すとどうなるかを名前にする */
export function amountMaskToggleLabel(masked: boolean): string {
  return masked ? '金額を表示する' : '金額を隠す'
}

/**
 * 設定画面に出す現在の状態の一行説明。(純粋関数)
 *
 * 機能208 の説明 (privacyBlurStateLabel) と役割の違いが分かる言い方にする。
 * 「守れる」と書かないのは、伏せられるのはこのアプリが描いた金額だけで、
 * スクリーンショットや画面収録、他のアプリの通知までは面倒を見られないため。
 */
export function amountMaskStateLabel(masked: boolean): string {
  return masked
    ? 'いま画面の金額を伏字にしています'
    : '画面の金額をそのまま表示しています'
}

// ---------- 端末ごとの設定 (localStorage) ----------

function readStorage(): string | null {
  try {
    return localStorage.getItem(AMOUNT_MASK_KEY)
  } catch {
    // プライベートブラウズ等で localStorage が使えなくても、
    // このセッションの中では切り替えられるようにする
    return null
  }
}

function writeStorage(value: string): void {
  try {
    localStorage.setItem(AMOUNT_MASK_KEY, value)
  } catch {
    // 保存できなくても、このセッションの表示は切り替わる
  }
}

let masked = parseMasked(readStorage())
const listeners = new Set<() => void>()

/** いま金額を伏せているか。format.ts から毎回の整形で呼ばれる */
export function isAmountMasked(): boolean {
  return masked
}

export function setAmountMasked(next: boolean): void {
  if (masked === next) return
  masked = next
  writeStorage(serializeMasked(next))
  for (const l of listeners) l()
}

export function toggleAmountMask(): void {
  setAmountMasked(!masked)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * いま金額を伏せているか(購読つき)。
 * 画面のどこか1つがこれを読んでいれば、その配下は切り替えのたびに描き直される。
 */
export function useAmountMasked(): boolean {
  return useSyncExternalStore(subscribe, isAmountMasked, isAmountMasked)
}
