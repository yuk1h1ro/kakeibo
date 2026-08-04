import { useEffect, useMemo, useState } from 'react'
import {
  fetchShareSnapshot,
  postShareComment,
  type ShareComment,
  type ShareSnapshot,
} from '../lib/shareView'
import { formatDate, yen } from '../lib/format'
import { categoryLabel } from '../lib/categories'
import CommentThread from './CommentThread'
import '../share.css'

// ============================================================
// 閲覧専用の共有ページ (機能179 / 185)
//
// - ログイン不要。アプリ本体のログイン状態には一切触れない
//   (shareView.ts が persistSession:false の専用クライアントを使う)
// - 出すのは「彼女に関係する分」だけ。利用者個人の支出も、支払い総額も出さない
//   (絞り込みはサーバー側の関数で行っており、この画面には届いてすらいない)
// - 初めて見る人が迷わないよう、専門用語(残高・按分・トークン等)を使わない
// ============================================================

interface Props {
  token: string
}

export default function SharePage({ token }: Props) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'ok'; data: ShareSnapshot }
    | { kind: 'invalid' }
    | { kind: 'unconfigured' }
    | { kind: 'error' }
  >({ kind: 'loading' })

  useEffect(() => {
    document.title = 'あずけたお金'
    let alive = true
    void fetchShareSnapshot(token).then((r) => {
      if (!alive) return
      setState(r.kind === 'ok' ? { kind: 'ok', data: r.data } : { kind: r.kind })
    })
    return () => {
      alive = false
    }
  }, [token])

  // 送信に成功したコメントをその場で足す(再取得せずに見た目を合わせる)
  const appendComment = (c: ShareComment) => {
    setState((prev) =>
      prev.kind === 'ok'
        ? { kind: 'ok', data: { ...prev.data, comments: [...prev.data.comments, c] } }
        : prev
    )
  }

  if (state.kind === 'loading') {
    return <p className="share-message">読み込み中…</p>
  }

  if (state.kind === 'unconfigured' || state.kind === 'error') {
    // 接続情報が無い/通信に失敗した。どちらも彼女には同じ意味なので同じ文言にする
    return (
      <p className="share-message">
        いま開けませんでした。
        <br />
        通信状態を確かめて、もう一度開いてみてください。
      </p>
    )
  }

  if (state.kind === 'invalid') {
    // 存在しない・無効化された・期限切れを区別せず、同じ一般的な文言にする
    return (
      <p className="share-message">
        このページは開けません。
        <br />
        リンクの有効期限が切れているか、共有が終了しています。
        <br />
        もう一度リンクを送ってもらってください。
      </p>
    )
  }

  return <ShareContent data={state.data} token={token} onAppendComment={appendComment} />
}

function ShareContent({
  data,
  token,
  onAppendComment,
}: {
  data: ShareSnapshot
  token: string
  onAppendComment: (c: ShareComment) => void
}) {
  const commentsByTx = useMemo(() => {
    const out: Record<string, ShareComment[]> = {}
    for (const c of data.comments) {
      ;(out[c.transactionId] ??= []).push(c)
    }
    return out
  }, [data.comments])

  const balanceText = data.balance < 0 ? `-${yen(Math.abs(data.balance))}` : yen(data.balance)

  const submitComment = async (transactionId: string, body: string): Promise<string | null> => {
    const r = await postShareComment(token, transactionId, body)
    switch (r.kind) {
      case 'ok':
        onAppendComment(r.comment)
        return null
      case 'rate':
        return '少し時間をあけてから、もう一度送ってください'
      case 'length':
        return `コメントは${data.maxCommentLength}文字までです`
      case 'invalid':
        return 'このページはもう使えません。もう一度リンクを送ってもらってください'
      default:
        return '送信できませんでした。通信状態を確かめてください'
    }
  }

  return (
    <div className="share-page">
      <header className="share-page-header">
        <h1>あずけたお金</h1>
      </header>

      <div className="card share-hero">
        <div className="label">のこっているお金</div>
        <div className={`value ${data.balance < 0 ? 'negative' : ''}`}>{balanceText}</div>
        <p className="note">
          {data.balance < 0
            ? 'あずけた分より多く使っています'
            : 'あずけたお金から、あなたの分を引いた残りです'}
        </p>
      </div>

      <div className="card">
        <h2>あなたの分として引かれたもの</h2>
        {data.charges.length === 0 ? (
          <p className="share-empty">まだありません</p>
        ) : (
          data.charges.map((c) => {
            const label = c.categoryLabel ?? categoryLabel(c.category)
            const sub = [formatDate(c.date), label].filter(Boolean).join(' ・ ')
            const comments = commentsByTx[c.id] ?? []
            return (
              <div className="movement-item" key={c.id}>
                <div className="share-row">
                  <span className="share-row-body">
                    <span className="share-row-title">{c.store || label || 'お買いもの'}</span>
                    <span className="share-row-sub">{sub}</span>
                  </span>
                  <span className="share-row-amount">-{yen(c.amount)}</span>
                </div>
                <CommentThread
                  comments={comments}
                  viewer="partner"
                  maxLength={data.maxCommentLength}
                  onSubmit={(body) => submitComment(c.id, body)}
                />
              </div>
            )
          })
        )}
      </div>

      <div className="card">
        <h2>あなたがあずけたお金</h2>
        {data.deposits.length === 0 ? (
          <p className="share-empty">まだありません</p>
        ) : (
          data.deposits.map((d) => {
            const comments = commentsByTx[d.id] ?? []
            return (
              <div className="movement-item" key={d.id}>
                <div className="share-row">
                  <span className="share-row-body">
                    <span className="share-row-title">あずかりました</span>
                    <span className="share-row-sub">{formatDate(d.date)}</span>
                  </span>
                  <span className="share-row-amount positive">+{yen(d.amount)}</span>
                </div>
                <CommentThread
                  comments={comments}
                  viewer="partner"
                  maxLength={data.maxCommentLength}
                  onSubmit={(body) => submitComment(d.id, body)}
                />
              </div>
            )
          })
        )}
      </div>

      <p className="share-footer">
        このページは、リンクを知っている人なら誰でも見られます。
        <br />
        表示されるのは、あなたに関係するお金だけです。
      </p>
    </div>
  )
}
