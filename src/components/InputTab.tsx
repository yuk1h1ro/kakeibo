import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import TransactionForm, { type DatePrefill, type FormPrefill } from './TransactionForm'
import GeminiKeySheet from './GeminiKeySheet'
import ReceiptBatchSheet from './ReceiptBatchSheet'
import RecategorizeSheet from './RecategorizeSheet'
import { yen } from '../lib/format'
import { categoryLabel, resolveCategoryVisual, useCategories } from '../lib/categories'
import { CategoryVisualBadge } from './categoryIcons'
import { IconGear } from './icons'
import { hasGeminiKey, scanReceipt } from '../lib/receiptScan'
import {
  rememberStoreCategory,
  transactionsToRecategorize,
} from '../lib/storeCategories'
import {
  isTemplatesUnavailable,
  templateLabel,
  useTransactionTemplates,
} from '../lib/transactionTemplates'
import { balanceWording, isLowBalance, partnerBalance } from '../lib/partnerBalance'
import { useLowBalanceThreshold } from '../lib/lowBalanceSettings'
import type { Transaction } from '../lib/types'
import type { TransactionInput, useTransactions } from '../hooks/useTransactions'
import '../ledger.css'

type Store = ReturnType<typeof useTransactions>

// 保存直後に出す「過去にも適用しますか?」の対象(機能078)
interface RecategorizeTarget {
  storeName: string
  category: string
  targets: Transaction[]
}

interface Props {
  store: Store
  supabase: SupabaseClient
  /** 履歴カレンダーの「この日で入力する」から渡ってくる日付(機能053) */
  datePrefill?: DatePrefill
}

