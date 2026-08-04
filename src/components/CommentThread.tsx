import { useState } from 'react'
import { MAX_COMMENT_LENGTH, validateComment, type CommentAuthor } from '../lib/partnerComments'
import '../share.css'

// ============================================================
// 明細1件ぶんのコメント欄 (機能185)
//
// アプリ内(利用者)と共有ページ(彼女)の両方から使う共通の見た目。
// データの読み書きは呼び出し側に任せ、ここは表示と入力だけを持つ。
//
// XSS 対策: 本文は {c.body} として **必ずテキストノードで描画** する。
// このファイルを含め、コメント機能では dangerouslySetInnerHTML を使わない。
// ============================================================

export interface ThreadComment {
  id: string
  author: CommentAuthor
  body: string
  createdAt: string
}

interface Props {
  comments: readonly ThreadComment[]
  /** この画面を見ているのが誰か(呼び方を変えるために使う) */
  viewer: CommentAuthor
  /** 送信処理。エラーがあればメッセージを返し、成功なら null を返す */
  onSubmit: (body: string) => Promise<string | null>
  maxLength?: number
}

/** 「2月3日 14:05」の形。共有ページは初めて見る人が読むので、記号を減らす */
function formatStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes()
  ).padStart(2, '0')}`
}

function authorLabel(author: CommentAuthor, viewer: CommentAuthor): string {
  if (author === viewer) return 'あなた'
  return author === 'partner' ? '彼女' : '記録した人'
}

export default function CommentThread({ comments, viewer, onSubmit, maxLength }: Props) {
  const limit = maxLength ?? MAX_COMMENT_LENGTH
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const trimmedLength = text.trim().length
  const over = trimmedLength > limit

  const handleSend = async () => {
    const v = validateComment(text)
    if (!v.ok) {
      setError(v.message)
      return
    }
    setSending(true)
    setError(null)
    const message = await onSubmit(v.body)
    setSending(false)
    if (message) {
      setError(message)
      return
    }
    setText('')
  }

  return (
    <div className="comment-thread">
      {comments.length === 0 ? (
        <p className="comment-empty">まだコメントはありません</p>
      ) : (
        comments.map((c) => (
          <div key={c.id} className={`comment-item ${c.author === viewer ? 'mine' : ''}`}>
            <span className="comment-author">
              {authorLabel(c.author, viewer)} ・ {formatStamp(c.createdAt)}
            </span>
            {/* テキストとして描画する(HTMLとして解釈させない) */}
            <span className="comment-body">{c.body}</span>
          </div>
        ))
      )}

      <div className="comment-form">
        <label className="field">
          <span>コメントを書く</span>
          <textarea
            value={text}
            maxLength={limit + 50 /* 上限は下の判定で出す。入力自体は少し余裕を持たせる */}
            placeholder="これなに? など"
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
          />
        </label>
        <div className="comment-form-row">
          <span className={`comment-counter ${over ? 'over' : ''}`}>
            {trimmedLength} / {limit}
          </span>
          <button
            type="button"
            className="btn-primary"
            disabled={sending || trimmedLength === 0 || over}
            onClick={() => void handleSend()}
          >
            {sending ? '送信中…' : '送信'}
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  )
}
