// ============================================================
// 金額のリアルタイム桁区切り (機能050)
//
// 電卓(calc.ts)と自前テンキー(AmountKeypad)が扱う内部状態は
// 「数字だけの文字列」のまま変えず、カンマは表示の直前にだけ足す。
// こうしておけば計算・保存の経路は従来と一切変わらないので、
// 桁区切りの都合で金額が壊れることがない。
//
// React にも DOM にも依存しない純粋関数だけを置く(キャレット位置の計算も含む)。
// ============================================================

import { MAX_AMOUNT_DIGITS } from './calc'

/** 表示文字列に含まれる数字の個数 */
function countDigits(text: string): number {
  return (text.normalize('NFKC').match(/[0-9]/g) ?? []).length
}

/**
 * 内部状態(数字だけの文字列)を表示用に3桁区切りする。
 * 引き算の結果でマイナスになることがあるので符号は保つ。
 * 整形するだけで値は変えない(先頭の 0 も落とさない)。
 */
export function formatAmountDisplay(raw: string): string {
  if (raw === '') return ''
  const negative = raw.startsWith('-')
  const digits = (negative ? raw.slice(1) : raw).replace(/[^0-9]/g, '')
  if (digits === '') return negative ? '-' : ''
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return negative ? `-${grouped}` : grouped
}

/**
 * 入力欄の文字列を内部状態(数字だけの文字列)に直す。
 * - カンマ・空白・単位など数字以外は捨てる(貼り付け対策)
 * - 全角数字は半角に寄せる
 * - 先頭の 0 は落とす(テンキーの pressDigits と同じ扱いにする)
 * - 桁数の上限も calc と揃える(打ち間違いで桁が暴走しないように)
 */
export function normalizeAmountInput(text: string): string {
  const s = text.normalize('NFKC')
  const negative = /^\s*-/.test(s)
  const digits = s
    .replace(/[^0-9]/g, '')
    .replace(/^0+/, '')
    .slice(0, MAX_AMOUNT_DIGITS)
  if (digits === '') return ''
  return negative ? `-${digits}` : digits
}

/** 表示文字列で「n個目の数字の直後」にあたる位置 */
export function caretAfterDigits(display: string, n: number): number {
  if (n <= 0) return display.startsWith('-') ? 1 : 0
  let seen = 0
  for (let i = 0; i < display.length; i++) {
    if (display[i] >= '0' && display[i] <= '9') {
      seen += 1
      if (seen === n) return i + 1
    }
  }
  return display.length
}

/**
 * カンマだけを消したのか(= 直前の1文字削除が区切り文字だったか)を見分ける。
 * カンマは表示のためだけに在るので、消されたら数字ごと消したい
 * (そうしないとバックスペースが1回空振りして「消えない」と感じる)。
 */
function isSeparatorDeletion(prev: string, next: string, caret: number): boolean {
  return (
    next.length === prev.length - 1 &&
    caret > 0 &&
    prev[caret] === ',' &&
    next.slice(0, caret) === prev.slice(0, caret) &&
    next.slice(caret) === prev.slice(caret + 1)
  )
}

export interface AmountEdit {
  /** 内部状態にする数字だけの文字列 */
  raw: string
  /** 入力欄に入れ直す整形済みの文字列 */
  display: string
  /** 整形後のキャレット位置(数字の個数を基準に移し替えたもの) */
  caret: number
}

/**
 * 入力欄が編集されたときの、内部状態・表示・キャレット位置を求める。(純粋関数)
 *
 * キャレットは「文字位置」ではなく「キャレットより前にある数字の個数」を保存して
 * 移し替える。カンマが増減しても指した位置がずれないのはこのため。
 *
 * @param prevDisplay 編集前に入力欄へ表示していた文字列
 * @param nextValue   編集直後の入力欄の値(まだ整形されていない)
 * @param caretPos    編集直後のキャレット位置(selectionStart)
 */
export function applyAmountEdit(prevDisplay: string, nextValue: string, caretPos: number): AmountEdit {
  let value = nextValue
  let caret = Math.max(0, Math.min(caretPos, nextValue.length))

  if (isSeparatorDeletion(prevDisplay, nextValue, caret)) {
    value = value.slice(0, caret - 1) + value.slice(caret)
    caret -= 1
  }

  const digitsBefore = countDigits(value.slice(0, caret))
  const allDigits = value.normalize('NFKC').replace(/[^0-9]/g, '')
  // 先頭の 0 を落とすぶん、キャレットも同じだけ手前へ詰める
  const droppedZeros = allDigits.length - allDigits.replace(/^0+/, '').length

  const raw = normalizeAmountInput(value)
  const kept = raw.replace('-', '').length
  const display = formatAmountDisplay(raw)
  const index = Math.min(Math.max(digitsBefore - droppedZeros, 0), kept)

  return { raw, display, caret: caretAfterDigits(display, index) }
}
