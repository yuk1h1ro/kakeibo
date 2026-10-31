// ============================================================
// 履歴タブ
//
// カレンダー(既存)に、検索145 / スワイプ146 / 長押し149 / 並べ替え150 /
// 複数選択151 / 条件の保存152 / 引き下げて更新154 / 元に戻す159 /
// 年月ジャンプ130 / 変更履歴163 を足したもの。
// さらに「一覧｜カレンダー」の切り替え、月の帯を左右に払う月送り、
// 未同期の記録の一覧を足している(下の「月の帯」の節)。
//
// ---- 操作の優先順位(同じリストの上で重なるので、ここで整理する) ----
//   0. 複数選択モード中は、行のタップ = チェックの ON/OFF だけ。
//      スワイプも長押しも効かない(選んでいる最中に消えたり開いたりしないこと)
//   1. 縦に動いたらスクロール。以後この指では何も起きない(一覧は縦に読むもの)
//   2. 横に十分動いたらスワイプ(左=削除・右=編集)。長押しは取り消す
//   3. 動かさず押し続けたら長押しメニュー。指を離してもタップは発火しない
//   4. どれでもなければタップ = 編集シート(これまでどおり)
//   ※ 月の帯(見出し・合計・カレンダー)の上で横に払うと月が変わる。
//      帯は明細の行とは別の要素なので、行の左右スワイプ(削除・編集)とは重ならない
//   ※ 引き下げて更新は「一番上で、横より縦に大きく下へ引いたとき」だけ。
//      行や帯の横の指とは軸が違う(斜めの指は横の側に渡す: canStartPull)
//   判定は lib/rowGesture.ts / lib/pullRefresh.ts / lib/swipe.ts の純粋関数に集約している。
//
// 削除は確認ダイアログを出さず、消したあとに出る「元に戻す」で取り消す(機能159)。
// 取り消しもオフラインキュー経由なので、未同期のまま失われることはない。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Transaction } from '../lib/types'
import { ownAmount } from '../lib/types'
import {
  formatDate,
  formatMonth,
  maskCompact,
  monthKey,
  todayISO,
  yen,
} from '../lib/format'
import { categoryLabel } from '../lib/categories'
import type { useTransactions } from '../hooks/useTransactions'
import { useSwipeNav } from '../hooks/useSwipeNav'
import { WEEKDAY_LABELS, defaultSelectedDate, monthWeeks, shiftMonth } from '../lib/calendar'
import {
  DEFAULT_FILTER,
  customRangeActive,
  describeRange,
  effectivePeriod,
  filterTransactions,
  isFilterActive,
  type HistoryFilter,
  type HistoryPeriod,
} from '../lib/historyFilter'
import { groupByDay, summarizeDays } from '../lib/historyGroups'
import { setHistoryView, useHistoryView, type HistoryView } from '../lib/historyView'
import { pendingRows } from '../lib/pendingRecords'
import { categoryBulkTargets, duplicateInput, withCategory } from '../lib/txActions'
import { bulkTagSuggestions } from '../lib/bulkTags'
import { useSpecialTags } from '../lib/reportTagSettings'
import {
  canStartPull,
  formatSyncedAt,
  formatSyncedShort,
  pullOffset,
  shouldTriggerRefresh,
} from '../lib/pullRefresh'
import { useChangeLogAvailable } from '../lib/changeLog'
import { splitPositions } from '../lib/splits'
import { AXIS_LOCK_DISTANCE } from '../lib/rowGesture'
import HistoryTxRow from './HistoryTxRow'
import HistoryFilterBar from './HistoryFilterBar'
import MonthPickerSheet from './MonthPickerSheet'
import RowActionMenu from './RowActionMenu'
import BulkCategorySheet from './BulkCategorySheet'
import BulkTagSheet from './BulkTagSheet'
import ChangeLogSheet from './ChangeLogSheet'
import HistorySyncSheet from './HistorySyncSheet'
import UnsyncedSheet from './UnsyncedSheet'
import { IconRefresh } from './historyIcons'
import UndoDeleteBar from './UndoDeleteBar'
import '../calendar.css'
import '../history.css'

type Store = ReturnType<typeof useTransactions>

/**
 * レポートのお店別の行から渡ってくる「このお店で絞って開く」指示。
 * 入力タブの datePrefill (機能053) と同じ形にしてある(nonce が変わるたびに適用する)。
 */
export interface StorePrefill {
  nonce: number
  store: string
}

