// ============================================================
// 履歴タブ
//
// カレンダー(既存)に、検索145 / スワイプ146 / 長押し149 / 並べ替え150 /
// 複数選択151 / 条件の保存152 / 引き下げて更新154 / 元に戻す159 /
// 年月ジャンプ130 / 変更履歴163 を足したもの。
//
// ---- 操作の優先順位(同じリストの上で重なるので、ここで整理する) ----
//   0. 複数選択モード中は、行のタップ = チェックの ON/OFF だけ。
//      スワイプも長押しも効かない(選んでいる最中に消えたり開いたりしないこと)
//   1. 縦に動いたらスクロール。以後この指では何も起きない(一覧は縦に読むもの)
//   2. 横に十分動いたらスワイプ(左=削除・右=編集)。長押しは取り消す
//   3. 動かさず押し続けたら長押しメニュー。指を離してもタップは発火しない
//   4. どれでもなければタップ = 編集シート(これまでどおり)
//   ※ カレンダーのセルは別の要素で、従来どおりタップだけ。行の操作とは重ならない
//   ※ 引き下げて更新は「一番上で下に引いたとき」だけ。行のスワイプ(横)とは軸が違う
//   判定は lib/rowGesture.ts / lib/pullRefresh.ts の純粋関数に集約している。
//
// 削除は確認ダイアログを出さず、消したあとに出る「元に戻す」で取り消す(機能159)。
// 取り消しもオフラインキュー経由なので、未同期のまま失われることはない。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Transaction } from '../lib/types'
import { ownAmount } from '../lib/types'
import {
  formatDate,
  formatMonth,
  maskCompact,
  monthKey,
  monthKeyOffset,
  todayISO,
  yen,
} from '../lib/format'
import { categoryLabel } from '../lib/categories'
import type { useTransactions } from '../hooks/useTransactions'
import { WEEKDAY_LABELS, defaultSelectedDate, monthWeeks } from '../lib/calendar'
import {
  DEFAULT_FILTER,
  filterTransactions,
  isFilterActive,
  type HistoryFilter,
} from '../lib/historyFilter'
import { categoryBulkTargets, duplicateInput, withCategory } from '../lib/txActions'
import { canStartPull, formatSyncedAt, pullOffset, shouldTriggerRefresh } from '../lib/pullRefresh'
import { useChangeLogAvailable } from '../lib/changeLog'
import { splitPositions } from '../lib/splits'
import HistoryTxRow from './HistoryTxRow'
import HistoryFilterBar from './HistoryFilterBar'
import MonthPickerSheet from './MonthPickerSheet'
import RowActionMenu from './RowActionMenu'
import BulkCategorySheet from './BulkCategorySheet'
import ChangeLogSheet from './ChangeLogSheet'
import { IconHistory, IconRefresh, IconUndo } from './historyIcons'
import '../calendar.css'
import '../history.css'

type Store = ReturnType<typeof useTransactions>

interface Props {
  store: Store
  onEdit: (t: Transaction) => void
  /** その日付で入力タブを開く(機能053) */
  onStartInput: (date: string) => void
}

/** 検索結果を一度に描く上限 */
const RESULT_LIMIT = 200

interface DaySummary {
  own: number
  deposit: number
}

