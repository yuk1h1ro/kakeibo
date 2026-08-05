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
  discordFailureMessage,
  type DiscordFailure,
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
import {
  DEFAULT_SETTLEMENT_MODE,
  SETTLEMENT_MODES,
  settlementInput,
  settlementMode,
  type SettlementMode,
} from '../lib/partnerSettlement'
import {
  DEFAULT_LOW_BALANCE_THRESHOLD,
  balanceWording,
  isLowBalance,
  ledgerRowTitle,
  partnerBalance,
  partnerImpact,
  partnerMovements,
} from '../lib/partnerBalance'
import { setLowBalanceThreshold, useLowBalanceThreshold } from '../lib/lowBalanceSettings'
import { useTxFeature } from '../lib/txExtensions'
import { partnerPaid } from '../lib/types'
import '../share.css'
import '../ledger.css'
import { describeUnknownError, isOnlineNow } from '../lib/errorGuidance'

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

  // 機能012: 返金・調整も「預かり残高を動かす」同じ操作なので、預かりと1枚のカードにまとめ、
  // 種類の切り替えだけを出す。列が無い環境では切り替えを出さず、預かりだけが使える状態に倒す
  // (下の mode の解決を参照。この分岐が消えると未実行の環境で保存が弾かれる)
  const settlementAvailable = useTxFeature('settlement')
  const [selectedMode, setSelectedMode] = useState<SettlementMode>(DEFAULT_SETTLEMENT_MODE)
  const mode = settlementAvailable ? selectedMode : DEFAULT_SETTLEMENT_MODE
  const modeDef = settlementMode(mode)

  // 入力中の1件が残高に与える影響額(符号つき)。押す前に結果を見せるための安全装置で、
  // フォームから通知される。0 のときは何も打っていないので見込みも出さない
  const [draftImpact, setDraftImpact] = useState(0)
  const afterWording = balanceWording(balance + draftImpact)

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
      // partnerComments 側ですでに案内文になっているものはそのまま通る (機能161)
      return e instanceof Error ? describeUnknownError(e, isOnlineNow()) : 'コメントを保存できませんでした'
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

      {unread > 0 && (
        <div className="comment-unread-banner">💬 彼女から新しいコメントが{unread}件あります</div>
      )}

      {/* 機能012: 預かる・返す・調整はどれも「預かり残高を動かす1つの操作」なので、
          入口を1枚のカードにまとめる。以前は返す・調整だけが別カードのボタンから
          開くシートに入っていて、同じことをする場所が画面に2つあった */}
      <div className="card">
        <h2>{modeDef.heading}</h2>
        {settlementAvailable && (
          <>
            <div className="settle-modes" role="group" aria-label="記録する種類">
              {SETTLEMENT_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`settle-mode${mode === m.id ? ' selected' : ''}`}
                  aria-pressed={mode === m.id}
                  onClick={() => setSelectedMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="muted settle-hint">{modeDef.hint}</p>
          </>
        )}
        <TransactionForm
          fixedType={modeDef.txType}
          submitLabel={modeDef.submitLabel}
          onPartnerImpactChange={setDraftImpact}
          onSubmit={async (input) => {
            // 何が保存されるかは partnerSettlement.ts の純粋関数が決める。
            // フォームの都合(タグなど)は残しつつ、記録の意味を決める部分
            // — 種別・金額の符号・分類/店名/負担分が空であること — だけを上書きする
            await store.add({
              ...input,
              ...settlementInput({
                mode,
                // 調整の向きはフォーム側のボタンが持っているので、符号から読み戻す
                amount: Math.abs(input.amount),
                direction: input.amount < 0 ? -1 : 1,
                date: input.date,
                memo: input.memo,
              }),
            })
          }}
        />
        {draftImpact !== 0 && (
          <p className="settle-preview" aria-live="polite">
            この記録のあと: <strong>{yen(afterWording.magnitude)}</strong>({afterWording.title})
          </p>
        )}
        {settlementAvailable && (
          <p className="muted settle-note">
            どの操作も履歴に1件の記録として残ります(あとから編集・削除もできます)。
            日付・金額と、ここに書いた{mode === 'adjust' ? '理由' : 'メモ'}は
            <strong>共有リンクの画面にも表示されます</strong>
            — 残高が動いた理由を彼女からも追えるようにするためです
          </p>
        )}
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
  // 失敗の理由 (Webhook が無効 / 届いていない / Discord 側の不調) で文言を変える。
  // 「URLと通信状態を確認してください」と両方を並べていた頃は、いちばん多い
  // 「チャンネルを作り直して URL が無効になった」にたどり着けなかった
  const [testFailure, setTestFailure] = useState<DiscordFailure | null>(null)

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
    setTestFailure(null)
  }

  const handleTest = async () => {
    setTestState('sending')
    const result = await sendTestMessage()
    setTestFailure(result.ok ? null : result.failure)
    setTestState(result.ok ? 'ok' : 'fail')
  }

  const handleClear = () => {
    clearWebhookUrl()
    setSavedUrl(null)
    setTestState('idle')
    setTestFailure(null)
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
          {testState === 'fail' && testFailure && (
            <p className="error-text discord-result">{discordFailureMessage(testFailure)}</p>
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
  const isExpense = tx.type === 'expense'
  // 残高への影響額。プラスなら残高が増えた行(預かり・調整・彼女が払いすぎた回)
  const impact = partnerImpact(tx)
  const visual = isExpense
    ? resolveCategoryVisual(tx.category)
    : ({ kind: 'icon', icon: 'wallet' } as const)
  // タイトルの優先順位: お店 → メモ → カテゴリ名
  const title = isExpense ? tx.store || tx.memo || categoryLabel(tx.category) : ledgerRowTitle(tx)

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
