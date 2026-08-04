import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createShareLink,
  daysUntil,
  expiryFromDays,
  fetchShareLinks,
  pickActiveLink,
  reissueShareLink,
  revokeShareLink,
  type ShareLink,
} from '../lib/shareLinks'
import { buildShareUrl } from '../lib/shareRoute'
import { hasBuildTimeConfig } from '../lib/supabaseClient'
import '../share.css'
import { describeUnknownError, isOnlineNow } from '../lib/errorGuidance'

// ============================================================
// 閲覧専用の共有リンクの発行・コピー・無効化・再発行 (機能179 / 利用者側)
//
// マイグレーション未実行(テーブルが無い)ときは、このカード自体を出さない。
// 既存の記録・入力・同期には一切影響しない。
// ============================================================

const EXPIRY_CHOICES: { label: string; days: number | null }[] = [
  { label: '7日間', days: 7 },
  { label: '30日間', days: 30 },
  { label: '90日間', days: 90 },
  { label: '期限なし', days: null },
]

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

export default function ShareLinkCard({ supabase }: { supabase: SupabaseClient }) {
  const [links, setLinks] = useState<ShareLink[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [expiryDays, setExpiryDays] = useState<number | null>(30)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    void fetchShareLinks(supabase).then((rows) => {
      if (!alive) return
      if (rows === null) {
        // テーブルが無い / 通信できない。どちらもカードを出さずに黙る
        setAvailable(false)
        return
      }
      setLinks(rows)
    })
    return () => {
      alive = false
    }
  }, [supabase])

  if (!available || links === null) return null

  const now = new Date().toISOString()
  const active = pickActiveLink(links, now)
  const url = active ? buildShareUrl(window.location.origin, import.meta.env.BASE_URL, active.token) : ''
  const remaining = active ? daysUntil(active.expiresAt, now) : null

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? describeUnknownError(e, isOnlineNow()) : '操作できませんでした')
    }
    setBusy(false)
  }

  const handleCreate = () =>
    run(async () => {
      const link = await createShareLink(supabase, expiryFromDays(new Date(), expiryDays))
      setLinks([link, ...links])
      setCopied(false)
    })

  const handleReissue = () =>
    run(async () => {
      if (!confirm('いまのリンクを使えなくして、新しいリンクを作りますか?')) return
      const oldId = active ? active.id : null
      const link = await reissueShareLink(supabase, oldId, expiryFromDays(new Date(), expiryDays))
      setLinks([
        link,
        ...links.map((l) => (l.id === oldId ? { ...l, revokedAt: new Date().toISOString() } : l)),
      ])
      setCopied(false)
    })

  const handleRevoke = () =>
    run(async () => {
      if (!active) return
      if (!confirm('このリンクを使えなくしますか?(彼女は開けなくなります)')) return
      await revokeShareLink(supabase, active.id)
      setLinks(
        links.map((l) => (l.id === active.id ? { ...l, revokedAt: new Date().toISOString() } : l))
      )
      setCopied(false)
    })

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      // クリップボードが使えない環境(古いSafari等)では、選択してコピーしてもらう
      setError('コピーできませんでした。URLを長押しして選択してください')
    }
  }

  return (
    <div className="card">
      <h2>彼女に見せるリンク</h2>
      <p className="share-note">
        彼女はアプリを入れなくても、このURLを開くだけで
        「預かったお金の残り」と「自分の分として引かれたもの」を確認できます。
        リンクからコメントを書くこともできます。
      </p>
      <strong className="share-warning">
        ⚠ このURLを知っている人は、誰でもこのページを開けます。パスワードはありません。
        彼女以外に渡さないでください。もし他の人に知られたら「リンクを無効にする」を押してください。
      </strong>

      {!hasBuildTimeConfig() && (
        <p className="share-error-msg">
          ※ この端末で入力した接続情報を使っています。彼女のスマホでこのリンクを開くには、
          GitHub のリポジトリ secrets(VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)を設定して
          デプロイし直してください。
        </p>
      )}

      {active ? (
        <>
          <code className="share-url">{url}</code>
          <div className="share-actions">
            <button type="button" className="btn-primary" onClick={() => void handleCopy()}>
              {copied ? '✓ コピーしました' : 'リンクをコピー'}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void handleReissue()}>
              作り直す
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => void handleRevoke()}>
              リンクを無効にする
            </button>
          </div>
          <p className="share-meta">
            {remaining === null
              ? '有効期限: なし'
              : `有効期限: ${formatDateTime(active.expiresAt!)}まで(あと${Math.max(remaining, 0)}日)`}
            <br />
            {active.lastViewedAt
              ? `彼女が最後に開いた日: ${formatDateTime(active.lastViewedAt)}`
              : 'まだ一度も開かれていません'}
          </p>
        </>
      ) : (
        <>
          <div className="share-expiry-field">
            <span className="field">
              <span>有効期限</span>
            </span>
            <div className="share-expiry-options">
              {EXPIRY_CHOICES.map((c) => (
                <button
                  key={c.label}
                  type="button"
                  className={expiryDays === c.days ? 'selected' : ''}
                  onClick={() => setExpiryDays(c.days)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void handleCreate()}>
            {busy ? '作成中…' : 'リンクを発行する'}
          </button>
        </>
      )}

      {error && <p className="error-text">{error}</p>}
    </div>
  )
}