export default function HistoryTab({ store, onEdit, onStartInput }: Props) {
  const today = todayISO()
  const currentMonth = monthKey(today)
  const [month, setMonth] = useState(currentMonth)
  const [selected, setSelected] = useState(today)
  const [filter, setFilter] = useState<HistoryFilter>(DEFAULT_FILTER)
  const [selectMode, setSelectMode] = useState(false)
  const [pickedIds, setPickedIds] = useState<string[]>([])
  const [menuTx, setMenuTx] = useState<Transaction | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => new Date())

  const logAvailable = useChangeLogAvailable()
  const canNext = month < currentMonth
  const searching = isFilterActive(filter)

  // ---------- 月の移動 ----------

  const jumpToMonth = useCallback(
    (next: string) => {
      setMonth(next)
      setSelected(
        defaultSelectedDate(
          next,
          store.transactions.map((t) => t.date),
          today
        )
      )
    },
    [store.transactions, today]
  )

  const changeMonth = (offset: number) => jumpToMonth(monthKeyOffset(month, offset))

  // ---------- 集計(既存の見え方は変えない) ----------

  const monthTx = useMemo(
    () => store.transactions.filter((t) => monthKey(t.date) === month),
    [store.transactions, month]
  )

  // 日ごとの集計: 自分の実質支出合計と預かり合計
  const byDay = useMemo(() => {
    const map = new Map<string, DaySummary>()
    for (const t of monthTx) {
      const entry = map.get(t.date) ?? { own: 0, deposit: 0 }
      if (t.type === 'partner_deposit') {
        entry.deposit += t.amount
      } else {
        entry.own += ownAmount(t)
      }
      map.set(t.date, entry)
    }
    return map
  }, [monthTx])

  const expenseTotal = monthTx.reduce((sum, t) => sum + ownAmount(t), 0)
  const depositTotal = monthTx
    .filter((t) => t.type === 'partner_deposit')
    .reduce((sum, t) => sum + t.amount, 0)

  const weeks = useMemo(() => monthWeeks(month), [month])

  const dayTx = monthTx.filter((t) => t.date === selected)
  const dayTotal = dayTx.reduce((sum, t) => sum + ownAmount(t), 0)

  // 検索・絞り込みの結果(機能145 / 150 / 152)
  const results = useMemo(
    () => filterTransactions(store.transactions, filter, { month, labelOf: categoryLabel }),
    [store.transactions, filter, month]
  )
  const resultTotal = results.reduce(
    (sum, t) => sum + (t.type === 'partner_deposit' ? 0 : ownAmount(t)),
    0
  )

  // 一度に描く行数の上限。数百件を一気に描くとスクロールが重くなるので、
  // 多すぎるときは先頭だけ出して「絞り込んでください」と伝える
  const shownResults = results.length > RESULT_LIMIT ? results.slice(0, RESULT_LIMIT) : results

  // いま一覧に出ている行(選択モードの操作対象)
  const visibleRows = searching ? shownResults : dayTx

  // 分割された会計の「何分の何番目か」(機能096)。
  // 行ごとに数えると記録数 × 行数の走査になるので、ここで1回だけ作って各行に配る
  const splitPos = useMemo(() => splitPositions(store.transactions), [store.transactions])

  // ---------- 複数選択 (機能151) ----------

  const pickedSet = useMemo(() => new Set(pickedIds), [pickedIds])
  const pickedTxs = useMemo(
    () => store.transactions.filter((t) => pickedSet.has(t.id)),
    [store.transactions, pickedSet]
  )

  const exitSelect = () => {
    setSelectMode(false)
    setPickedIds([])
  }

  const togglePick = (t: Transaction) => {
    setPickedIds((ids) => (ids.includes(t.id) ? ids.filter((id) => id !== t.id) : [...ids, t.id]))
  }

  const pickAllVisible = () => setPickedIds(visibleRows.map((t) => t.id))

  // 一覧が空になったら選択モードから抜ける(操作対象が無いバーを残さない)
  useEffect(() => {
    if (selectMode && visibleRows.length === 0) exitSelect()
    // visibleRows は毎回作り直されるので、長さだけを見る
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectMode, visibleRows.length])

  // ---------- 削除と取り消し (機能159) ----------
  // 146(スワイプ)・149(長押し)・151(一括)からの削除はここを通り、
  // 編集シートからの削除(MainScreen)も同じ仕組みに乗る。
  // 「取り消せる状態」と期限は useTransactions が持っているので、
  // どこから消しても同じ数秒間だけ取り消せる。

  const deleteTxs = useCallback(
    (txs: readonly Transaction[]) => {
      if (txs.length === 0) return
      void store.removeMany(txs)
    },
    [store]
  )

  const undoTxs = store.undoableDeletes

  // ---------- 長押しメニュー (機能149) ----------

  const duplicateTx = (t: Transaction) => {
    // 同じ内容で今日の日付。追加もオフラインキュー経由なので通信が無くても消えない
    void store.add(duplicateInput(t, today))
    // 複製した記録がすぐ見えるように、今日へ移動する
    if (monthKey(today) !== month) setMonth(monthKey(today))
    setSelected(today)
  }

  // ---------- 引き下げて更新 (機能154) ----------

  const syncNowRef = useRef(store.syncNow)
  syncNowRef.current = store.syncNow
  const pullRef = useRef(0)
  const pullingRef = useRef(false)
  const busyRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const settleRef = useRef<number | null>(null)

  const doRefresh = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setRefreshing(true)
    try {
      await syncNowRef.current()
    } finally {
      // 一瞬で消えると更新されたのか分からないので、少しだけ見せてから畳む
      settleRef.current = window.setTimeout(() => {
        busyRef.current = false
        setRefreshing(false)
        setNow(new Date())
      }, 400)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (settleRef.current !== null) window.clearTimeout(settleRef.current)
    }
  }, [])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    let startY = 0
    let armed = false

    const setPullPx = (px: number) => {
      pullRef.current = px
      setPull(px)
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        armed = false
        return
      }
      startY = e.touches[0].clientY
      // 一番上にいるときだけ引き下げの候補にする(途中のスクロールを横取りしない)
      armed = window.scrollY <= 0 && !busyRef.current
    }

    const onMove = (e: TouchEvent) => {
      if (!armed || e.touches.length !== 1) return
      const dy = e.touches[0].clientY - startY
      if (!pullingRef.current) {
        if (!canStartPull(window.scrollY, dy, busyRef.current)) {
          // 上方向へ動いたらこの指では引き下げをあきらめる(通常のスクロールに戻す)
          if (dy < 0) armed = false
          return
        }
        pullingRef.current = true
      }
      if (dy <= 0) {
        pullingRef.current = false
        setPullPx(0)
        return
      }
      // 自分で引くと決めた間だけ、iOS のオーバースクロール(ゴムの跳ね)を止める。
      // ここより手前で止めると通常のスクロールまで殺してしまう
      if (e.cancelable) e.preventDefault()
      setPullPx(pullOffset(dy))
    }

    const onEnd = () => {
      if (!pullingRef.current) return
      pullingRef.current = false
      const offset = pullRef.current
      setPullPx(0)
      armed = false
      if (shouldTriggerRefresh(offset)) void doRefresh()
    }

    // touchmove だけは passive: false(preventDefault するため)
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [doRefresh])

  // 「10:32 に更新」。オフライン・同期中・未同期の警告はヘッダーのバナーの役割なので、
  // ここでは重ねて出さず「いつ取り込んだか」だけを出す(機能154)
  const syncedText = formatSyncedAt(store.lastSyncedAt, now)

  return (
    <div className="hist-root" ref={rootRef}>
      <div
        className="hist-pullable"
        style={{ transform: pull > 0 ? `translateY(${pull}px)` : undefined }}
      >
        <div
          className="hist-pull-indicator"
          style={{ height: pull > 0 || refreshing ? 22 : 0 }}
          aria-hidden={pull === 0 && !refreshing}
        >
          {refreshing
            ? '更新中…'
            : shouldTriggerRefresh(pull)
              ? '離すと更新します'
              : '引き下げて更新'}
        </div>

        <div className="hist-sync-line">
          <span>{refreshing ? '更新中…' : (syncedText ?? '')}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {logAvailable && (
              <button className="hist-sync-btn" onClick={() => setShowLog(true)}>
                <IconHistory /> 変更履歴
              </button>
            )}
            <button
              className="hist-sync-btn"
              onClick={() => void doRefresh()}
              disabled={refreshing}
              aria-label="いま更新する"
            >
              <IconRefresh />
            </button>
          </span>
        </div>

        <div className="month-nav">
          <button onClick={() => changeMonth(-1)} aria-label="前の月">
            ←
          </button>
          {/* 見出しを押すと年月ピッカー(機能130)。矢印の連打をやめられる */}
          <button
            className="hist-month-title"
            onClick={() => setShowPicker(true)}
            aria-haspopup="dialog"
          >
            {formatMonth(month)}
            <span className="hist-caret">▼</span>
          </button>
          <button onClick={() => changeMonth(1)} disabled={!canNext} aria-label="次の月">
            →
          </button>
        </div>

        {/* タグの選択肢は実際に使われているものだけを出す (機能088) */}
        <HistoryFilterBar filter={filter} onChange={setFilter} transactions={store.transactions} />

        {!searching && (
          <>
            <div className="card month-summary">
              <div className="ms-item">
                <span className="ms-label">支出</span>
                <span className="ms-value ms-expense">{yen(expenseTotal)}</span>
              </div>
              <div className="ms-divider" />
              <div className="ms-item">
                <span className="ms-label">預かり</span>
                <span className="ms-value ms-income">{yen(depositTotal)}</span>
              </div>
            </div>

            <div className="card cal-card">
              <div className="cal-weekdays">
                {WEEKDAY_LABELS.map((w, i) => (
                  <span key={w} className={i === 0 ? 'cal-sun' : i === 6 ? 'cal-sat' : undefined}>
                    {w}
                  </span>
                ))}
              </div>
              <div className="cal-grid">
                {weeks.flat().map((cell, i) => {
                  if (cell === null) {
                    return <span key={`empty-${i}`} className="cal-cell cal-empty" />
                  }
                  const summary = byDay.get(cell.iso)
                  const isToday = cell.iso === today
                  const isSelected = cell.iso === selected
                  // 目隠し (機能169) 中は伏字。金額そのものは出さないが、
                  // 「その日に使ったかどうか」は伏字の有無で分かる(色や件数と同じ粒度)
                  const amountText =
                    summary && summary.own > 0
                      ? maskCompact(summary.own.toLocaleString('ja-JP'))
                      : null
                  const cls = [
                    'cal-cell',
                    isToday ? 'cal-today' : '',
                    isSelected ? 'cal-selected' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <button
                      key={cell.iso}
                      className={cls}
                      onClick={() => setSelected(cell.iso)}
                      // タップは「その日の明細を見る」— 入力を始めるのは下の専用ボタン(機能053)
                      aria-label={`${formatDate(cell.iso)}の明細を見る`}
                      aria-pressed={isSelected}
                    >
                      <span className="cal-day">{cell.day}</span>
                      {amountText !== null && (
                        <span
                          className={`cal-amount${amountText.length > 6 ? ' cal-amount-long' : ''}`}
                        >
                          {amountText}
                        </span>
                      )}
                      {summary && summary.deposit > 0 && <span className="cal-dot" />}
                    </button>
                  )
                })}
              </div>
              {/* 日付タップの意味を明示する。入力を始めるのは下の専用ボタン(機能053) */}
              <p className="muted cal-tap-hint">日付をタップすると、その日の明細が下に出ます</p>
            </div>
          </>
        )}

        <div className="card">
          <div className="hist-result-head">
            <span>{searching ? `検索結果 ${results.length}件` : formatDate(selected)}</span>
            <span className="hist-result-total">
              合計 {yen(searching ? resultTotal : dayTotal)}
            </span>
            {visibleRows.length > 0 && !selectMode && (
              <button className="hist-head-btn" onClick={() => setSelectMode(true)}>
                選択
              </button>
            )}
          </div>

          {visibleRows.length === 0 ? (
            <p className="hist-empty">
              {searching ? '条件に合う記録は見つかりませんでした' : 'この日の記録はありません'}
            </p>
          ) : (
            visibleRows.map((t) => (
              <HistoryTxRow
                key={t.id}
                tx={t}
                showDate={searching}
                splitPos={splitPos.get(t.id)}
                selectMode={selectMode}
                picked={pickedSet.has(t.id)}
                onOpen={onEdit}
                onLongPress={setMenuTx}
                onSwipeDelete={(tx) => deleteTxs([tx])}
                onTogglePick={togglePick}
              />
            ))
          )}

          {!searching && (
            <button className="btn-ghost day-input-btn" onClick={() => onStartInput(selected)}>
              ＋ {formatDate(selected)}で入力する
            </button>
          )}
          {searching && (
            <p className="muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
              合計は支出の実質負担分(彼女の負担分を除いた額)です
              {results.length > RESULT_LIMIT &&
                `。多いため先頭${RESULT_LIMIT}件だけ表示しています(絞り込むとすべて見られます)`}
            </p>
          )}
        </div>
      </div>

      {/* ---------- 複数選択中の操作バー (機能151) ---------- */}
      {selectMode && (
        <div className="hist-bottom-bar">
          <span className="hist-bar-text">{pickedIds.length}件を選択中</span>
          <button className="hist-bar-ghost" onClick={pickAllVisible}>
            全部
          </button>
          <button
            className="hist-bar-undo"
            disabled={pickedIds.length === 0}
            onClick={() => setBulkOpen(true)}
          >
            カテゴリ
          </button>
          <button
            className="hist-bar-danger"
            disabled={pickedIds.length === 0}
            onClick={() => {
              deleteTxs(pickedTxs)
              exitSelect()
            }}
          >
            削除
          </button>
          <button className="hist-bar-ghost" onClick={exitSelect}>
            やめる
          </button>
        </div>
      )}

      {/* ---------- 削除直後の「元に戻す」 (機能159) ---------- */}
      {!selectMode && undoTxs && (
        <div className="hist-bottom-bar hist-undo-bar" role="status">
          <span className="hist-bar-text">
            {undoTxs.length === 1 ? '1件を削除しました' : `${undoTxs.length}件を削除しました`}
          </span>
          <button className="hist-bar-undo" onClick={() => void store.undoDelete()}>
            <IconUndo /> 元に戻す
          </button>
        </div>
      )}

      {showPicker && (
        <MonthPickerSheet
          month={month}
          txDates={store.transactions.map((t) => t.date)}
          todayIso={today}
          onSelect={jumpToMonth}
          onClose={() => setShowPicker(false)}
        />
      )}

      {menuTx && (
        <RowActionMenu
          tx={menuTx}
          onDuplicate={duplicateTx}
          onEdit={onEdit}
          onDelete={(t) => deleteTxs([t])}
          onClose={() => setMenuTx(null)}
        />
      )}

      {bulkOpen && (
        <BulkCategorySheet
          count={pickedTxs.filter((t) => t.type === 'expense').length}
          onPick={(catKey) => {
            const targets = categoryBulkTargets(pickedTxs, catKey)
            void store.updateMany(
              targets.map((t) => ({ id: t.id, input: withCategory(t, catKey) }))
            )
            exitSelect()
          }}
          onClose={() => setBulkOpen(false)}
        />
      )}

      {showLog && <ChangeLogSheet onClose={() => setShowLog(false)} />}
    </div>
  )
}