export default function InputTab({ store, supabase, datePrefill }: Props) {
  const [saved, setSaved] = useState(false)
  const formCardRef = useRef<HTMLDivElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [prefill, setPrefill] = useState<FormPrefill | undefined>(undefined)
  // 入力中の1件が預かり残高に与える影響額(符号つき)。
  // 彼女の負担分だけならマイナス、彼女が払いすぎた回はプラスになる (機能018)
  const [pendingPartner, setPendingPartner] = useState(0)
  // カテゴリ変更(名前・絵文字)時に「最近の記録から入力」チップを再描画するための購読
  useCategories()
  const templates = useTransactionTemplates()
  const [recategorize, setRecategorize] = useState<RecategorizeTarget | null>(null)

  // ---------- レシート読み取り ----------
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanNote, setScanNote] = useState(false)
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showGeminiSheet, setShowGeminiSheet] = useState(false)
  const [showBatchSheet, setShowBatchSheet] = useState(false)

  // 残高の計算は partnerBalance.ts の純関数に一本化してある(画面ごとに書かない)
  const balance = partnerBalance(store.transactions)
  const wording = balanceWording(balance)
  // いま入力中の彼女の負担分を引いた見込み。支払った人の指定はフォーム側から
  // 影響額として渡ってくるので、ここではそれをそのまま足す (機能018)
  const balanceAfter = balance + pendingPartner
  const afterWording = balanceWording(balanceAfter)
  const threshold = useLowBalanceThreshold()

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

  const handlePartnerImpactChange = useCallback((n: number) => setPendingPartner(n), [])

  // カレンダーから来たときは、入力フォームまで運んであげる
  // (残高カードやレシートの導線が先にあるので、そのままだと入力欄が画面外にある)
  useEffect(() => {
    if (!datePrefill) return
    formCardRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [datePrefill])

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

  const noteSaved = () => {
    setSaved(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setSaved(false), 2500)
  }

  /**
   * 保存のたびに店名とカテゴリの対応を覚える(機能067+075)。
   * 覚えていたカテゴリから変わったときだけ、過去の記録も直すか尋ねる(機能078)。
   * 学習が失敗しても記録は済んでいるので、ここでは何も表に出さない。
   */
  const learnFromInput = async (input: TransactionInput) => {
    if (input.type !== 'expense' || input.store === '' || input.category === null) return
    const previous = await rememberStoreCategory(supabase, input.store, input.category)
    if (previous === null || previous === input.category) return
    const targets = transactionsToRecategorize(store.transactions, input.store, input.category)
    if (targets.length === 0) return // 該当が無いときは聞かない
    setRecategorize({ storeName: input.store, category: input.category, targets })
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

  const handleBatchTap = () => {
    if (!hasGeminiKey()) {
      setShowGeminiSheet(true)
      return
    }
    setShowBatchSheet(true)
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

      // 読めた項目だけフォームに反映(カテゴリは店名から学習済みならフォーム側で入る)
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
      {/* 機能011: 金額は絶対値で出し、預かり中か立て替え中かは言葉で伝える */}
      <div className="card balance-card">
        <span className="label">彼女とのお金 ・ {wording.title}</span>
        <div className="balance-values">
          <span className={`value ${balance < 0 ? 'negative' : ''}`}>{yen(wording.magnitude)}</span>
          {pendingPartner !== 0 && (
            <span className="balance-after">
              この記録のあと{' '}
              <span className={balanceAfter < 0 ? 'negative' : ''}>
                {yen(afterWording.magnitude)}
              </span>
              ({afterWording.title})
            </span>
          )}
        </div>
        {isLowBalance(balance, threshold) && (
          <p className="low-balance-alert" role="status">
            <span>
              {balance < 0
                ? '預かりを使い切っています。'
                : `残りが ${yen(threshold)} を下回りました。`}
            </span>
            <strong>次の預かりをお願いするタイミングです</strong>
          </p>
        )}
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
        <button type="button" className="btn-ghost scan-batch-btn" onClick={handleBatchTap} disabled={scanning}>
          レシートを続けて撮影する(最大5枚)
        </button>
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

      {!isTemplatesUnavailable() && templates.length > 0 && (
        <div className="card">
          <h2>テンプレート</h2>
          <div className="recent-chips">
            {templates.map((t) => (
              <button
                key={t.id}
                type="button"
                className="recent-chip"
                onClick={() =>
                  setPrefill((prev) => ({
                    nonce: (prev?.nonce ?? 0) + 1,
                    amount: t.amount,
                    category: t.category,
                    memo: t.memo,
                    store: t.store,
                    partner_amount: t.partnerAmount,
                  }))
                }
              >
                <CategoryVisualBadge visual={resolveCategoryVisual(t.category)} size={28} />
                <span className="recent-label">{templateLabel(t)}</span>
                <span className="recent-amount">{yen(t.amount)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* form-card は広い画面 (desktop.css) で置き場所を決めるための目印。
          入力が主役の画面なので、段組みのバランス任せにせず必ず左の列に置く */}
      <div className="card form-card" ref={formCardRef}>
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
          datePrefill={datePrefill}
          onPartnerImpactChange={handlePartnerImpactChange}
          // タグの候補は過去の記録から出す (機能088)
          knownTransactions={store.transactions}
          onSubmit={async (input) => {
            await store.add(input)
            noteSaved()
            await learnFromInput(input)
          }}
          // 機能096: 分割はカテゴリごとの独立した記録としてまとめて積む。
          // 店名からのカテゴリ学習はここでは行わない — 1つの店に複数の
          // カテゴリが対応する会計なので、どれを覚えても次回の推測を誤らせる
          onSubmitSplit={async (inputs) => {
            await store.addMany(inputs)
            noteSaved()
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

      {showBatchSheet && (
        <ReceiptBatchSheet
          onClose={() => setShowBatchSheet(false)}
          onSaveAll={async (inputs) => {
            for (const input of inputs) {
              await store.add(input)
              await learnFromInput(input)
            }
            noteSaved()
          }}
        />
      )}

      {recategorize && (
        <RecategorizeSheet
          storeName={recategorize.storeName}
          category={recategorize.category}
          targets={recategorize.targets}
          onClose={() => setRecategorize(null)}
          onApply={async () => {
            // 一括更新もオフラインキュー経由。未同期のまま失われない
            await store.updateMany(
              recategorize.targets.map((t) => ({
                id: t.id,
                input: {
                  date: t.date,
                  type: t.type,
                  amount: t.amount,
                  category: recategorize.category,
                  memo: t.memo,
                  store: t.store,
                  partner_amount: t.partner_amount,
                },
              }))
            )
            setRecategorize(null)
          }}
        />
      )}
    </>
  )
}