interface Props {
  store: Store
  onEdit: (t: Transaction) => void
  /** その日付で入力タブを開く(機能053) */
  onStartInput: (date: string) => void
  /** レポートのお店別から「そのお店の履歴」を開く */
  storePrefill?: StorePrefill
}

/** 検索結果・月の一覧を一度に描く上限 */
const RESULT_LIMIT = 200

/**
 * 引き下げの候補を諦める横の移動量(px)。
 * 一番上で横に払い始めた指は、途中で下へずれても引き下げに化けさせない。
 * 行のスワイプが「横に動いた」と決める距離(rowGesture.ts の AXIS_LOCK_DISTANCE)と揃えている
 */
const PULL_GIVE_UP_DX = AXIS_LOCK_DISTANCE

/** 未同期の行IDを持たない store(テストの差し替えなど)でも落ちないための空集合 */
const NO_IDS: ReadonlySet<string> = new Set()

/**
 * 検索結果の見出しに出す「期間」のチップ。
 * 絞り込みパネルの期間(すべて / この月 / 直近3ヶ月 / この年 / 指定)のうち、
 * 探しものの途中で切り替えたくなる3つだけを、結果のすぐ上に出す。
 * 「この年」「指定」はパネルの中に残す(ここに並べると5つになり、1行に収まらない)。
 */
const PERIOD_CHIPS: readonly HistoryPeriod[] = ['all', 'month', 'last3']

