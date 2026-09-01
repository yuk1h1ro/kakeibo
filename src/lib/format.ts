import {
  isAmountMasked,
  maskedAmountText,
  maskedCompactText,
  maskedSignedText,
  maskedTextAmounts,
} from './amountMask'

// ============================================================
// 金額の表記
//
// yen / signedYen は「画面に出す」ための関数で、金額の目隠し (機能169) が
// オンのときは伏字を返す。全画面の金額がここを通っているので、
// 各コンポーネントを書き換えずに一斉に伏せられる。
//
// Discord への通知文や変更履歴に残す文字列など、
// 「画面ではないもの」は目隠しの影響を受けてはいけない
// (伏字のまま送信・保存されてしまう)。そちらは *Plain を使うこと。
// ============================================================

/** 素の金額表記。保存・通知など、画面以外に出す文字列はこちらを使う */
export function yenPlain(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`
}

/** 素の符号付き金額表記。用途は yenPlain と同じ */
export function signedYenPlain(n: number): string {
  return n >= 0 ? `+${yenPlain(n)}` : `-${yenPlain(Math.abs(n))}`
}

/** 画面表示用の金額。目隠し中は桁数の分からない伏字になる */
export function yen(n: number): string {
  return maskedAmountText(yenPlain(n), isAmountMasked())
}

/** 画面表示用の符号付き金額。目隠し中も符号だけは残す */
export function signedYen(n: number): string {
  return maskedSignedText(n >= 0 ? '+' : '-', signedYenPlain(n), isAmountMasked())
}

/**
 * グラフの軸ラベルやカレンダーの日別合計のように、
 * yen を通さず数字だけを出している箇所を目隠しに追随させる。
 * 元の文字列(桁数・レイアウト計算)には手を入れず、表示の直前だけ差し替える。
 */
export function maskCompact(text: string): string {
  return maskedCompactText(text, isAmountMasked())
}

/**
 * 保存済みの文章(変更履歴など)に含まれる金額だけを伏せる。
 * 保存されている文字列自体は素のまま — 表示の直前でだけ差し替える。
 */
export function maskAmountsIn(text: string): string {
  return maskedTextAmounts(text, isAmountMasked())
}

// 'YYYY-MM-DD' → 'M月D日(曜)'
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const day = new Date(y, m - 1, d).getDay()
  const wd = ['日', '月', '火', '水', '木', '金', '土'][day]
  return `${m}月${d}日(${wd})`
}

// ローカルタイムの今日を 'YYYY-MM-DD' で返す
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ローカルタイムで n 日前の日付を 'YYYY-MM-DD' で返す(タイムゾーンのずれを避けるため年月日から組み立てる)
export function daysAgoISO(n: number): string {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 'YYYY-MM' 形式の月キー
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${y}年${m}月`
}

export function shortMonth(key: string): string {
  return `${Number(key.split('-')[1])}月`
}
