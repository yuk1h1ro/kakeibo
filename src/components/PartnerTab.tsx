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
import '../share.css'

type Store = ReturnType<typeof useTransactions>

interface Props {
  store: Store
  supabase: SupabaseClient
  onEdit: (t: Transaction) => void
}

export default function PartnerTab({ store, supabase, onEdit }: Props) {
  const balance = store.transactions.reduce((sum, t) => {
    if (t.type === 'partner_deposit') return sum + t.amount
    return sum - t.partner_amount
  }, 0)

  const balanceText = balance < 0 ? `-${yen(Math.abs(balance))}` : yen(balance)

  // 預かり(+)と、支出のうち彼女負担分の差引(-)。新しい順(storeが日付降順)
  const movements = store.transactions.filter(
    (t) => t.type === 'partner_deposit' || (t.type === 'expense' && t.partner_amount > 0)
  )

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
      <div className="card hero-card">
        <div className="label">彼女の預かり残高</div>
        <div className={`hero-value ${balance < 0 ? 'negative' : ''}`}>{balanceText}</div>
        {balance < 0 && <p className="muted">立て替え超過です</p>}
      </div>

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
    </>
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

function MovementRow({ tx, onEdit, comments, onOpenThread, onSubmitComment }: MovementRowProps) {
  const [open, setOpen] = useState(false)
  const isDeposit = tx.type === 'partner_deposit'
  const visual = isDeposit
    ? ({ kind: 'icon', icon: 'wallet' } as const)
    : resolveCategoryVisual(tx.category)
  // タイトルの優先順位: お店 → メモ → カテゴリ名
  const title = isDeposit ? '彼女から預かり' : tx.store || tx.memo || categoryLabel(tx.category)

  const subParts: string[] = [formatDate(tx.date)]
  if (isDeposit) {
    if (tx.memo) subParts.push(tx.memo)
  } else {
    // タイトルがお店のときはメモをサブ行に併記
    if (tx.store && tx.memo) subParts.push(tx.memo)
    if (tx.store || tx.memo) subParts.push(categoryLabel(tx.category))
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
        <span className={`tx-amount ${isDeposit ? 'positive' : ''}`}>
          {isDeposit ? `+${yen(tx.amount)}` : `-${yen(tx.partner_amount)}`}
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