export default function HistoryTab({ store, onEdit, onStartInput, storePrefill }: Props) {
  const today = todayISO()
  const currentMonth = monthKey(today)
  const [month, setMonth] = useState(currentMonth)
  const [selected, setSelected] = useState(today)
  const [filter, setFilter] = useState<HistoryFilter>(DEFAULT_FILTER)
  // 一覧｜カレンダー(端末ごとに覚える。既定は一覧 — 理由は lib/historyView.ts)
  const view = useHistoryView()
  const [selectMode, setSelectMode] = useState(false)
  const [pickedIds, setPickedIds] = useState<string[]>([])
  const [menuTx, setMenuTx] = useState<Transaction | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  // タグのシートを開いたときの対象。選択そのもの(pickedIds)とは別に持つ —
  // 絞り込み中にそのタグを外すと一覧から行が消え、選択が空になってシートの
  // 対象まで 0件になってしまう(「35件に付けました」の隣で 0件と出る)
  const [tagIds, setTagIds] = useState<string[] | null>(null)
  const [tagApplied, setTagApplied] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [showSync, setShowSync] = useState(false)
  const [showUnsynced, setShowUnsynced] = useState(false)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => new Date())
  // 月を送った向き。月の中身を差し替えるときのスライドの向きに使う。
  // 開いた直後は null(最初の表示まで滑らせない)
  const [navDir, setNavDir] = useState<'prev' | 'next' | null>(null)
  // 今月より先へ払ったときの「これ以上は無い」の小さな跳ね返り
  const [bouncing, setBouncing] = useState(false)

  // ---------- お店で絞り込む (長押しメニュー / レポートのお店別からの導線) ----------
  //
  // 「だけ見る」を言葉どおりにするため、いまの絞り込みに足すのではなく置き換える。
  // 期間は既定の「すべて」のまま — 欲しいのは「そのお店の履歴」であって、
  // レポートで見ていた月のぶんではない。**そのぶんレポートの行の件数とは変わる**ので、
  // 何で絞っているか(お店・期間)は HistoryFilterBar が describeFilter で常に画面に出す。
  // 結果の見出しには期間のチップ(すべて / M月だけ / 直近3ヶ月)も出るので、
  // レポートと同じ月に揃えたいときは1回押せば済む。
  // 突き合わせは完全一致(types.ts の storeKey)。レポートのお店別と同じキーなので、
  // 同じ期間で見れば件数も一致する。
  const showStoreOnly = useCallback((storeName: string) => {
    setFilter({ ...DEFAULT_FILTER, stores: [storeName] })
    // 結果の一覧は絞り込みバーの下に出る。押した結果が見えるよう先頭へ戻す
    window.scrollTo({ top: 0 })
  }, [])

  useEffect(() => {
    if (!storePrefill) return
    showStoreOnly(storePrefill.store)
  }, [storePrefill, showStoreOnly])

  const logAvailable = useChangeLogAvailable()
  const canNext = month < currentMonth
  const searching = isFilterActive(filter)

  // ---------- 月送りの見出しと、月に依らない絞り込みの整理 ----------
  //
  // 見出しの ← → は「表示中の月」を動かす。期間が この月 / 直近3ヶ月 / この年 の
  // ときは絞り込みの基準もこの月なので、押せば結果が動く(そのまま残す)。
  // ところが次の2つの間は、範囲が月に依らないので ← → を押しても何も変わらない
  // — 押しても何も起きないボタン(と、払っても何も起きない帯)が残る:
  //   ・日付を指定して絞っている間(期間「指定」)
  //   ・期間「すべて」で検索している間。以前は「2026年10月」と出したまま
  //     全期間の結果(15件 ¥70,820)を並べていて、← を押すと見出しの月だけが変わった。
  //     レポートのお店別から来たときもこれで、レポートの月の額(¥45,210)と
  //     並べると「どちらが正しいのか」分からなくなっていた
  // そこでその間だけ、月送りの行を「いま何の範囲を見ているか」の表示に差し替える。
  // 月そのもの(month)は動かさないので、絞り込みを解除すれば元の月に戻る。
  const rangeActive = customRangeActive(filter)
  const allPeriodSearch = searching && !rangeActive && effectivePeriod(filter) === 'all'
  const monthNavigable = !rangeActive && !allPeriodSearch

  // ---------- 複数選択から抜ける ----------
  // 選択中に一覧の中身が入れ替わる操作(月・日・一覧｜カレンダーの切り替え)をしたら抜ける。
  // 抜けないと、前の一覧で選んだ行が **画面から見えないまま選ばれ続け**、
  // 「2件を選択中」のまま削除を押すと、見えていない記録が消えていた(実測)。
  const exitSelect = () => {
    setSelectMode(false)
    setPickedIds([])
  }

  // ---------- 月の移動 ----------
  // ← → ・年月ピッカー・帯のスワイプは、すべてここを通る

  const jumpToMonth = useCallback(
    (next: string) => {
      if (next !== month) setNavDir(next > month ? 'next' : 'prev')
      setMonth(next)
      setSelected(
        defaultSelectedDate(
          next,
          store.transactions.map((t) => t.date),
          today
        )
      )
      setSelectMode(false)
      setPickedIds([])
    },
    [store.transactions, today, month]
  )

  const goMonth = (offset: number) => {
    const next = shiftMonth(month, offset)
    // 未来の月には進めない(既存の制約)。ボタンは押せなくしてあるので、
    // ここに来るのは払ったときだけ。黙って何も起きないと「払い方が悪かった」と
    // 思わせるので、帯を小さく跳ね返して「この先は無い」と伝える
    if (next > currentMonth) {
      setBouncing(true)
      return
    }
    jumpToMonth(next)
  }

  const selectDay = (iso: string) => {
    setSelected(iso)
    if (selectMode) exitSelect()
  }

  const changeView = (next: HistoryView) => {
    if (next === view) return
    setHistoryView(next)
    if (selectMode) exitSelect()
  }

  // ---------- 集計(既存の見え方は変えない) ----------

  const monthTx = useMemo(
    () => store.transactions.filter((t) => monthKey(t.date) === month),
    [store.transactions, month]
  )

  // 日ごとの集計: 自分の実質支出合計と預かり合計。
  // 一覧の日付見出しと同じ関数で数える(2つの見え方で同じ日の額が食い違わないように)
  const byDay = useMemo(() => summarizeDays(monthTx), [monthTx])

  const expenseTotal = monthTx.reduce((sum, t) => sum + ownAmount(t), 0)
  const depositTotal = monthTx
    .filter((t) => t.type === 'partner_deposit')
    .reduce((sum, t) => sum + t.amount, 0)

  const weeks = useMemo(() => monthWeeks(month), [month])

  const dayTx = monthTx.filter((t) => t.date === selected)
  const dayTotal = dayTx.reduce((sum, t) => sum + ownAmount(t), 0)

  // 一覧: その月の記録を日付の見出しで区切って新しい順に(上限は検索結果と同じ)
  const monthGroups = useMemo(() => groupByDay(monthTx, RESULT_LIMIT), [monthTx])
  const monthRows = useMemo(() => monthGroups.groups.flatMap((g) => g.rows), [monthGroups])

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
  const showCalendar = !searching && view === 'calendar'
  const visibleRows = searching ? shownResults : view === 'list' ? monthRows : dayTx

  // 分割された会計の「何分の何番目か」(機能096)。
  // 行ごとに数えると記録数 × 行数の走査になるので、ここで1回だけ作って各行に配る
  const splitPos = useMemo(() => splitPositions(store.transactions), [store.transactions])

  // ---------- 複数選択 (機能151) ----------

  const pickedSet = useMemo(() => new Set(pickedIds), [pickedIds])
  // 操作の対象は「選んだ行のうち、いま一覧に出ているもの」だけ。
  // 月・日・表示の切り替えでは選択ごと抜けるが(exitSelect)、絞り込みを変えたり、
  // 同期で他の端末の削除が届いたりして **選んだ行が一覧から消える** 道は他にもある。
  // 見えていない記録を件数に数えたり、まとめて消したりしないよう、ここで必ず絞る
  const pickedTxs = useMemo(
    () => visibleRows.filter((t) => pickedSet.has(t.id)),
    [visibleRows, pickedSet]
  )

  // ---------- 選んだ記録にまとめてタグを付ける / 外す ----------
  //
  // レポートの「回ごと」からの一括タグ付け(report/EventTagSheet)は、対象の記録に
  // **すでに何かタグが付いている**ことが前提で、1つも付いていない旅行には入れない。
  // 旅行モードを使い忘れて帰ってきた旅行に、あとから #旅行 や #2026北海道 を
  // 付けられる場所がここ。日付やお店で絞ってから選べるので、複数選択が自然な置き場になる。
  // 判断(誰に効くか・すでに付いている・上限で付けられない)は lib/bulkTags.ts、
  // 画面は共通の BulkTagSheet。どちらもレポート側とまったく同じものを使う。
  const specialTags = useSpecialTags()
  const tagTargets = useMemo(() => {
    if (tagIds === null) return []
    const ids = new Set(tagIds)
    return store.transactions.filter((t) => ids.has(t.id))
  }, [store.transactions, tagIds])
  // 候補は「いま実際に使われているタグ」+ 特別タグ(旅行・デート・出張)。
  // 絞り込み(機能088)と同じ考え方で、使っていないタグは並べない
  const tagChoices = useMemo(
    () => bulkTagSuggestions(store.transactions, specialTags),
    [store.transactions, specialTags]
  )

  const closeTagSheet = () => {
    setTagIds(null)
    // 付け外しをしたなら、カテゴリの一括変更と同じく選択モードから抜ける。
    // 何もしていないときは選び直しの途中なので、選択はそのまま残す
    if (tagApplied) exitSelect()
    setTagApplied(false)
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
    if (monthKey(today) !== month) {
      setNavDir('next')
      setMonth(monthKey(today))
    }
    setSelected(today)
  }

  // ---------- 未同期の記録 ----------
  //
  // 帯の「保留 N件」は件数しか言わないので、どれが送れていないのかを
  // 一覧で見られるようにする(UnsyncedSheet)。数えるのは記録の単位(lib/pendingRecords.ts)。
  const pendingIdSet = store.pendingIds ?? NO_IDS
  const unsyncedRows = useMemo(
    () => pendingRows(store.transactions, pendingIdSet),
    [store.transactions, pendingIdSet]
  )
  const unsyncedDeletes = store.pendingDeleteCount ?? 0
  const unsyncedCount = unsyncedRows.length + unsyncedDeletes
  // 送っている最中は件数が残っていても出し始めない。
  // 通信できるときに入れた記録は、積まれた次の瞬間に送り終わる。その一瞬に
  // 帯へ「⚠ 未同期 1件」が出ては消えると、入れるたびに帯の高さが揺れる。
  // いったん出たものは、送っている最中も出したままにする(出たり消えたりさせない)
  const unsyncedShownRef = useRef(false)
  const showUnsyncedChip =
    unsyncedCount === 0 ? false : store.syncing ? unsyncedShownRef.current : true
  unsyncedShownRef.current = showUnsyncedChip

  // ---------- 引き下げて更新 (機能154) ----------

  const syncNowRef = useRef(store.syncNow)
  syncNowRef.current = store.syncNow
  const pullRef = useRef(0)
  const pullingRef = useRef(false)
  const busyRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // 画面下に浮かぶバー(複数選択・元に戻す)の高さを実測して、一覧の下に同じだけ余白を空ける。
  //
  // バーは position: fixed なので一覧の上に重なる。余白が無いと最後の数行がバーの下に隠れ、
  // **見えているのにタップできない**(複数選択では、その行を選べない)。
  // 高さを決め打ちにしないのは、件数の文字が折り返したり、iOS の文字サイズ設定を
  // 大きくしたりすると伸びるため。実際、1段から2段に変えたときに隠れる量が倍になって
  // この不具合が表に出た。測っておけば、次に中身が変わっても勝手に追従する。
  const barRef = useRef<HTMLDivElement>(null)
  const [barH, setBarH] = useState(0)
  // **どの** バーが出ているか。「出ているか」の真偽ではなく種類で持つ。
  // 複数選択バー(2段)と元に戻すバー(1段)は高さが違ううえ、削除すると
  // 片方からもう片方へ直接入れ替わる。真偽で見ていると入れ替わりで測り直しが走らず、
  // 前のバーを見ていた ResizeObserver が画面から外れた要素を掴んだまま残る。
  // (実際そうなっていて、入れ替わったあとは実測が二度と更新されず、
  //  CSS の既定値 118px 頼みに戻っていた。バーが 174px に伸びた場面で
  //  最後のカードがバーの下に 44px 潜った)
  const barKind = selectMode ? 'select' : undoTxs ? 'undo' : 'none'
  // 余白を付ける条件はこちら。実測値(barH)は高さの調整だけに使う。
  // 実測は配置の無い環境(テストの jsdom)では 0 になるので、条件に混ぜると
  // 「バーが出ているのに余白が付かない」をテストで捕まえられなくなる
  const barShown = barKind !== 'none'
  useEffect(() => {
    const el = barRef.current
    if (el === null) {
      setBarH(0)
      return
    }
    const measure = () => setBarH(el.getBoundingClientRect().height)
    measure()
    // ResizeObserver が無い環境(テストの jsdom や古いブラウザ)では、
    // 測り直しを諦めて初回の実測だけで動かす。余白が少しずれることはあっても、
    // 隠れて押せないという元の不具合には戻らない(CSS 側に既定値も置いてある)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
    // 測り直すのは、出ているバーが変わったときだけ。依存を空にすると毎レンダリングで
    // getBoundingClientRect が走り、引き下げ更新の最中は指を動かすたびに測ることになる。
    // 同じバーのまま中身が伸びた場合(文字サイズ・件数の折り返し)は ResizeObserver が拾う
  }, [barKind])
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
    let startX = 0
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
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      // 一番上にいるときだけ引き下げの候補にする(途中のスクロールを横取りしない)
      armed = window.scrollY <= 0 && !busyRef.current
    }

    const onMove = (e: TouchEvent) => {
      if (!armed || e.touches.length !== 1) return
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      if (!pullingRef.current) {
        if (!canStartPull(window.scrollY, dy, busyRef.current, dx)) {
          // 上方向へ動いたらこの指では引き下げをあきらめる(通常のスクロールに戻す)。
          // 横のほうが大きく動いた指も同じ — 月の帯を左右に払っている途中なので、
          // そのあと少し下へずれても引き下げに化けさせない
          if (dy < 0 || Math.abs(dx) > PULL_GIVE_UP_DX) armed = false
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

  // ---------- 月の帯: 左右に払って月を送る ----------
  //
  // 月の見出し・合計・(カレンダー表示なら)カレンダーを1つの帯にまとめ、
  // その上で横に払うと月が変わる(左へ払う = 次の月、右へ払う = 前の月。レポートと同じ)。
  // 払える場所を **帯だけ** にしているのは:
  //   ・明細の行は左右に払うと削除・編集になる(機能146)。同じ指に2つの意味を持たせない
  //   ・タブ全体(hist-root)に付けると、シート(年月ピッカーなど)も DOM 上はその子なので、
  //     シートの中で横に動かした指まで月送りになる
  // 次の間は払っても何もしない(押しても何も起きない ← → を出していないのと同じ理由):
  //   ・複数選択中(選んだ行が月ごと入れ替わって見えなくなる)
  //   ・シートを開いている間
  //   ・月に依らない範囲を見ている間(期間「指定」/ 全期間の検索)
  //   ・引き下げ更新の最中・更新中(縦に引いた指が離れた瞬間に月まで変わらないように)
  // 判定の閾値(56px・横:縦 > 2・800ms 以内)はレポートと同じ lib/swipe.ts のもの。
  const bandRef = useRef<HTMLDivElement>(null)
  const sheetOpen =
    showPicker ||
    menuTx !== null ||
    bulkOpen ||
    tagIds !== null ||
    showLog ||
    showSync ||
    showUnsynced
  useSwipeNav(bandRef, {
    onSwipeRight: () => goMonth(-1),
    onSwipeLeft: () => goMonth(1),
    enabled: monthNavigable && !selectMode && !sheetOpen,
    isBlocked: () => pullingRef.current || busyRef.current || pullRef.current > 0,
  })

  // 「10:32 に更新」。オフライン・同期中・未同期の警告はヘッダーのバナーの役割なので、
  // ここでは重ねて出さず「いつ取り込んだか」だけを出す(機能154)。
  // 上部を詰めるため、もとの1行は検索欄の右端の小さなボタン(⟳ 10:32)に畳んだ。
  // 長い言い方と「いま更新する」「変更履歴」は、そのボタンから開くシートにある
  const syncedText = formatSyncedAt(store.lastSyncedAt, now)
  const syncedShort = formatSyncedShort(store.lastSyncedAt, now)

  // 「10月」(今年)/「2025年10月」(去年以前)。一覧の見出しと期間のチップで使う
  const monthLabel =
    month.slice(0, 4) === currentMonth.slice(0, 4)
      ? `${Number(month.slice(5, 7))}月`
      : formatMonth(month)
  const periodChipLabel = (p: HistoryPeriod) =>
    p === 'all' ? 'すべて' : p === 'month' ? `${monthLabel}だけ` : '直近3ヶ月'
  const shownPeriod = effectivePeriod(filter)

  const slideClass = navDir ? ` slide-${navDir}` : ''

  const selectButton = visibleRows.length > 0 && !selectMode && (
    <button className="hist-head-btn" onClick={() => setSelectMode(true)}>
      選択
    </button>
  )

  const renderRow = (t: Transaction, showDate: boolean) => (
    <HistoryTxRow
      key={t.id}
      tx={t}
      showDate={showDate}
      splitPos={splitPos.get(t.id)}
      selectMode={selectMode}
      picked={pickedSet.has(t.id)}
      unsynced={pendingIdSet.has(t.id)}
      onOpen={onEdit}
      onLongPress={setMenuTx}
      onSwipeDelete={(tx) => deleteTxs([tx])}
      onTogglePick={togglePick}
    />
  )

  return (
    <div
      className={`hist-root${barShown ? ' hist-root-barred' : ''}`}
      ref={rootRef}
      style={barH > 0 ? ({ '--hist-bar-h': `${barH}px` } as CSSProperties) : undefined}
    >
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
              : `引き下げて更新${syncedText ? `(${syncedText})` : ''}`}
        </div>

        {/* 検索・絞り込み・更新を1行に。タグの選択肢は実際に使われているものだけを出す (機能088) */}
        <HistoryFilterBar
          filter={filter}
          onChange={setFilter}
          transactions={store.transactions}
          trailing={
            <button
              className="hist-sync-chip"
              onClick={() => setShowSync(true)}
              aria-haspopup="dialog"
              aria-label={`更新と変更履歴(${refreshing ? '更新中' : (syncedText ?? 'まだ取り込めていません')})`}
            >
              <IconRefresh
                width={18}
                height={18}
                className={refreshing ? 'is-spinning' : undefined}
              />
              {(refreshing || syncedShort) && (
                <span className="hist-sync-chip-text">{refreshing ? '更新中' : syncedShort}</span>
              )}
            </button>
          }
        />

        {/* ---------- 月の帯 ----------
            見出し + 合計と表示の切り替え + (カレンダー表示なら)カレンダー。
            ここだけが左右の払いで月を送る。一覧表示ではカレンダーが無く背が低いので、
            画面の上に貼り付けて(sticky)、スクロールしても何月の一覧かと合計が見える */}
        <div ref={bandRef} className={`hist-band${showCalendar ? '' : ' is-sticky'}`}>
          <div
            className={`hist-band-inner${bouncing ? ' is-bouncing' : ''}`}
            onAnimationEnd={(e) => {
              if (e.animationName === 'hist-bounce-next') setBouncing(false)
            }}
          >
            {rangeActive || allPeriodSearch ? (
              <div className="month-nav hist-range-head" role="status">
                <span className="hist-range-title">
                  {rangeActive ? `${describeRange(filter)} で絞り込み中` : '全期間から検索中'}
                </span>
              </div>
            ) : (
              <div className="month-nav">
                <button onClick={() => goMonth(-1)} aria-label="前の月">
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
                <button onClick={() => goMonth(1)} disabled={!canNext} aria-label="次の月">
                  →
                </button>
              </div>
            )}

            {!searching && (
              // 月ごとに作り直して、送った向きから滑り込ませる(レポートと同じ動き)
              <div key={month} className={`hist-band-month${slideClass}`}>
                <div className="hist-band-bar">
                  {/* 合計は彼女の負担分を除いた「自分の分」。会計の総額の合計ではないことを
                      見出しで言う(検索結果のときだけ注記が出ていて、ふだんは読めなかった)。
                      もとは2段のカード(69px)だったのを、切り替えと同じ1行に詰めた */}
                  <p className="hist-band-totals">
                    <span className="hist-total">
                      <span className="hist-total-label">支出(自分の分)</span>{' '}
                      <span className="hist-total-value is-expense">{yen(expenseTotal)}</span>
                    </span>
                    <span className="hist-total">
                      <span className="hist-total-label">預かり</span>{' '}
                      <span className="hist-total-value is-income">{yen(depositTotal)}</span>
                    </span>
                  </p>
                  <div className="seg hist-view-seg" role="group" aria-label="表示の切り替え">
                    <button
                      className={view === 'list' ? 'active' : ''}
                      aria-pressed={view === 'list'}
                      onClick={() => changeView('list')}
                    >
                      一覧
                    </button>
                    <button
                      className={view === 'calendar' ? 'active' : ''}
                      aria-pressed={view === 'calendar'}
                      onClick={() => changeView('calendar')}
                    >
                      カレンダー
                    </button>
                  </div>
                </div>

                {view === 'calendar' && (
                  <div className="card cal-card">
                    <div className="cal-weekdays">
                      {WEEKDAY_LABELS.map((w, i) => (
                        <span
                          key={w}
                          className={i === 0 ? 'cal-sun' : i === 6 ? 'cal-sat' : undefined}
                        >
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
                            onClick={() => selectDay(cell.iso)}
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
                    {/* 日付タップの意味を明示する。入力を始めるのは下の専用ボタン(機能053)。
                        月は左右に払っても送れることもここで言う(見た目からは分からないため) */}
                    <p className="muted cal-tap-hint">日付をタップで明細・左右に払って月を移動</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* まだ送れていない記録があるときだけ。押すとその一覧(UnsyncedSheet) */}
          {showUnsyncedChip && (
            <button
              className="hist-unsynced-chip"
              onClick={() => setShowUnsynced(true)}
              aria-haspopup="dialog"
            >
              ⚠ 未同期 {unsyncedCount}件
              <span className="hist-unsynced-chip-hint">中身を見る</span>
            </button>
          )}
        </div>

        {searching ? (
          <div className="card">
            <div className="hist-result-head">
              <span>検索結果 {results.length}件</span>
              <span className="hist-result-total">自分の分 {yen(resultTotal)}</span>
              {selectButton}
            </div>
            {/* 期間をその場で切り替える。全期間の結果に「2026年10月」の見出しが付いていて
                どの範囲の件数なのか読めなかったので、範囲は件数・合計のすぐ下で選ばせる */}
            <div className="hist-chips hist-period-chips" role="group" aria-label="探す期間">
              {PERIOD_CHIPS.map((p) => (
                <button
                  key={p}
                  className={`hist-chip${shownPeriod === p ? ' is-on' : ''}`}
                  aria-pressed={shownPeriod === p}
                  onClick={() => setFilter({ ...filter, period: p })}
                >
                  {periodChipLabel(p)}
                </button>
              ))}
            </div>

            {visibleRows.length === 0 ? (
              <p className="hist-empty">条件に合う記録は見つかりませんでした</p>
            ) : (
              visibleRows.map((t) => renderRow(t, true))
            )}

            <p className="muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
              合計は支出の実質負担分(彼女の負担分を除いた額)です
              {results.length > RESULT_LIMIT &&
                `。多いため先頭${RESULT_LIMIT}件だけ表示しています(絞り込むとすべて見られます)`}
            </p>
          </div>
        ) : view === 'list' ? (
          // 一覧: その月の記録を日付の見出しで区切って新しい順に
          <div key={`list-${month}`} className={`card hist-list-card${slideClass}`}>
            <div className="hist-result-head">
              <span>
                {monthLabel}の記録 {monthTx.length}件
              </span>
              {selectButton}
            </div>
            {monthGroups.groups.length === 0 ? (
              <p className="hist-empty">この月の記録はありません</p>
            ) : (
              monthGroups.groups.map((g) => (
                <div key={g.date} className="hist-day-group">
                  {/* 見出しの額はカレンダーのマスと同じ「自分の分」(lib/historyGroups.ts) */}
                  <h3 className="hist-day-head">
                    <span>
                      {formatDate(g.date)}
                      {g.date === today && <span className="hist-day-today">今日</span>}
                    </span>
                    {g.own > 0 && <span className="hist-day-total">{yen(g.own)}</span>}
                  </h3>
                  {g.rows.map((t) => renderRow(t, false))}
                </div>
              ))
            )}
            {monthGroups.shown < monthGroups.total && (
              <p className="muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
                多いため新しいほうから{RESULT_LIMIT}件だけ表示しています(カレンダーで日を選ぶか、絞り込むとすべて見られます)
              </p>
            )}
          </div>
        ) : (
          // カレンダー: 選んだ日の明細(これまでどおり)
          <div key={`day-${month}`} className={`card hist-day-card${slideClass}`}>
            <div className="hist-result-head">
              <span>{formatDate(selected)}</span>
              <span className="hist-result-total">自分の分 {yen(dayTotal)}</span>
              {selectButton}
            </div>

            {visibleRows.length === 0 ? (
              <p className="hist-empty">この日の記録はありません</p>
            ) : (
              visibleRows.map((t) => renderRow(t, false))
            )}

            <button className="btn-ghost day-input-btn" onClick={() => onStartInput(selected)}>
              ＋ {formatDate(selected)}で入力する
            </button>
          </div>
        )}
      </div>

      {/* ---------- 複数選択中の操作バー (機能151) ----------
          390px 幅では、4つ並べた時点で「N件を選択中」が幅39pxまで潰れて3行に折れていた
          (実測)。5つ目の「タグ」を足す余地は無いので **2段** にする。
            上段 = いまの状態と、選択そのものの操作(全部 / やめる)
            下段 = 選んだ記録に効く操作(カテゴリ / タグ / 削除)
          削除は下段の右端に離して置く。同じ行に詰めると押し間違いが痛いので、
          タグとの間は margin-left:auto で必ず空ける(元の10pxより広い)。 */}
      {selectMode && (
        <div ref={barRef} className="hist-bottom-bar hist-select-bar">
          <div className="hist-bar-line">
            <span className="hist-bar-text">{pickedTxs.length}件を選択中</span>
            <button className="hist-bar-ghost" onClick={pickAllVisible}>
              全部
            </button>
            <button className="hist-bar-ghost" onClick={exitSelect}>
              やめる
            </button>
          </div>
          <div className="hist-bar-line">
            <button
              className="hist-bar-undo"
              disabled={pickedTxs.length === 0}
              onClick={() => setBulkOpen(true)}
            >
              カテゴリ
            </button>
            <button
              className="hist-bar-undo"
              disabled={pickedTxs.length === 0}
              onClick={() => {
                setTagApplied(false)
                setTagIds(pickedTxs.map((t) => t.id))
              }}
            >
              タグ
            </button>
            <button
              className="hist-bar-danger hist-bar-apart"
              disabled={pickedTxs.length === 0}
              onClick={() => {
                deleteTxs(pickedTxs)
                exitSelect()
              }}
            >
              削除
            </button>
          </div>
        </div>
      )}

      {/* ---------- 削除直後の「元に戻す」 (機能159) ---------- */}
      {!selectMode && undoTxs && (
        <UndoDeleteBar barRef={barRef} count={undoTxs.length} onUndo={() => void store.undoDelete()} />
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
          onFilterStore={showStoreOnly}
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

      {tagIds !== null && (
        <BulkTagSheet
          targets={tagTargets}
          scopeLabel={`選んだ${tagTargets.length}件`}
          lead={
            <>
              選んだ <strong>{tagTargets.length}件</strong> にまとめてタグを付けます。
              旅行モードを使い忘れた旅行でも、あとから「旅行」や行き先の名前(「2026北海道」など)を
              付けておけば、レポートでその旅行だけを選んで見られます。
            </>
          }
          suggestionsLabel="よく使うタグ"
          suggestions={tagChoices}
          onApply={(updates) => {
            setTagApplied(true)
            void store.updateMany(updates)
          }}
          onClose={closeTagSheet}
        />
      )}

      {showLog && <ChangeLogSheet onClose={() => setShowLog(false)} />}

      {showSync && (
        <HistorySyncSheet
          syncedText={syncedText}
          refreshing={refreshing}
          logAvailable={logAvailable}
          unsyncedCount={unsyncedCount}
          onRefresh={() => void doRefresh()}
          onShowLog={() => {
            setShowSync(false)
            setShowLog(true)
          }}
          onShowUnsynced={() => {
            setShowSync(false)
            setShowUnsynced(true)
          }}
          onClose={() => setShowSync(false)}
        />
      )}

      {showUnsynced && (
        <UnsyncedSheet
          rows={unsyncedRows}
          deleteCount={unsyncedDeletes}
          isOnline={store.isOnline ?? true}
          syncing={store.syncing ?? false}
          onSendNow={() => store.syncNow()}
          onClose={() => setShowUnsynced(false)}
        />
      )}
    </div>
  )
}
