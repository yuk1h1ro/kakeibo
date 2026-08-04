// ============================================================
// レシートの連続撮影 (機能064)
//
// 溜めたレシートを最大5枚まで撮り、1枚ずつ Gemini に投げて結果を並べる。
// 1枚の失敗が他の枚を止めないよう、状態は「枚ごと」に持つ。
// 読み取りの通信そのものは receiptScan.ts に任せ、ここは並びと状態遷移だけ。
// ============================================================

import type { ReceiptScanResult } from './receiptScan'

/** 無料枠とレート制限を踏まえた上限。Zaim と同じく5枚 */
export const MAX_RECEIPTS = 5

export type ReceiptItemStatus = 'pending' | 'scanning' | 'done' | 'failed'

export interface ReceiptItem {
  id: string
  file: File
  status: ReceiptItemStatus
  /** 失敗理由(再試行の判断材料としてそのまま出す) */
  error: string | null
  /** 読み取り後にユーザーが直せる値。金額は入力欄と同じく文字列で持つ */
  amount: string
  store: string
  date: string
  category: string | null
  /** 読み取れなかった項目の名前(「金額を読み取れませんでした」の表示用) */
  missing: string[]
}

/** これ以上撮影できるか。(純粋関数) */
export function canAddReceipt(items: readonly ReceiptItem[]): boolean {
  return items.length < MAX_RECEIPTS
}

/** 撮影した1枚を末尾に足す。上限を超える分は無視する。(純粋関数) */
export function addReceipt(
  items: readonly ReceiptItem[],
  id: string,
  file: File,
  date: string
): ReceiptItem[] {
  if (!canAddReceipt(items)) return [...items]
  return [
    ...items,
    {
      id,
      file,
      status: 'pending',
      error: null,
      amount: '',
      store: '',
      date,
      category: null,
      missing: [],
    },
  ]
}

/** 指定の1枚だけを書き換える。(純粋関数) */
export function updateReceipt(
  items: readonly ReceiptItem[],
  id: string,
  patch: Partial<ReceiptItem>
): ReceiptItem[] {
  return items.map((it) => (it.id === id ? { ...it, ...patch } : it))
}

/** 破棄。(純粋関数) */
export function removeReceipt(items: readonly ReceiptItem[], id: string): ReceiptItem[] {
  return items.filter((it) => it.id !== id)
}

/**
 * 次に読み取るべき1枚。(純粋関数)
 * 逐次実行(並列に投げない)ためのカーソルとして使う。失敗した枚は
 * ユーザーが再試行を押すまで pending に戻さないので、ここでは拾わない。
 */
export function nextPendingReceipt(items: readonly ReceiptItem[]): ReceiptItem | null {
  return items.find((it) => it.status === 'pending') ?? null
}

/**
 * 読み取り結果を1枚に反映する。(純粋関数)
 * 読めた項目だけ入れ、読めなかった項目は missing に残して手入力を促す。
 * カテゴリは店名から学習済みのものがあれば入れる(resolveCategory に委ねる)。
 */
export function applyScanResult(
  item: ReceiptItem,
  result: ReceiptScanResult,
  resolveCategory: (store: string) => string | null
): ReceiptItem {
  const missing: string[] = []
  if (result.total === null) missing.push('合計金額')
  if (result.store === null) missing.push('店名')
  if (result.date === null) missing.push('日付')

  const store = result.store ?? item.store
  return {
    ...item,
    status: 'done',
    error: null,
    amount: result.total !== null ? String(result.total) : item.amount,
    store,
    date: result.date ?? item.date,
    category: item.category ?? (store !== '' ? resolveCategory(store) : null),
    missing,
  }
}

/** 保存できる状態か(読み取り済みで、金額が正の整数)。(純粋関数) */
export function isSavableReceipt(item: ReceiptItem): boolean {
  if (item.status !== 'done') return false
  const n = Number(item.amount)
  return Number.isInteger(n) && n > 0 && item.category !== null
}

/** まとめて保存の対象。(純粋関数) */
export function savableReceipts(items: readonly ReceiptItem[]): ReceiptItem[] {
  return items.filter(isSavableReceipt)
}
