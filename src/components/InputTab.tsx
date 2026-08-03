import { useCallback, useMemo, useRef, useState } from 'react'
import TransactionForm, { type FormPrefill } from './TransactionForm'
import GeminiKeySheet from './GeminiKeySheet'
import { yen } from '../lib/format'
import { categoryLabel, resolveCategoryVisual, useCategories } from '../lib/categories'
import { CategoryVisualBadge } from './categoryIcons'
import { IconGear } from './icons'
import { hasGeminiKey, scanReceipt } from '../lib/receiptScan'
import type { Transaction } from '../lib/types'
import type { useTransactions } from '../hooks/useTransactions'

type Store = ReturnType<typeof useTransactions>

export default function InputTab({ store }: { store: Store }) {
  const [saved, setSaved] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [prefill, setPrefill] = useState<FormPrefill | undefined>(undefined)
  const [pendingPartner, setPendingPartner] = useState(0)
  // カテゴリ変更(名前・絵文字)時に「最近の記録から入力」チップを再描画するための購読
  useCategories()

  // ---------- レシート読み取り ----------
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanNote, setScanNote] = useState(false)
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showGeminiSheet, setShowGeminiSheet] = useState(false)

  // 彼女の預かり残高 = 預かり合計 − 支出の彼女負担分合計
  const partnerBalance = store.transactions.reduce(
    (sum, t) => (t.type === 'partner_deposit' ? sum + t.amount : sum - t.partner_amount),
    0
  )
  const balanceAfter = partnerBalance - pendingPartner

  // 直近の支出から (カテゴリ, 金額, お店, メモ) の組で重複除去して最大5件
  const recentEntries = useMemo(() => {
    const seen = new Set<string>()
    const out: Transaction[] = []
    for (const t of store.transactions) {
      if (t.type !== 'expense') continue
      const key = `${t.category ?? ''}|${t.amount}|${t.store}|${t.memo}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(t)
      if (out.length >= 5) break
    }
    return out
  }, [store.transactions])

  const handlePartnerAmountChange = useCallback((n: number) => setPendingPartner(n), [])

  const applyRecent = (t: Transaction) => {
    setPrefill((prev) => ({
      nonce: (prev?.nonce ?? 0) + 1,
      amount: t.amount,
      category: t.category,
      memo: t.memo,
      store: t.store,
      partner_amount: t.partner_amount,
    }))
  }

  // キー未設定なら設定シートへ誘導、設定済みならそのままカメラを起動する。
  // 設定済みのときの設定シートへの導線は、隣の歯車ボタン(常設)が担う
  const handleScanTap = () => {
    if (!hasGeminiKey()) {
      setShowGeminiSheet(true)
      return
    }
    fileInputRef.current?.click()
  }

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    // 同じ画像をもう一度選び直せるように毎回リセット
    e.target.value = ''
    if (!file) return

    setScanning(true)
    setScanError(null)
    setScanNote(false)
    try {
      const result = await scanReceipt(file)

      if (result.store === null && result.total === null && result.date === null) {
        setScanError('レシートを読み取れませんでした。明るい場所でもう一度撮影してください')
        return
      }

      // 読めた項目だけフォームに反映(カテゴリは自動判定しない=ユーザーがタップ)
      setPrefill((prev) => ({
        nonce: (prev?.nonce ?? 0) + 1,
        amount: result.total ?? 0,
        category: null,
        memo: '',
        store: result.store ?? '',
        partner_amount: 0,
        ...(result.date ? { date: result.date } : {}),
      }))

      // 読めなかった項目のフィードバック(1行)
      const missing: string[] = []
      if (result.total === null) missing.push('合計金額')
      if (result.store === null) missing.push('店名')
      if (result.date === null) missing.push('日付')
      setScanError(
        missing.length > 0 ? `${missing.join('・')}を読み取れませんでした。手入力してください` : null
      )

      // 確認のうながし(数秒で消えるmutedな注意)
      setScanNote(true)
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current)
      noteTimerRef.current = setTimeout(() => setScanNote(false), 6000)
    } catch (err) {
      setScanError(err instanceof Error ? err.message : String(err))
    } finally {
      setScanning(false)
    }
  }

  return (
    <>
      <div className="card balance-card">
        <span className="label">彼女の預かり残高</span>
        <div className="balance-values">
          <span className={`value ${partnerBalance < 0 ? 'negative' : ''}`}>{yen(partnerBalance)}</span>
          {pendingPartner > 0 && (
            <span className="balance-after">
              差引後 <span className={balanceAfter < 0 ? 'negative' : ''}>{yen(balanceAfter)}</span>
            </span>
          )}
        </div>
      </div>

      <div className="scan-block">
        <div className="scan-row">
          <button type="button" className="scan-btn" onClick={handleScanTap} disabled={scanning}>
            {scanning ? (
              <>
                <span className="scan-spinner" aria-hidden="true" />
                読み取り中…
              </>
            ) : (
              <>📷 レシートを読み取る</>
            )}
          </button>
          <button
            type="button"
            className="scan-settings-btn"
            aria-label="レシート読み取りの設定"
            onClick={() => setShowGeminiSheet(true)}
            disabled={scanning}
          >
            <IconGear />
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => void handleFileSelected(e)}
        />
        {scanError && <p className="error-text scan-feedback">{scanError}</p>}
        {scanNote && (
          <p className="muted scan-feedback">
            読み取り結果を確認して、必要なら修正してから保存してください
          </p>
        )}
      </div>

      <div className="card">
        <h2>支出を記録</h2>
        {saved && (
          <p className="positive" style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
            記録しました ✓
          </p>
        )}
        <TransactionForm
          fixedType="expense"
          submitLabel="記録する"
          prefill={prefill}
          onPartnerAmountChange={handlePartnerAmountChange}
          onSubmit={async (input) => {
            await store.add(input)
            setSaved(true)
            if (timerRef.current) clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => setSaved(false), 2500)
          }}
        />
      </div>

      {recentEntries.length > 0 && (
        <div className="card">
          <h2>最近の記録から入力</h2>
          <div className="recent-chips">
            {recentEntries.map((t) => (
              <button key={t.id} type="button" className="recent-chip" onClick={() => applyRecent(t)}>
                <CategoryVisualBadge visual={resolveCategoryVisual(t.category)} size={28} />
                <span className="recent-label">{t.store || t.memo || categoryLabel(t.category)}</span>
                <span className="recent-amount">{yen(t.amount)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {showGeminiSheet && (
        <GeminiKeySheet
          onClose={() => setShowGeminiSheet(false)}
          onSaved={() => setShowGeminiSheet(false)}
        />
      )}
    </>
  )
}
