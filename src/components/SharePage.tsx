import { useEffect, useMemo, useState } from 'react'
import {
  fetchShareSnapshot,
  postShareComment,
  type ShareCharge,
  type ShareComment,
  type ShareSnapshot,
} from '../lib/shareView'
import { formatDate, yen } from '../lib/format'
import { categoryLabel } from '../lib/categories'
import { partnerViewWording } from '../lib/partnerBalance'
import {
  chargeImpact,
  paidRowNote,
  signedAmountText,
  splitCharges,
} from '../lib/shareCharges'
import CommentThread from './CommentThread'
import '../share.css'
import '../ledger.css'

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

/**
 * 明細1行。金額は必ず **のこり(残高)への影響額** で出す。
 * 支払い総額は共有ページに届いていないので、出しようがない = 出さない。
 */
function ChargeRow({
  charge,
  comments,
  maxLength,
  onSubmit,
}: {
  charge: ShareCharge
  comments: ShareComment[]
  maxLength: number
  onSubmit: (body: string) => Promise<string | null>
}) {
  const label = charge.categoryLabel ?? categoryLabel(charge.category)
  const sub = [formatDate(charge.date), label].filter(Boolean).join(' ・ ')
  const impact = chargeImpact(charge)
  return (
    <div className="movement-item">
      <div className="share-row">
        <span className="share-row-body">
          <span className="share-row-title">{charge.store || label || 'お買いもの'}</span>
          <span className="share-row-sub">{sub}</span>
          {/* 彼女が払った回は、内訳を書かないと符号の意味が読めない */}
          {charge.paid > 0 && (
            <span className="share-row-sub share-row-paid">{paidRowNote(charge, yen)}</span>
          )}
        </span>
        <span className={`share-row-amount${impact > 0 ? ' positive' : ''}`}>
          {signedAmountText(impact, yen)}
        </span>
      </div>
      <CommentThread
        comments={comments}
        viewer="partner"
        maxLength={maxLength}
        onSubmit={onSubmit}
      />
    </div>
  )
}

// 中身だけを描くところ。符号の出し方が彼女の理解を左右するので、
// テストから直接描画して確かめられるように名前付きで出しておく
export function ShareContent({
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

  // 機能011: 符号ではなく言葉で意味を伝える。
  // 主語が彼女側になるので、利用者の画面とは別の言い回しを使う
  const wording = partnerViewWording(data.balance)

  // 機能018: 「引かれた回」と「あなたが払った回」を分ける (lib/shareCharges.ts)
  const { deducted, paidByPartner } = useMemo(() => splitCharges(data.charges), [data.charges])

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
        <div className="label">{wording.title}</div>
        <div className={`value ${data.balance < 0 ? 'negative' : ''}`}>{yen(wording.magnitude)}</div>
        <p className="note">{wording.note}</p>
      </div>

      {/* 機能018: 「引かれたもの」と「あなたが払ったもの」は節を分ける。
          混ぜていた頃は、彼女が払った回まで「あなたの分として引かれたもの」に
          マイナスで並び、実際には残高が増えているのに逆の符号に見えていた
          (利用者側の画面とも符号が逆だった)。金額は必ず残高への影響額で出す */}
      <div className="card">
        <h2>あなたの分として引かれたもの</h2>
        {deducted.length === 0 ? (
          <p className="share-empty">まだありません</p>
        ) : (
          deducted.map((c) => (
            <ChargeRow
              key={c.id}
              charge={c}
              comments={commentsByTx[c.id] ?? []}
              maxLength={data.maxCommentLength}
              onSubmit={(body) => submitComment(c.id, body)}
            />
          ))
        )}
      </div>

      {paidByPartner.length > 0 && (
        <div className="card">
          <h2>あなたが払ってくれたお会計</h2>
          <p className="share-note">
            あなたが払ってくれたお会計です。あなたの分をこえて出してくれたぶんは、のこりに足しています。
          </p>
          {paidByPartner.map((c) => (
            <ChargeRow
              key={c.id}
              charge={c}
              comments={commentsByTx[c.id] ?? []}
              maxLength={data.maxCommentLength}
              onSubmit={(body) => submitComment(c.id, body)}
            />
          ))}
        </div>
      )}

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

      {/* 機能012: 返金と調整。残高が動いた理由を隠さないために必ず出す。
          1件も無いとき(または古いサーバー)は節ごと出さない */}
      {data.settlements.length > 0 && (
        <div className="card">
          <h2>返したお金・直したところ</h2>
          {data.settlements.map((s) => {
            const comments = commentsByTx[s.id] ?? []
            const title =
              s.kind === 'partner_refund'
                ? 'あなたに返しました'
                : s.amount >= 0
                  ? 'のこりを増やす直し'
                  : 'のこりを減らす直し'
            return (
              <div className="movement-item" key={s.id}>
                <div className="share-row">
                  <span className="share-row-body">
                    <span className="share-row-title">{title}</span>
                    <span className="share-row-sub">{formatDate(s.date)}</span>
                    {s.memo !== '' && (
                      <span className="share-row-sub share-settlement-note">{s.memo}</span>
                    )}
                  </span>
                  <span className={`share-row-amount${s.amount > 0 ? ' positive' : ''}`}>
                    {s.amount > 0 ? `+${yen(s.amount)}` : `-${yen(-s.amount)}`}
                  </span>
                </div>
                <CommentThread
                  comments={comments}
                  viewer="partner"
                  maxLength={data.maxCommentLength}
                  onSubmit={(body) => submitComment(s.id, body)}
                />
              </div>
            )
          })}
        </div>
      )}

      <p className="share-footer">
        このページは、リンクを知っている人なら誰でも見られます。
        <br />
        表示されるのは、あなたに関係するお金だけです。
      </p>
    </div>
  )
}
