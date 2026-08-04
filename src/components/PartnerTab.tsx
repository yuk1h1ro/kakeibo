import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import TransactionForm from './TransactionForm'
import type { Transaction } from '../lib/types'
import { formatDate, yen } from '../lib/format'
import { categoryLabel, resolveCategoryVisual } from '../lib/categories'
import { CategoryVisualBadge } from './categoryIcons'
import type { useTransactions } from '../hooks/useTransactions'
import {
  clearWebhookUrl,
  getWebhookUrl,
  isValidWebhookUrl,
  saveWebhookUrl,
  sendTestMessage,
} from '../lib/discordNotify'
import {
  addOwnerComment,
  fetchComments,
  groupCommentsByTransaction,
  markTransactionRead,
  unreadCommentCount,
  type PartnerComment,
} from '../lib/partnerComments'
import CommentThread from './CommentThread'
import ShareLinkCard from './ShareLinkCard'
import PartnerSettlementSheet from './PartnerSettlementSheet'
import {
  DEFAULT_LOW_BALANCE_THRESHOLD,
  balanceWording,
  isLowBalance,
  partnerBalance,
  partnerImpact,
  partnerMovements,
} from '../lib/partnerBalance'
import { setLowBalanceThreshold, useLowBalanceThreshold } from '../lib/lowBalanceSettings'
import { useTxFeature } from '../lib/txExtensions'
import { partnerPaid } from '../lib/types'
import '../share.css'
import '../ledger.css'

type Store = ReturnType<typeof useTransactions>

interface Props {
  store: Store
  supabase: SupabaseClient
  onEdit: (t: Transaction) => void
}

