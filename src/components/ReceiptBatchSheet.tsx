import { useRef, useState } from 'react'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { useCategories } from '../lib/categories'
import { yen, todayISO } from '../lib/format'
import { scanReceipt } from '../lib/receiptScan'
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
} from '../lib/receiptBatch'
import { getStoreCategories, lookupStoreCategory } from '../lib/storeCategories'
import type { TransactionInput } from '../hooks/useTransactions'
import '../settings.css'

interface Props {
  onClose: () => void
  onSaveAll: (inputs: TransactionInput[]) => Promise<void>
}

/**
 * レシートの連続撮影 (機能064)。
 *
 * 最大5枚まで溜めて1枚ずつ読み取る。無料枠とレート制限に配慮して
 * 逐次実行(並列に投げない)とし、1枚の失敗は他の枚を止めない。
 */
export default function ReceiptBatchSheet({ onClose, onSaveAll }: Props) {
  const categories = useCategories()
  const [items, setItems] = useState<ReceiptItem[]>([])
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // 読み取りループの多重起動を防ぐ(1枚ずつ順に投げるため)
  const runningRef = useRef(false)
  // ループ内から最新の一覧を参照する(state の閉じ込めだと古くなる)
  const itemsRef = useRef<ReceiptItem[]>([])

  useBodyScrollLock()

  const apply = (next: ReceiptItem[]) => {
    itemsRef.current = next
    setItems(next)
  }

  // 未読み取りの枚を先頭から1枚ずつ処理する
  const runQueue = async () => {
    if (runningRef.current) return
    runningRef.current = true
    try {
      for (;;) {
        const target = nextPendingReceipt(itemsRef.current)
        if (!target) break
        apply(updateReceipt(itemsRef.current, target.id, { status: 'scanning', error: null }))
        try {
          const result = await scanReceipt(target.file)
          if (result.store === null && result.total === null && result.date === null) {
            throw new Error('レシートを読み取れませんでした。明るい場所でもう一度撮影してください')
          }
          const current = itemsRef.current.find((it) => it.id === target.id)
          if (!current) continue // 読み取り中に破棄された
          apply(
            updateReceipt(
              itemsRef.current,
              target.id,
              applyScanResult(current, result, (name) =>
                lookupStoreCategory(getStoreCategories(), name)
              )
            )
          )
        } catch (e) {
          // 1枚の失敗で止めない。理由をそのまま出して再試行できるようにする
          apply(
            updateReceipt(itemsRef.current, target.id, {
              status: 'failed',
              error: e instanceof Error ? e.message : String(e),
            })
          )
        }
      }
    } finally {
      runningRef.current = false
    }
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 同じ画像をもう一度選べるように毎回リセット
    if (!file) return
    apply(addReceipt(itemsRef.current, crypto.randomUUID(), file, todayISO()))
    void runQueue()
  }

  const retry = (id: string) => {
    apply(updateReceipt(itemsRef.current, id, { status: 'pending', error: null }))
    void runQueue()
  }

  const savable = savableReceipts(items)
  const scanning = items.some((it) => it.status === 'scanning' || it.status === 'pending')

  const saveAll = async () => {
    setBusy(true)
    setSaveError(null)
    try {
      await onSaveAll(
        savable.map((it) => ({
          date: it.date,
          type: 'expense' as const,
          amount: Number(it.amount),
          category: it.category,
          memo: '',
          store: it.store.trim(),
          partner_amount: 0,
        }))
      )
      onClose()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>レシートを続けて撮影</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <p className="muted">
          最大{MAX_RECEIPTS}枚まで溜めて、1枚ずつ読み取ります。内容を確認・修正してからまとめて記録してください
        </p>

        <div className="batch-actions">
          <button
            type="button"
            className="scan-btn"
            disabled={!canAddReceipt(items) || busy}
            onClick={() => fileInputRef.current?.click()}
          >
            📷 {items.length === 0 ? '撮影する' : '続けて撮影'} ({items.length}/{MAX_RECEIPTS})
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handleFileSelected}
        />

        <ul className="batch-list">
          {items.map((it, i) => (
            <li key={it.id} className="batch-item">
              <div className="batch-item-head">
                <span className="batch-index">{i + 1}枚目</span>
                {it.status === 'scanning' && (
                  <span className="muted">
                    <span className="scan-spinner" aria-hidden="true" /> 読み取り中…
                  </span>
                )}
                {it.status === 'pending' && <span className="muted">順番待ち</span>}
                <button
                  type="button"
                  className="btn-ghost cat-action batch-discard"
                  disabled={busy}
                  onClick={() => apply(removeReceipt(itemsRef.current, it.id))}
                >
                  破棄
                </button>
              </div>

              {it.status === 'failed' ? (
                <div className="batch-failed">
                  <p className="error-text">{it.error}</p>
                  <button type="button" className="btn-ghost" disabled={busy} onClick={() => retry(it.id)}>
                    再試行する
                  </button>
                </div>
              ) : it.status === 'done' ? (
                <div className="batch-fields">
                  {it.missing.length > 0 && (
                    <p className="error-text">
                      {it.missing.join('・')}を読み取れませんでした。手入力してください
                    </p>
                  )}
                  <label className="field">
                    <span>金額(円)</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={it.amount}
                      onChange={(e) =>
                        apply(updateReceipt(itemsRef.current, it.id, { amount: e.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>お店</span>
                    <input
                      type="text"
                      value={it.store}
                      onChange={(e) =>
                        apply(updateReceipt(itemsRef.current, it.id, { store: e.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>日付</span>
                    <input
                      type="date"
                      value={it.date}
                      onChange={(e) =>
                        apply(updateReceipt(itemsRef.current, it.id, { date: e.target.value }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span>カテゴリ</span>
                    <select
                      value={it.category ?? ''}
                      onChange={(e) =>
                        apply(
                          updateReceipt(itemsRef.current, it.id, {
                            category: e.target.value === '' ? null : e.target.value,
                          })
                        )
                      }
                    >
                      <option value="">選択してください</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        {saveError && <p className="error-text">{saveError}</p>}

        <button
          className="btn-primary"
          disabled={savable.length === 0 || busy || scanning}
          onClick={() => void saveAll()}
        >
          {busy
            ? '記録中…'
            : `${savable.length}件をまとめて記録する${
                savable.length > 0 ? `(合計 ${yen(savable.reduce((s, it) => s + Number(it.amount), 0))})` : ''
              }`}
        </button>
      </div>
    </div>
  )
}
