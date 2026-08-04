import { describe, expect, it } from 'vitest'
import {
  MAX_RECEIPTS,
  addReceipt,
  applyScanResult,
  canAddReceipt,
  nextPendingReceipt,
  removeReceipt,
  savableReceipts,
  updateReceipt,
  type ReceiptItem,
} from './receiptBatch'

const dummyFile = {} as File

function build(count: number): ReceiptItem[] {
  let items: ReceiptItem[] = []
  for (let i = 0; i < count; i++) items = addReceipt(items, `id${i}`, dummyFile, '2026-08-04')
  return items
}

describe('撮影の追加と上限', () => {
  it(`${MAX_RECEIPTS}枚までしか溜められない`, () => {
    const items = build(MAX_RECEIPTS)
    expect(canAddReceipt(items)).toBe(false)
    expect(addReceipt(items, 'over', dummyFile, '2026-08-04')).toHaveLength(MAX_RECEIPTS)
  })

  it('破棄すればまた撮影できる', () => {
    const items = removeReceipt(build(MAX_RECEIPTS), 'id0')
    expect(canAddReceipt(items)).toBe(true)
  })
})

describe('逐次実行のカーソル', () => {
  it('未読み取りの先頭を返す', () => {
    const items = updateReceipt(build(3), 'id0', { status: 'done' })
    expect(nextPendingReceipt(items)?.id).toBe('id1')
  })

  it('失敗した枚は自動では拾わない(再試行はユーザーの操作)', () => {
    let items = build(2)
    items = updateReceipt(items, 'id0', { status: 'failed', error: '通信エラー' })
    items = updateReceipt(items, 'id1', { status: 'done' })
    expect(nextPendingReceipt(items)).toBeNull()
  })
})

describe('applyScanResult', () => {
  const item = build(1)[0]

  it('読めた項目を入れ、店名からカテゴリを補う', () => {
    const next = applyScanResult(
      item,
      { store: 'セブンイレブン', total: 1200, date: '2026-07-30' },
      (s) => (s === 'セブンイレブン' ? 'food' : null)
    )
    expect(next).toMatchObject({
      status: 'done',
      amount: '1200',
      store: 'セブンイレブン',
      date: '2026-07-30',
      category: 'food',
      missing: [],
    })
  })

  it('読めなかった項目は元の値を保ち、名前を missing に残す', () => {
    const next = applyScanResult(item, { store: null, total: null, date: null }, () => null)
    expect(next.amount).toBe('')
    expect(next.date).toBe('2026-08-04') // 撮影時の既定日を保つ
    expect(next.missing).toEqual(['合計金額', '店名', '日付'])
  })

  it('ユーザーが選び直したカテゴリを上書きしない', () => {
    const edited = { ...item, category: 'daily' }
    const next = applyScanResult(edited, { store: 'セブン', total: 100, date: null }, () => 'food')
    expect(next.category).toBe('daily')
  })
})

describe('savableReceipts', () => {
  it('読み取り済み・金額が正・カテゴリありの枚だけ保存対象にする', () => {
    let items = build(4)
    items = updateReceipt(items, 'id0', { status: 'done', amount: '1200', category: 'food' })
    items = updateReceipt(items, 'id1', { status: 'done', amount: '0', category: 'food' })
    items = updateReceipt(items, 'id2', { status: 'done', amount: '900', category: null })
    items = updateReceipt(items, 'id3', { status: 'failed', amount: '900', category: 'food' })
    expect(savableReceipts(items).map((i) => i.id)).toEqual(['id0'])
  })
})