export default function PartnerTab({ store, supabase, onEdit }: Props) {
  // 残高の計算は partnerBalance.ts の純関数に一本化してある(画面ごとに書かない)
  const balance = partnerBalance(store.transactions)
  const wording = balanceWording(balance)

  // 機能010: しきい値を下回っているか。既定 1,000円で、下のカードから変えられる
  const threshold = useLowBalanceThreshold()
  const low = isLowBalance(balance, threshold)

  // 機能012: 返金・受け取り・調整の入口。列が無い環境では出さない
  const settlementAvailable = useTxFeature('settlement')
  const [settleOpen, setSettleOpen] = useState(false)

  // 残高が動いた行だけを新しい順に(storeが日付降順)。
  // 預かり・返金・調整に加えて、彼女が払った回(機能018)もここに出る
  const movements = partnerMovements(store.transactions)

  // コメント (機能185)。テーブルが無ければ null のままで、導線ごと出さない
  const [comments, setComments] = useState<PartnerComment[] | null>(null)
  useEffect(() => {
    let alive = true
    void fetchComments(supabase).then((rows) => {
      if (alive && rows !== null) setComments(rows)
    })
    return () => {
      alive = false
    }
  }, [supabase])

  const grouped = useMemo(
    () => groupCommentsByTransaction(comments ?? []),
    [comments]
  )
  const unread = unreadCommentCount(comments ?? [])

  const handleAddComment = async (txId: string, body: string): Promise<string | null> => {
    try {
      const created = await addOwnerComment(supabase, txId, body)
      setComments((prev) => [...(prev ?? []), created])
      return null
    } catch (e) {
      return e instanceof Error ? e.message : 'コメントを保存できませんでした'
    }
  }

  // 開いた明細の彼女のコメントは既読にする(未読バッジを消すため)
  const handleOpenThread = (txId: string) => {
    const list = grouped[txId] ?? []
    if (!list.some((c) => c.author === 'partner' && !c.readByOwner)) return
    void markTransactionRead(supabase, txId)
    setComments((prev) =>
      (prev ?? []).map((c) => (c.transactionId === txId ? { ...c, readByOwner: true } : c))
    )
  }

  return (
    <>
      {/* 機能011: 符号だけでは「預かりが減った」のか「貸しが増えた」のか読めない。
          金額は必ず絶対値で出し、意味は見出しの言葉で伝える */}
      <div className="card hero-card">
        <div className="balance-headline">
          <span className="label">彼女とのお金</span>
          <span
            className={`balance-direction ${balance < 0 ? 'is-lent' : balance > 0 ? 'is-holding' : ''}`}
          >
            {wording.title}
          </span>
        </div>
        <div className={`hero-value ${balance < 0 ? 'negative' : ''}`}>{yen(wording.magnitude)}</div>
        <p className="muted">{wording.note}</p>
        {low && (
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

      {settlementAvailable && (
        <div className="card">
          <h2>返金・受け取り・調整</h2>
          <p className="muted">
            余った分を返した・現金で受け取った・ズレを直した、を記録します(どれも履歴に残ります)
          </p>
          <button
            type="button"
            className="btn-ghost settle-open-btn"
            onClick={() => setSettleOpen(true)}
          >
            精算を記録する
          </button>
        </div>
      )}

      {unread > 0 && (
        <div className="comment-unread-banner">💬 彼女から新しいコメントが{unread}件あります</div>
      )}

      <div className="card">
        <h2>預かりを記録</h2>
        <TransactionForm
          fixedType="partner_deposit"
          submitLabel="預かりを記録"
          onSubmit={async (input) => {
            await store.add(input)
          }}
        />
      </div>

      <ShareLinkCard supabase={supabase} />

      <LowBalanceCard threshold={threshold} />

      <DiscordNotifyCard />

      <div className="card">
        <h2>動きの履歴</h2>
        {movements.length === 0 ? (
          <p className="muted">記録がありません</p>
        ) : (
          movements.map((t) => (
            <MovementRow
              key={t.id}
              tx={t}
              onEdit={onEdit}
              comments={comments === null ? null : grouped[t.id] ?? []}
              onOpenThread={() => handleOpenThread(t.id)}
              onSubmitComment={(body) => handleAddComment(t.id, body)}
            />
          ))
        )}
      </div>

      {settleOpen && (
        <PartnerSettlementSheet
          balance={balance}
          onClose={() => setSettleOpen(false)}
          onSubmit={async (input) => {
            // 追加もオフラインキュー経由。通信が無くても記録は失われない
            await store.add(input)
          }}
        />
      )}
    </>
  )
}

/**
 * 低下アラートのしきい値 (機能010)。
 * 設定シートではなくこのタブに置いたのは、判断の材料(いまの残高)が
 * すぐ上にあるからで、「いくらを切ったら困るか」はここでしか決められないため。
 * 値はこの端末に保存される(Discord の Webhook 設定と同じ粒度)。
 */
function LowBalanceCard({ threshold }: { threshold: number }) {
  const [draft, setDraft] = useState(String(threshold))
  const [saved, setSaved] = useState(false)

  const apply = () => {
    const n = Number(draft)
    if (!Number.isFinite(n)) return
    setLowBalanceThreshold(n)
    setDraft(String(Math.max(0, Math.round(n))))
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="card">
      <h2>残高が少なくなったら知らせる</h2>
      <p className="muted">
        預かり残高がこの金額を下回ったら、このタブと入力タブに注意を出します。Discord
        を設定していれば、下回った時点で1回だけ通知します(下回ったままの日は鳴りません)
      </p>
      <div className="low-balance-setting">
        <input
          type="text"
          inputMode="numeric"
          aria-label="お知らせの基準額"
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
        />
        <button type="button" className="btn-ghost" onClick={apply}>
          保存
        </button>
      </div>
      <p className="muted">
        いまの基準: {yen(threshold)}
        {threshold !== DEFAULT_LOW_BALANCE_THRESHOLD && `(既定は ${yen(DEFAULT_LOW_BALANCE_THRESHOLD)})`}
        {saved && ' ・保存しました'}
      </p>
    </div>
  )
}

// Webhook URL は表示時に伏せる(先頭40文字だけ見せる)
function maskUrl(url: string): string {
  return url.length > 40 ? `${url.slice(0, 40)}…` : url
}

function DiscordNotifyCard() {
  const [savedUrl, setSavedUrl] = useState<string | null>(() => getWebhookUrl())
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState<string | null>(null)
  const [testState, setTestState] = useState<'idle' | 'sending' | 'ok' | 'fail'>('idle')

  const handleSave = () => {
    const url = input.trim()
    if (!isValidWebhookUrl(url)) {
      setInputError(
        'Discord の Webhook URL(https://discord.com/api/webhooks/... の形式)を入力してください'
      )
      return
    }
    saveWebhookUrl(url)
    setSavedUrl(url)
    setInput('')
    setInputError(null)
    setTestState('idle')
  }

  const handleTest = async () => {
    setTestState('sending')
    const ok = await sendTestMessage()
    setTestState(ok ? 'ok' : 'fail')
  }

  const handleClear = () => {
    clearWebhookUrl()
    setSavedUrl(null)
    setTestState('idle')
  }

  return (
    <div className="card">
      <h2>Discord通知</h2>
      <p className="muted">預かり残高が変わったとき、Discordのチャンネルに自動で通知します</p>
      {savedUrl ? (
        <>
          <p className="discord-status">✓ 通知は有効です</p>
          <p className="muted discord-url">{maskUrl(savedUrl)}</p>
          <div className="discord-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void handleTest()}
              disabled={testState === 'sending'}
            >
              {testState === 'sending' ? '送信中…' : 'テスト送信'}
            </button>
            <button type="button" className="btn-ghost" onClick={handleClear}>
              解除
            </button>
          </div>
          {testState === 'ok' && (
            <p className="muted discord-result">✅ テスト通知を送信しました。Discordのチャンネルを確認してください</p>
          )}
          {testState === 'fail' && (
            <p className="error-text discord-result">送信に失敗しました。URLと通信状態を確認してください</p>
          )}
        </>
      ) : (
        <div className="discord-form">
          <label className="field">
            <span>Webhook URL</span>
            <input
              type="url"
              placeholder="https://discord.com/api/webhooks/..."
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                setInputError(null)
              }}
            />
          </label>
          {inputError && <p className="error-text">{inputError}</p>}
          <button type="button" className="btn-primary" onClick={handleSave} disabled={!input.trim()}>
            保存
          </button>
        </div>
      )}
    </div>
  )
}

