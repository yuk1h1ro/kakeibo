import { useRef, useState } from 'react'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import { useSwipeNav } from '../hooks/useSwipeNav'
import { categoryLabel, resolveCategoryVisual } from '../lib/categories'
import { CategoryVisualBadge } from './categoryIcons'
import { formatDate, yen } from '../lib/format'
import { SATISFACTION_OPTIONS } from '../lib/satisfaction'
import type { Satisfaction, Transaction } from '../lib/types'
import { ownAmount } from '../lib/types'
import '../settings.css'

interface Props {
  /** 未設定の支出(新しい順)。開いた時点の並びで固定する */
  targets: Transaction[]
  onAssign: (t: Transaction, value: Satisfaction) => Promise<void>
  onClose: () => void
}

/**
 * 未設定の支出を1件ずつ仕分ける (機能143)。
 *
 * 入力時のスタンプ(機能219)と同じ transactions.satisfaction を書くだけなので、
 * どちらから付けても結果は1つ。
 * 対象の配列は開いた瞬間に固定する — 1件付けるたびに親から渡る配列が縮むと、
 * 「今どれを見ているか」が飛んでしまうため。
 */
export default function SatisfactionSortSheet({ targets, onAssign, onClose }: Props) {
  const [queue] = useState<Transaction[]>(targets)
  const [index, setIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [sorted, setSorted] = useState(0)
  const cardRef = useRef<HTMLDivElement>(null)
  useBodyScrollLock()

  const current: Transaction | undefined = queue[index]

  const assign = async (value: Satisfaction) => {
    if (!current || busy) return
    setBusy(true)
    try {
      await onAssign(current, value)
      setSorted((n) => n + 1)
      setIndex((i) => i + 1)
    } finally {
      setBusy(false)
    }
  }

  // 右へ払う = 満足 / 左へ払う = 後悔。「普通」とスキップはボタンで
  // (指の動きに意味を持たせるのは両端の2つだけにして、迷わないようにする)
  useSwipeNav(cardRef, {
    onPrev: () => void assign('good'),
    onNext: () => void assign('regret'),
    enabled: current !== undefined && !busy,
  })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>気分をまとめて付ける</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        {current ? (
          <>
            <p className="muted sort-progress" aria-live="polite">
              残り {queue.length - index}件{sorted > 0 && ` ・ 付けた ${sorted}件`}
            </p>

            <div className="sort-card" ref={cardRef}>
              <div className="sort-card-head">
                <CategoryVisualBadge visual={resolveCategoryVisual(current.category)} size={40} />
                <div className="sort-card-title">
                  <span className="sort-store">
                    {current.store || current.memo || categoryLabel(current.category)}
                  </span>
                  <span className="sort-sub">
                    {formatDate(current.date)}・{categoryLabel(current.category)}
                  </span>
                </div>
              </div>
              <div className="sort-amount">{yen(ownAmount(current))}</div>
              <p className="muted sort-hint">
                右へ払うと「満足」、左へ払うと「後悔」。ボタンでも付けられます
              </p>
            </div>

            <div className="sort-actions">
              {SATISFACTION_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className="stamp-btn sort-action"
                  disabled={busy}
                  onClick={() => void assign(o.value)}
                >
                  <span className="stamp-emoji" aria-hidden="true">
                    {o.emoji}
                  </span>
                  {o.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              className="btn-ghost sort-skip"
              disabled={busy}
              onClick={() => setIndex((i) => i + 1)}
            >
              この記録は飛ばす
            </button>
          </>
        ) : (
          <div className="sort-done">
            <p className="sort-done-title">
              {sorted > 0 ? `${sorted}件に気分を付けました` : '仕分ける記録はありません'}
            </p>
            <p className="muted">レポートの「気分の振り返り」に反映されます。</p>
            <button className="btn-primary" onClick={onClose}>
              閉じる
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