interface MovementRowProps {
  tx: Transaction
  onEdit: (t: Transaction) => void
  /** null = コメント機能が使えない(マイグレーション未実行)ので導線を出さない */
  comments: PartnerComment[] | null
  onOpenThread: () => void
  onSubmitComment: (body: string) => Promise<string | null>
}

/** 支出以外(預かり・返金・調整)の見出し。何で残高が動いたのかを言葉で出す */
function ledgerTitle(tx: Transaction): string {
  switch (tx.type) {
    case 'partner_deposit':
      return '彼女から預かり'
    case 'partner_refund':
      return '彼女に返金'
    case 'partner_adjust':
      return tx.amount >= 0 ? '調整(残高を増やした)' : '調整(残高を減らした)'
    default:
      return ''
  }
}

function MovementRow({ tx, onEdit, comments, onOpenThread, onSubmitComment }: MovementRowProps) {
  const [open, setOpen] = useState(false)
  const isExpense = tx.type === 'expense'
  // 残高への影響額。プラスなら残高が増えた行(預かり・調整・彼女が払いすぎた回)
  const impact = partnerImpact(tx)
  const visual = isExpense
    ? resolveCategoryVisual(tx.category)
    : ({ kind: 'icon', icon: 'wallet' } as const)
  // タイトルの優先順位: お店 → メモ → カテゴリ名
  const title = isExpense ? tx.store || tx.memo || categoryLabel(tx.category) : ledgerTitle(tx)

  const subParts: string[] = [formatDate(tx.date)]
  if (!isExpense) {
    if (tx.memo) subParts.push(tx.memo)
  } else {
    // タイトルがお店のときはメモをサブ行に併記
    if (tx.store && tx.memo) subParts.push(tx.memo)
    if (tx.store || tx.memo) subParts.push(categoryLabel(tx.category))
    // 機能018: 彼女が払った回は、内訳を出さないと符号の意味が分からない
    if (partnerPaid(tx) > 0) {
      subParts.push(`彼女が ${yen(partnerPaid(tx))} 払い、負担は ${yen(tx.partner_amount)}`)
    }
  }

  const unread = comments ? comments.some((c) => c.author === 'partner' && !c.readByOwner) : false

  return (
    <div className="movement-item">
      <button className="tx-row" onClick={() => onEdit(tx)}>
        <CategoryVisualBadge visual={visual} size={34} />
        <span className="tx-body">
          <span className="tx-title" style={{ display: 'block' }}>
            {title}
          </span>
          <span className="tx-sub" style={{ display: 'block' }}>
            {subParts.join(' ・ ')}
          </span>
        </span>
        {/* 残高への影響額をそのまま出す。1件ごとの符号と残高の増減が必ず一致する */}
        <span className={`tx-amount ${impact > 0 ? 'positive' : ''}`}>
          {impact > 0 ? `+${yen(impact)}` : `-${yen(-impact)}`}
        </span>
      </button>
      {comments !== null && (
        <>
          <button
            type="button"
            className="comment-toggle"
            onClick={() => {
              const next = !open
              setOpen(next)
              if (next) onOpenThread()
            }}
          >
            💬 コメント{comments.length > 0 ? ` ${comments.length}` : ''}
            {unread && <span className="unread-dot" aria-label="未読あり" />}
            <span style={{ marginLeft: 'auto' }}>{open ? '閉じる' : '開く'}</span>
          </button>
          {open && (
            <CommentThread comments={comments} viewer="owner" onSubmit={onSubmitComment} />
          )}
        </>
      )}
    </div>
  )
}
