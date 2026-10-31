import { useEffect, useMemo, useRef, useState } from 'react'
import { useCategories } from '../lib/categories'
import { daysAgoISO, formatDate, todayISO, yen } from '../lib/format'
import {
  EMPTY_CALC,
  clearAll,
  pressBackspace,
  pressDigits,
  pressEquals,
  pressOperator,
  pressPercent,
  resolveForSubmit,
  type CalcOp,
  type CalcState,
} from '../lib/calc'
import AmountKeypad from './AmountKeypad'
import AmountCalcBar from './AmountCalcBar'
import AmountTextInput from './AmountTextInput'
import { useSatisfactionAvailable } from '../lib/satisfaction'
import { buildFavor, favorColumns, favorOf, treatFromOptions, type FavorKind } from '../lib/favors'
import { matchStoreSuggestions, useStoreCategories } from '../lib/storeCategories'
import { buildStoreIndex, guessStoreCategory, isSameStore, storeOptionsFor } from '../lib/storePicker'
import type { Satisfaction, Transaction, TransactionType } from '../lib/types'
import { partnerPaid, satisfactionOf, tagsOf } from '../lib/types'
import { partnerImpact as impactOf } from '../lib/partnerBalance'
import { useTxFeature } from '../lib/txExtensions'
import { parseTagInput } from '../lib/tags'
import { mergeTripTags, tripAutoTags, useTripMode } from '../lib/tripMode'
import {
  buildSplitInputs,
  carryPartnerAmount,
  evenSplit,
  splitCarryNotice,
  isSplitPart,
  validateSplit,
  type SplitPart,
} from '../lib/splits'
import {
  draftPartnerImpact,
  initialPayer,
  initialShareMode,
  isPartnerPaidValid,
  partnerPaidAmount,
  partnerShareAmount,
  saveBlockedReason as blockedReasonOf,
  settlementPreview,
  type DraftState,
  type Payer,
  type ShareMode,
} from '../lib/transactionDraft'
import type { TransactionInput } from '../hooks/useTransactions'
import '../ledger.css'
import { describeUnknownError } from '../lib/errorGuidance'
import { isOnlineNow } from '../lib/serverErrors'
import { keypadTargetLabel, parseSplitTarget, type AmountTarget } from './txform/amountTarget'
import { useCalcField } from './txform/useCalcField'
import { useKeypadDock } from './txform/useKeypadDock'
import StepLabel from './txform/StepLabel'
import CategoryStep from './txform/CategoryStep'
import StoreStep from './txform/StoreStep'
import AdjustSignField from './txform/AdjustSignField'
import PartnerMoneyField, { type CalcActions } from './txform/PartnerMoneyField'
import DateStep from './txform/DateStep'
import SatisfactionField from './txform/SatisfactionField'
import FavorField from './txform/FavorField'
import TagField from './txform/TagField'
import SplitEditor from './txform/SplitEditor'
import TripTagRow from './txform/TripTagRow'

// 「最近の記録から入力」などの外部プリフィル。nonce が変わるたびに適用される(日付は現在の選択を維持)
export interface FormPrefill {
  nonce: number
  amount: number
  category: string | null
  memo: string
  store: string
  partner_amount: number
}

// カレンダーの日付タップ(機能053)。日付だけを差し替え、他の入力には触らない
export interface DatePrefill {
  nonce: number
  date: string
}

interface Props {
  initial?: Transaction
  submitLabel: string
  onSubmit: (input: TransactionInput) => Promise<void>
  onDelete?: () => Promise<void>
  // 新規入力タブでは type 固定の支出フォームとして使う。
  // 彼女タブの記録カードは、選んだ種類(預かる/返す/調整)をここで切り替える (機能012)
  fixedType?: 'expense' | 'partner_deposit' | 'partner_refund' | 'partner_adjust'
  // 任意: 外部からのプリフィル(編集モーダルでは使わない)
  prefill?: FormPrefill
  // 任意: 日付だけの差し替え(履歴カレンダーから「その日で入力する」)
  datePrefill?: DatePrefill
  /**
   * 任意: 入力中の1件が預かり残高に与える影響額を親に通知する(符号つき)。
   * 彼女の負担分だけならマイナス、彼女が払いすぎた回はプラス (機能018)。
   * トグルOFF・非支出時は 0。
   */
  onPartnerImpactChange?: (impact: number) => void
  /**
   * 任意: 1件を複数カテゴリに分けて保存する (機能096)。
   * 渡されたときだけ分割の導線を出す(編集シートでは分割しない)。
   */
  onSubmitSplit?: (inputs: TransactionInput[]) => Promise<void>
  /** 任意: タグの候補を出すための既存の記録 (機能088) */
  knownTransactions?: readonly Transaction[]
  /**
   * 任意: いまの預かり残高。渡すと「彼女とのお金」の下に、この1件のあとの残高まで出す。
   * 編集シートでは渡さない(この修正で動く差だけを出す)
   */
  partnerBalance?: number
}

/** 金額欄の見出し。種別ごとに何の金額を打つのかを明示する */
const AMOUNT_LABEL: Record<TransactionType, string> = {
  expense: '支払い金額(円)',
  partner_deposit: '預かり金額(円)',
  partner_refund: '返した金額(円)',
  partner_adjust: '調整する金額(円)',
}

/**
 * メモ欄の例文。種別ごとに「何を書けばいいのか」が変わる。
 * 特に調整は理由そのものが記録の値打ちなので、例を出さないと空欄で保存されやすい。
 */
const MEMO_PLACEHOLDER: Record<TransactionType, string> = {
  expense: '例: スーパーで買い物',
  partner_deposit: '例: 8月分の食費として',
  partner_refund: '例: 8月末に現金で返した',
  partner_adjust: '例: 7/3 の割り勘の計算違いを修正',
}

/**
 * 1件の記録を入れる・直すフォーム。
 *
 * ここが持つのは画面の状態(打ちかけの文字列・電卓の式・開いている欄)と、
 * それを保存する1件に組み立てる流れだけ。
 *   - 保存できるか・残高への影響 … lib/transactionDraft.ts(純粋関数)
 *   - 各段の見た目 … txform/ の部品
 *   - テンキーの開け閉め … txform/useKeypadDock.ts
 */
export default function TransactionForm({
  initial,
  submitLabel,
  onSubmit,
  onDelete,
  fixedType,
  prefill,
  datePrefill,
  onPartnerImpactChange,
  onSubmitSplit,
  knownTransactions,
  partnerBalance,
}: Props) {
  const type = fixedType ?? initial?.type ?? 'expense'
  const isExpense = type === 'expense'
  // 手動調整 (機能012) だけは残高への影響が符号つき。
  // 入力欄では絶対値を扱い、向きは専用のボタンで選ばせる
  // (符号を数字に打たせると、マイナスの打ち間違いが残高に直結する)
  const isAdjust = type === 'partner_adjust'
  const categories = useCategories()

  // 支払い金額と彼女の負担分は、それぞれ電卓の式を持つ (useCalcField)
  const amountField = useCalcField(initial ? String(isAdjust ? Math.abs(initial.amount) : initial.amount) : '')
  const [adjustSign, setAdjustSign] = useState<1 | -1>(initial && isAdjust && initial.amount < 0 ? -1 : 1)
  const [category, setCategory] = useState<string | null>(initial?.category ?? null)
  const [date, setDate] = useState(initial?.date ?? todayISO())
  // 「自動で入れた今日」。利用者が選んだ日付と区別するために持つ。
  // 開きっぱなしで日付をまたいだとき、まだ自動のままなら新しい今日へ進める
  // (選んだ日付は動かさない)。編集シートは記録の日付そのものなので対象外
  const autoDateRef = useRef<string | null>(initial ? null : date)
  const [memo, setMemo] = useState(initial?.memo ?? '')
  const [store, setStore] = useState(initial?.store ?? '')
  // 彼女の負担の入れ方 (なし / 半分 / 全部 / 金額…)。「半分」「全部」は入れ方として覚えるので、
  // 支払い金額を直せば負担も一緒に追いつく。金額を打つのは「金額…」のときだけ
  const initialShare: ShareMode =
    initial && initial.type === 'expense' ? initialShareMode(initial.amount, initial.partner_amount) : 'none'
  const [shareMode, setShareMode] = useState<ShareMode>(initialShare)
  const partnerField = useCalcField(initial && initialShare === 'custom' ? String(initial.partner_amount) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ---- 後から足した列に依存する項目。列が無い環境では導線ごと出さない ----
  const settlementAvailable = useTxFeature('settlement') // 機能018
  const taggingAvailable = useTxFeature('tagging') // 機能088 / 096

  // 機能018: 支払った人。既定は「自分が全額」= これまでの前提なので、
  // 何も触らなければ入力の手数はまったく増えない
  const [payer, setPayer] = useState<Payer>(() => initialPayer(initial))
  // 「分けて…」のときの彼女が払った額。支払い金額と同じテンキー・電卓で打つ
  const partnerPaidField = useCalcField(initial && partnerPaid(initial) > 0 ? String(partnerPaid(initial)) : '')

  // 機能088: タグ
  const [tags, setTags] = useState<string[]>(() => (initial ? tagsOf(initial) : []))
  const [tagDraft, setTagDraft] = useState('')

  // ---- おごり・値引き (favors.ts) ----
  // 「実際に払った額より本来の値段が高かった」回。列が無い環境では導線ごと出さない。
  // 既定は「無し」= これまでどおりの記録なので、触らなければ手数は1タップも増えない。
  const favorAvailable = useTxFeature('favor')
  const [favorKind, setFavorKind] = useState<FavorKind | null>(() =>
    initial ? (favorOf(initial)?.kind ?? null) : null
  )
  const favorField = useCalcField(
    (() => {
      const f = initial ? favorOf(initial) : null
      return f ? String(f.amount) : ''
    })()
  )
  const [favorFrom, setFavorFrom] = useState(() => (initial ? (favorOf(initial)?.from ?? '') : ''))

  // ---- 旅行モード (tripMode.ts) ----
  // オンの間、これから作る支出に自動でタグを付ける。
  //
  // 編集シート(initial あり)では効かせない。すでに保存された記録を開いただけで
  // タグが増えると、直したつもりのない事実が静かに変わってしまうため。
  // 預かり・返金・調整も対象外 — 旅行かどうかは支出の性質で、残高の付け替えには
  // 意味を持たない(彼女タブの見た目も変わらない)。
  const tripMode = useTripMode()
  // 「旅行中でも、コンビニで買う自分用のもの」のための1件だけの取り消し。
  // 保存するたびに false へ戻す(1件ごとの判断を次に持ち越さない)
  const [tripTagSkipped, setTripTagSkipped] = useState(false)
  // 行き先を入れて始めた旅行では、ここが ['旅行', '2026和歌山'] の2つになる
  const tripTags = tripAutoTags(initial !== undefined || !isExpense ? null : tripMode, {
    taggingAvailable,
    skippedForThisEntry: tripTagSkipped,
  })
  /** 旅行モードの表示を出すか(オンで、この記録に効きうる場面のときだけ) */
  const tripRowVisible = tripMode !== null && !initial && isExpense && taggingAvailable

  // 機能096: 分割。開いている間だけ内訳を持つ(閉じれば普通の1件に戻る)
  const [splitParts, setSplitParts] = useState<SplitPart[] | null>(null)
  // 内訳で打ちかけの式。内訳の値は数値で持つので、式の途中の文字列
  // (「100 ＋」の直後は空欄)は、いま打っている1欄ぶんだけここに置く。
  // 内訳の数値には常に「その式を今確定したらいくつか」を入れておく —
  // だから合計の確認・残高の見込み・保存・内訳の削除は、この状態を知らなくてよい
  const [splitCalc, setSplitCalc] = useState<(CalcState & { target: AmountTarget }) | null>(null)
  // 分割を開いたときに「上段の入力をどう扱ったか」を伝える1行。
  // 支払った人・彼女の負担分は分割では使えないので、黙って捨てないための表示
  const [splitNotice, setSplitNotice] = useState<string | null>(null)

  // 感情スタンプ (機能219)。列が無い環境では導線ごと出さない
  const satisfactionAvailable = useSatisfactionAvailable()
  const [satisfaction, setSatisfaction] = useState<Satisfaction | null>(initial ? satisfactionOf(initial) : null)

  // タグ・分割だけを畳む。
  // 画面の並び(カテゴリ→お店→金額→彼女とのお金→メモ→日付→保存)は、そのまま
  // 指を上から下へ動かす順番なので、主線には折りたたみを一切置かない。
  // 気分とおごりは1タップで済むので「この支出について」として常に出す
  // (以前は一緒に畳んでいて、開かれることがほとんど無かった)。
  // タグ(文字入力)と分割(内訳の編集)だけは重いので、保存の直前に畳んで置く。
  // 編集時は「今入っている内容を確かめる」画面なので最初から開く
  const [optionsOpen, setOptionsOpen] = useState(initial !== undefined)

  // 連続保存(機能048)の手応え。通常保存では 0 に戻す
  const [streak, setStreak] = useState(0)
  const [lastSavedAmount, setLastSavedAmount] = useState(0)

  // 自前テンキー(機能052)
  const keypad = useKeypadDock()
  // プログラムからフォーカスするとき、onFocus 経由でテンキーが開くのを抑える印
  const silentFocusRef = useRef(false)
  // 「分けて…」「おごり」で開く欄(開いたときにフォーカスを移す)
  const partnerPaidRef = useRef<HTMLInputElement | null>(null)
  const favorRef = useRef<HTMLInputElement | null>(null)

  // 店名からのカテゴリ自動選択(機能067+075)
  const learned = useStoreCategories()
  const [storeFocused, setStoreFocused] = useState(false)
  // 自動で入ったカテゴリを黙って使わせないための1行。ユーザーが選び直したら消す
  const [autoCategory, setAutoCategory] = useState<string | null>(null)
  // 同じ店を複数カテゴリで使っていて、どれとも決めきれないときの対抗馬。
  // 「この店だからこれ」と言い切らずに、他の候補も名前で見せるために持つ
  const [autoRivals, setAutoRivals] = useState<string[]>([])

  const suggestions = storeFocused ? matchStoreSuggestions(learned, store) : []

  /**
   * カテゴリ ↔ お店の索引。全記録から1回だけ組み立てて使い回す。
   * カテゴリを選び直しても作り直さないので、記録が数千件でも描画のたびには走らない。
   */
  const storeIndex = useMemo(
    () => buildStoreIndex(knownTransactions ?? [], learned, todayISO()),
    [knownTransactions, learned]
  )

  /**
   * 店名からカテゴリを当てる (機能067/075)。すでに選ばれているときは尊重する。
   * 同じ店を複数カテゴリで使う前提なので「最後に選んだ」ではなく
   * 「その店でいちばん多く使ったカテゴリ」を採る(storePicker.ts)。
   * 履歴がまったく無い店だけ、store_categories の学習内容にそのまま従う。
   */
  const applyLearnedCategory = (name: string, current: string | null): void => {
    if (current !== null) return
    const guess = guessStoreCategory(storeIndex, name)
    if (guess === null) return
    setAutoGuess(guess.category, guess.rivals)
  }

  /** 自動で選んだカテゴリ。割れているときは「決めつけない言い方」に切り替えるため、対抗馬も覚えておく */
  const setAutoGuess = (guessed: string, rivals: string[]) => {
    setCategory(guessed)
    setAutoCategory(guessed)
    setAutoRivals(rivals)
  }

  /**
   * 選んだカテゴリで過去に使ったお店。入力の主役はここを1タップで選ぶこと。
   * 出どころ(取引履歴 + 学習内容)と並び順の理由は storePicker.ts を参照。
   */
  const storeOptions = storeOptionsFor(storeIndex, category)

  /**
   * 金額欄にフォーカスを移す (機能047)。
   * 自前テンキーが有効なときは inputMode="none" なので、フォーカスしても
   * OS のキーボードは出ない(= 画面が跳ねない)。パッドだけを開く。
   * 無効なときは OS の数値キーボードを呼ぶが、iOS はユーザー操作の延長でしか
   * 開かないので、必ずタップのハンドラの中から同期的に呼ぶこと。
   */
  const focusAmount = () => {
    const el = keypad.amountRef.current
    if (!el) return
    openKeypadFor('amount')
    el.focus({ preventScroll: true })
    const len = el.value.length
    el.setSelectionRange(len, len)
  }

  // 編集シートを開いた直後も金額欄に当てておく (機能047)。
  // ここはタップの延長ではないので OS キーボードは出ない。テンキーも自動では
  // 開かない — 340px の余白が入ってシートが跳ね、他の項目が見えなくなるため
  const initialFocusDone = useRef(false)
  useEffect(() => {
    if (!initial || initialFocusDone.current) return
    initialFocusDone.current = true
    const el = keypad.amountRef.current
    if (!el) return
    silentFocusRef.current = true
    el.focus({ preventScroll: true })
    el.select() // 打ち直しがそのまま置き換えになる
    silentFocusRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  /** 自前テンキーを、タップされた金額欄に向けて開く。無効な端末では何もしない */
  function openKeypadFor(target: AmountTarget) {
    if (!keypad.enabled) return
    // 内訳の打ちかけの式は、パッドがその欄を離れたら畳む。
    // 内訳の値には確定後の数値が入っているので、何も失われない
    // (残すと「100 ＋」の直後の空欄のまま、100 が入っているのに見えなくなる)
    if (splitCalc && splitCalc.target !== target) setSplitCalc(null)
    keypad.openFor(target)
  }

  /** まだ何も打っていない = 次の段へ自動で送ってよい状態か (機能047) */
  const amountUntouched = amountField.input === '' && amountField.state.pendingOp === null

  const chooseCategory = (id: string) => {
    setCategory(id)
    // 手で選び直したので、以降は自動選択の表示を出さない
    setAutoCategory(null)
    setAutoRivals([])
    // 機能047 の「次へ進む導線」を新しい並びに付け直したもの。
    // カテゴリの次はお店なので、候補があるときは金額へ飛ばさない
    // (飛ばすとテンキーが開いて、すぐ下にあるお店のチップが隠れてしまう)。
    // 候補が1つも無いカテゴリは選ぶものが無いので、これまでどおり金額へ送る。
    // iOS は「タップの延長」でしか OS キーボードを開かないので、
    // 非同期にせずタップのハンドラの中から同期的に呼ぶ。
    const hasStores = storeOptionsFor(storeIndex, id).length > 0
    if (!hasStores && amountUntouched) focusAmount()
  }

  /**
   * お店を1タップで選ぶ。もう一度押すと外せる(お店は任意のため)。
   * 選んだらそのまま次の段(金額)へ送る — 上から下へ指を動かすだけで入力が進む。
   */
  const chooseStore = (name: string) => {
    const next = isSameStore(name, store) ? '' : name
    setStore(next)
    setStoreFocused(false)
    if (next !== '' && amountUntouched) focusAmount()
  }

  // 編集モーダルの対象が変わったら計算途中の状態を持ち越さない
  useEffect(() => {
    amountField.clearPending()
    partnerField.clearPending()
    partnerPaidField.clearPending()
    favorField.clearPending()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial])

  // 開きっぱなしで日付をまたいだら、自動で入れた「今日」を新しい今日へ進める。
  // ホーム画面のアプリは閉じずに何日も残るので、起動のたびには作り直されない
  useEffect(() => {
    const roll = () => {
      if (document.visibilityState === 'hidden') return
      const today = todayISO()
      const auto = autoDateRef.current
      if (auto === null || auto === today) return
      autoDateRef.current = today
      setDate((current) => (current === auto ? today : current))
    }
    document.addEventListener('visibilitychange', roll)
    window.addEventListener('focus', roll)
    return () => {
      document.removeEventListener('visibilitychange', roll)
      window.removeEventListener('focus', roll)
    }
  }, [])

  // パッドを閉じたら、内訳の打ちかけの式も畳む(理由は openKeypadFor と同じ)
  useEffect(() => {
    if (!keypad.open) setSplitCalc(null)
  }, [keypad.open])

  // 外部プリフィル適用(日付は現在の選択を維持する。差し替えたいときは DatePrefill を使う)
  useEffect(() => {
    if (!prefill) return
    // テンプレート・最近の記録から入れ直すときは、前の1件の中身(支払った人・
    // タグ・分割・おごり・気分・計算途中の式)を持ち越さない。保存のあとと同じ片付け
    resetPerEntry()
    amountField.setInput(prefill.amount > 0 ? String(prefill.amount) : '')
    setMemo(prefill.memo)
    setStore(prefill.store)
    // 負担は入れ方として読み戻す(半分なら「半分」。金額を直せば追いつく)
    const share = initialShareMode(prefill.amount, prefill.partner_amount)
    setShareMode(share)
    partnerField.setInput(share === 'custom' ? String(prefill.partner_amount) : '')
    // カテゴリ無しで店名だけ入ってくる場合も、手入力と同じ経路でカテゴリを補う
    setCategory(prefill.category)
    if (prefill.category === null && prefill.store !== '') {
      applyLearnedCategory(prefill.store, null)
    }
    // お店・メモ・彼女の負担分・日付はすべて主線に出ているので、開く操作は要らない
    // (入った内容は、そのまま上から下に読んで確認できる)
    // applyLearnedCategory は学習内容のスナップショットに依存するだけなので依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  // カレンダーから渡された日付を反映する(機能053)。他の入力には触らない。
  // 日付欄は主線の最後にあって畳まれていないが、入力中は画面の外に出やすいので、
  // 今日以外のときは金額欄のすぐ下にも「いつの記録か」を出す(下の date-lead)
  useEffect(() => {
    if (!datePrefill) return
    setDate(datePrefill.date)
  }, [datePrefill])

  // ＝ の押し忘れに備え、保留中の計算を評価した値を「確定した金額」として扱う
  const amountNum = Number(amountField.resolved)
  // 彼女の負担。「金額…」で打つ欄も、＝ の押し忘れは保留中の計算を評価した値で扱う。
  // 保存される額・残高の見込み・「支払い金額を超えていないか」の判定が
  // すべてこの1つの値を見るので、どこか1か所だけ式のまま、ということが起きない
  const withPartner = isExpense && shareMode !== 'none'
  const partnerNum = isExpense ? partnerShareAmount(shareMode, amountNum, partnerField.resolved) : 0

  // 機能018: 彼女が実際に払った額
  const partnerPaidNum = partnerPaidAmount(type, payer, amountNum, partnerPaidField.resolved)

  // 機能096: 分割中か。編集シート(onSubmitSplit 無し)では分割しない
  const splitting = splitParts !== null

  /**
   * この記録に付くおごり・値引き。付いていなければ null。
   *
   * 分割中は必ず null にする — 浮いた額を内訳のどれに割り当てるかは決めようがなく、
   * 按分すれば1円がどこかに寄る。開いたときに外れることは、その場に出す
   * (splitNotice。黙って捨てない)。
   */
  const favor =
    isExpense && favorAvailable && !splitting ? buildFavor(favorKind, Number(favorField.resolved || 0), favorFrom) : null

  const splitValidation = splitting ? validateSplit(splitParts, amountNum) : null

  // 保存できるか・残高への影響を決めるのに要る中身 (transactionDraft.ts)
  const draft: DraftState = {
    type,
    category,
    amount: amountNum,
    withPartner,
    partnerAmount: partnerNum,
    payer,
    partnerPaid: partnerPaidNum,
    hasFavor: favor !== null,
    splitting,
    splitOk: splitValidation?.ok ?? false,
  }
  const partnerPaidValid = isPartnerPaidValid(draft)
  // 保存ボタンが押せない理由。**保存できるかの判定はこの1本だけ**
  const saveBlockedReason = blockedReasonOf(draft)
  const valid = saveBlockedReason === null

  /**
   * 機能096: 分割を開く。
   * 上段の「彼女の負担分」は内訳へ引き継ぎ、引き継いだこと・
   * 「支払った人」が使われないことをその場に出す(黙って捨てない)。
   */
  const openSplit = () => {
    const carried = withPartner && partnerNum > 0 ? Math.min(partnerNum, amountNum) : 0
    setSplitParts(carryPartnerAmount(evenSplit(amountNum, 2, category), carried))
    setSplitNotice(splitCarryNotice(carried, payer !== 'me', favor !== null))
  }

  const closeSplit = () => {
    releaseSplitTargets()
    setSplitParts(null)
    setSplitNotice(null)
  }

  /**
   * 内訳の並びが変わるとき(削除・分割をやめる・保存のあと)。
   * 打ちかけの式とパッドの行き先は行の番号で指しているので、番号がずれる前に
   * 片付ける。内訳の値は確定後の数値が入っているので、片付けても失われない
   */
  function releaseSplitTargets() {
    setSplitCalc(null)
    if (parseSplitTarget(keypad.target)) keypad.release()
  }

  /**
   * 1件ごとの事実を空に戻す。保存のあとと、テンプレート・最近の記録から
   * 入れ直すときの両方がここを通る(以前は同じ十数行を2か所に書いていて、
   * 入れ直すときだけ気分が残る・分割に向いたパッドが残る、と食い違っていた)。
   * 日付とカテゴリはここでは触らない — 残すかどうかは呼ぶ側が決める。
   *
   * どれも次の1件に持ち越してはいけないもの:
   *   支払った人・タグ・分割 … 1件ごとの事実。残ると知らないうちに
   *     「彼女が払った」扱いになり、預かり残高が動く
   *   おごり・値引き … 残ると、覚えのない「◯◯さんのおごり」が静かに増えていく
   *   「この1件だけ旅行タグを外す」 … 残ると、外したことを忘れたまま
   *     旅行中の記録が抜け落ちる
   */
  function resetPerEntry() {
    amountField.setDirect('')
    setMemo('')
    setStore('')
    setShareMode('none')
    partnerField.setDirect('')
    // 彼女の負担分の欄は閉じるので、パッドは支払い金額へ戻す
    keypad.setTarget('amount')
    setAutoCategory(null)
    setAutoRivals([])
    setSatisfaction(null)
    setPayer('me')
    partnerPaidField.setDirect('')
    setTags([])
    setTagDraft('')
    setFavorKind(null)
    favorField.setDirect('')
    setFavorFrom('')
    releaseSplitTargets()
    setSplitParts(null)
    setSplitNotice(null)
    setTripTagSkipped(false)
  }

  // 機能096: 内訳の1つを書き換える
  const updatePart = (index: number, patch: Partial<SplitPart>) => {
    setSplitParts((prev) => (prev === null ? prev : prev.map((p, i) => (i === index ? { ...p, ...patch } : p))))
  }

  // 電卓の操作は、どの金額欄でも calc.ts の同じ状態機械を通す(挙動を1本に保つため)。
  // 欄ごとに「入力中の文字列」と「保留中の式」を持ち、ここで取り替えるだけ。
  // 行き先は必ず呼び出し側が名指しする — 省略できるようにすると、
  // onClick にそのまま渡したときにイベントが行き先として紛れ込む
  /** 分割の内訳以外の金額欄。行き先ごとに電卓つきの欄を1つずつ持つ(内訳は calcOf / applyTo が先に扱う) */
  const fieldOf = (target: AmountTarget) =>
    target === 'partner'
      ? partnerField
      : target === 'partnerPaid'
        ? partnerPaidField
        : target === 'favor'
          ? favorField
          : amountField

  const calcOf = (target: AmountTarget): CalcState => {
    const split = parseSplitTarget(target)
    if (split) {
      const part = splitParts?.[split.index]
      if (!part) return EMPTY_CALC
      if (splitCalc?.target === target) return splitCalc
      const value = part[split.field]
      return { input: value !== 0 ? String(value) : '', pendingValue: null, pendingOp: null }
    }
    return fieldOf(target).state
  }

  const applyTo = (target: AmountTarget, next: CalcState) => {
    const split = parseSplitTarget(target)
    if (split) {
      if (!splitParts?.[split.index]) return
      // 式が残っている間だけ文字列を持つ。確定したら内訳の数値だけで足りる
      setSplitCalc(next.pendingOp === null ? null : { ...next, target })
      updatePart(split.index, { [split.field]: Number(resolveForSubmit(next).input || 0) })
      return
    }
    fieldOf(target).apply(next)
  }

  const runOperator = (target: AmountTarget, op: CalcOp) => applyTo(target, pressOperator(calcOf(target), op))
  const runEquals = (target: AmountTarget) => applyTo(target, pressEquals(calcOf(target)))
  // ％キーと「税込にする」も同じ状態機械を通す
  const runPercent = (target: AmountTarget) => applyTo(target, pressPercent(calcOf(target)))
  const runClear = (target: AmountTarget) => applyTo(target, clearAll())
  // テンキーの数字も演算子と同じ状態機械を通す
  const runDigits = (target: AmountTarget, digits: string) => applyTo(target, pressDigits(calcOf(target), digits))
  const runBackspace = (target: AmountTarget) => applyTo(target, pressBackspace(calcOf(target)))

  // 入力中の1件が残高に与える影響額を親に通知(残高カードの見込み表示用)。
  // 「押す前に結果が見える」ことが安全装置。決め方は transactionDraft.ts
  const partnerImpact = draftPartnerImpact({
    ...draft,
    adjustSign,
    splitPartnerAmounts: splitParts?.map((p) => p.partnerAmount) ?? [],
  })
  useEffect(() => {
    onPartnerImpactChange?.(partnerImpact)
  }, [partnerImpact, onPartnerImpactChange])

  // 「彼女とのお金」のすぐ下に出す、押す前の結果。直すときは、この修正で動く差だけ
  const preview = settlementPreview({
    impact: partnerImpact,
    balance: partnerBalance,
    originalImpact: initial ? impactOf(initial) : undefined,
  })

  /** 電卓の操作(「金額…」「分けて…」「おごり」の欄が OS キーボードのときに使う) */
  const calcActions: CalcActions = {
    operator: runOperator,
    equals: runEquals,
    percent: runPercent,
    apply: applyTo,
  }

  /**
   * 開いたばかりの欄へテンキーを向け、フォーカスを移す。
   * 欄はこの押下で描かれるので、描かれたあと(次の描画)に移す。
   * テンキーが無効な端末では OS のキーボードがそのまま出る
   */
  const focusField = (target: AmountTarget, ref: { current: HTMLInputElement | null }) => {
    openKeypadFor(target)
    requestAnimationFrame(() => ref.current?.focus({ preventScroll: true }))
  }

  /** 彼女の負担の入れ方を選ぶ */
  const chooseShare = (mode: ShareMode) => {
    if (mode === 'custom') {
      // 「半分」などから移ったときは、その額を打ち直しの出発点にする
      if (shareMode !== 'custom') partnerField.setDirect(partnerNum > 0 ? String(partnerNum) : '')
      setShareMode('custom')
      focusField('partner', keypad.partnerRef)
      return
    }
    // 欄が消えるので、打ちかけの式とパッドの行き先も片付ける
    // (消えた欄に向いたままのパッドで打つと、見えない所に数字が入る)
    partnerField.clearPending()
    if (keypad.target === 'partner') keypad.release()
    setShareMode(mode)
  }

  /** 払った人を選ぶ */
  const choosePayer = (next: Payer) => {
    setPayer(next)
    if (next === 'both') {
      focusField('partnerPaid', partnerPaidRef)
      return
    }
    partnerPaidField.clearPending()
    if (keypad.target === 'partnerPaid') keypad.release()
  }

  /** おごり・割引を選ぶ / 外す */
  const chooseFavor = (kind: FavorKind | null) => {
    if (kind === null) {
      // 外したときに額と相手も消すのは、選び直したときに
      // 前の相手の名前が残っていると事実が入れ替わるため
      setFavorKind(null)
      favorField.setDirect('')
      setFavorFrom('')
      if (keypad.target === 'favor') keypad.release()
      return
    }
    setFavorKind(kind)
    if (kind === 'discount') setFavorFrom('')
    focusField('favor', favorRef)
  }

  const dateChips = [
    { label: '今日', value: daysAgoISO(0) },
    { label: '昨日', value: daysAgoISO(1) },
    { label: '一昨日', value: daysAgoISO(2) },
  ]

  // 日付は主線の最後にあるので、入力中は画面の外に出ていることがある。
  // 今日でないときだけ、金額のすぐ下に「いつの記録か」を出して不安をなくす(機能053)
  const dateShortLabel = dateChips.find((c) => c.value === date)?.label ?? formatDate(date)
  const dateIsToday = date === daysAgoISO(0)

  // 畳んでいる「タグ・分割」の中身を、開かなくても分かるようにする1行
  const optionSummary = [tags.length > 0 ? tags.map((t) => `#${t}`).join(' ') : '', splitting ? '分割中' : '']
    .filter((s) => s !== '')
    .join('・')

  /**
   * 保存する。continueAfter = true のときは画面を閉じずに次の1件へ進む(機能048)。
   * 日付とカテゴリは残し、その1件ごとに変わる項目(金額・お店・メモ・彼女の負担分・
   * 感情スタンプ)だけを空にする。
   */
  const submit = async (continueAfter: boolean) => {
    // 続けて入力するときは、保存を待つ前にフォーカスを確保しておく。
    // iOS は「タップの延長」でしか OS キーボードを開かないので、
    // await のあとに focus してもキーボードが出ない
    if (continueAfter && !initial) focusAmount()
    // 保留中の計算があれば評価してから保存する(＝の押し忘れ対策)。画面にも結果を反映
    for (const f of [amountField, partnerField, partnerPaidField, favorField]) {
      if (f.state.pendingOp !== null) f.setDirect(f.resolved)
    }
    setBusy(true)
    setError(null)
    try {
      // 打ちかけのタグ(確定していない文字列)も取りこぼさずに拾い、
      // 旅行モードのタグを足す(オフのときは tripTags が空なので何も変わらない)
      const finalTags = mergeTripTags([...tags, ...parseTagInput(tagDraft)], tripTags)
      const payload: TransactionInput = {
        date,
        type,
        amount: isAdjust ? adjustSign * amountNum : amountNum,
        category: isExpense ? category : null,
        memo: memo.trim(),
        store: isExpense ? store.trim() : '',
        partner_amount: isExpense ? partnerNum : 0,
        // 列が無い環境では送らない(同期が止まらないように)
        ...(isExpense && satisfactionAvailable ? { satisfaction } : {}),
        ...(isExpense && settlementAvailable ? { partner_paid: partnerPaidNum } : {}),
        ...(taggingAvailable ? { tags: finalTags } : {}),
        // おごり・値引き。付いていないときも「無し」を明示的に送る —
        // 編集で外したときにキーごと消すと、サーバー側に前の値が残ってしまう
        ...(isExpense && favorAvailable ? favorColumns(favor) : {}),
      }

      // 機能096: 分割は「カテゴリごとの独立した記録」としてまとめて保存する。
      // 1行にまとめないので、レポートの集計も残高の足し算も既存のまま正しい
      if (splitting && splitParts && onSubmitSplit) {
        await onSubmitSplit(buildSplitInputs(payload, splitParts, crypto.randomUUID()))
      } else {
        await onSubmit(payload)
      }
      // 新規入力時のみリセット(編集モーダルは親が閉じる)
      if (!initial) {
        resetPerEntry()
        if (continueAfter) {
          setStreak((n) => n + 1)
          setLastSavedAmount(amountNum)
          // 保存の間に別の要素へフォーカスが移っていても金額欄に戻す
          keypad.amountRef.current?.focus({ preventScroll: true })
        } else {
          setStreak(0)
          setOptionsOpen(false)
          keypad.setOpen(false)
          // 「保存して続ける」だけが日付とカテゴリを残す(README の約束)。
          // 「記録する」で残すと、昨日の分を入れたあとの次の1件が、
          // 気付かないまま昨日の日付・同じカテゴリで保存される
          const today = todayISO()
          setDate(today)
          autoDateRef.current = today
          setCategory(null)
        }
      }
    } catch (e) {
      // 原文をそのまま出さない。原因と次の行動に置き換える (機能161)
      setError(describeUnknownError(e, isOnlineNow()))
    } finally {
      setBusy(false)
    }
  }

  const stepNo = (n: number) => (isExpense ? n : undefined)

  return (
    <div className="form-col">
      {/* 機能096: 分割された記録であることを編集画面で明示する。
          この行だけを直しても他の内訳は変わらない、と分かるようにするため */}
      {initial && isSplitPart(initial) && (
        <p className="muted">
          <span className="split-badge">分割</span> 1回の会計を分けた記録のうちの1件です(この行だけが変わります)
        </p>
      )}

      {/* 入力は上から下へ1本道:
          1 カテゴリ → 2 お店 → 3 金額 → 4 メモ/彼女の分 → 5 日付 → 保存。
          画面の並びがそのまま操作の順番になるように、主線には折りたたみを置かない
          (「開く」という操作が縦の流れに割り込むため)。機能051 の
          「カテゴリを先に選ぶ」はそのまま、その次にお店を挟んだ形 */}
      {isExpense && (
        <CategoryStep
          categories={categories}
          category={category}
          onChoose={chooseCategory}
          autoCategory={autoCategory}
          autoRivals={autoRivals}
        />
      )}

      {isExpense && (
        <StoreStep
          store={store}
          onStoreChange={setStore}
          category={category}
          storeOptions={storeOptions}
          suggestions={suggestions}
          storeIndex={storeIndex}
          onChooseStore={chooseStore}
          onFocus={() => setStoreFocused(true)}
          onBlur={() => {
            setStoreFocused(false)
            // 候補を選ばずに打ち切った場合も、同じ店名を知っていればカテゴリを補う
            applyLearnedCategory(store, category)
          }}
          onPickSuggestion={(name, guessed, rivals) => {
            setStore(name)
            setStoreFocused(false)
            // すでに選んでいるカテゴリは上書きしない。
            // カテゴリ → お店 の順に進む流れで、あとから店を選んだだけで
            // カテゴリが勝手に変わると、選んだつもりの分類で残らない
            if (category === null) setAutoGuess(guessed, rivals)
          }}
        />
      )}

      {isAdjust && <AdjustSignField sign={adjustSign} onChange={setAdjustSign} />}

      {/* 3. 金額。桁区切り(050)は AmountTextInput、電卓は AmountCalcBar、
          自前テンキー(052)は下の AmountKeypad */}
      <div className="field form-step">
        <StepLabel no={stepNo(3)}>{AMOUNT_LABEL[type]}</StepLabel>
        <div className="amount-row">
          <AmountTextInput
            inputRef={keypad.amountRef}
            className={`amount-input ${amountNum < 0 ? 'negative' : ''}`}
            ariaLabel={AMOUNT_LABEL[type]}
            /* テンキー使用中も readOnly にはしない — 貼り付け・選択を殺さず、
               OS のキーボードだけを呼ばないようにする */
            inputMode={keypad.enabled ? 'none' : 'numeric'}
            placeholder="0"
            value={amountField.input}
            onChange={amountField.setInput}
            onFocus={() => {
              if (silentFocusRef.current) return
              openKeypadFor('amount')
            }}
            // すでにフォーカスがある(編集シートを開いた直後など)ときは
            // onFocus が来ないので、タップでも開けるようにしておく
            onClick={() => openKeypadFor('amount')}
          />
          <button type="button" className="amount-clear" aria-label="金額をクリア" onClick={() => runClear('amount')}>
            C
          </button>
        </div>
        {/* テンキーを開いている間は同じ演算子が下に出るので、＋ − × ＝ は畳む */}
        <AmountCalcBar
          state={amountField.state}
          showKeys={!keypad.open}
          onOperator={(op) => runOperator('amount', op)}
          onEquals={() => runEquals('amount')}
          onPercent={() => runPercent('amount')}
          onApply={(next) => applyTo('amount', next)}
          warning={amountNum < 0 && <span className="calc-warn">マイナスの金額は保存できません</span>}
          // 預かり・返金・調整の金額には消費税が掛からない
          showTax={isExpense}
        />
      </div>

      {keypad.enabled && keypad.open && (
        <AmountKeypad
          pending={(() => {
            const { pendingValue, pendingOp } = calcOf(keypad.target)
            return pendingOp !== null && pendingValue !== null ? { value: pendingValue, op: pendingOp } : null
          })()}
          targetLabel={keypadTargetLabel(keypad.target)}
          onDigits={(digits) => runDigits(keypad.target, digits)}
          onBackspace={() => runBackspace(keypad.target)}
          onOperator={(op) => runOperator(keypad.target, op)}
          onEquals={() => runEquals(keypad.target)}
          onClear={() => runClear(keypad.target)}
          onDone={() => {
            keypad.setOpen(false)
            // フォーカスが金額欄に残ったままだと、もう一度タップしても開き直せない
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
          }}
        />
      )}

      {/* 日付は主線の最後(下)にある。今日以外の日で入力しているときだけ、
          金額のすぐ下にも出しておく — カレンダーから始めた入力(機能053)で
          「いつの記録なのか」が画面の外に行ったままにならないように */}
      {!dateIsToday && (
        <p className="date-lead" aria-live="polite" ref={keypad.dateLeadRef}>
          この記録は <strong>{dateShortLabel}</strong> で保存されます(日付は下で変えられます)
        </p>
      )}

      {/* 4. 彼女とのお金。「彼女の負担」と「払った人」を同じ形の2行で聞き、
          預かり残高がどう動くかをすぐ下に出す (PartnerMoneyField)。
          金額のすぐ下に置くのは、金額を打ち終えた指でそのまま押せるようにするため
          (テンキーを開いたときも、この段までテンキーの上に見せる)。
          分割中は出さない (機能096)。分割では内訳ごとの負担分だけが保存されるので、
          ここを残すと「入れたのに効かない欄」になる。開いたときに値を内訳へ引き継ぎ、
          引き継いだことは split-notice に出している(黙って捨てない)。
          「分割をやめる」を押せば、入れた値のまま戻る */}
      {isExpense && !splitting && (
        <PartnerMoneyField
          stepNo={stepNo(4)}
          rowRef={keypad.amountFollowRef}
          shareMode={shareMode}
          onShareMode={chooseShare}
          shareAmount={partnerNum}
          customField={partnerField}
          customRef={keypad.partnerRef}
          payerAvailable={settlementAvailable}
          payer={payer}
          onPayer={choosePayer}
          paidField={partnerPaidField}
          paidRef={partnerPaidRef}
          partnerPaidValid={partnerPaidValid}
          keypadEnabled={keypad.enabled}
          onOpenKeypad={openKeypadFor}
          calc={calcActions}
          preview={preview}
        />
      )}
      {isExpense && splitting && (
        <div className="field form-step">
          <StepLabel no={stepNo(4)}>彼女とのお金</StepLabel>
          <p className="muted">分割中は、下の内訳ごとに彼女の負担を入れます</p>
        </div>
      )}

      {/* 5. メモ。調整だけは「なぜ直したか」が記録の本体なので、任意のメモではなく理由として聞く */}
      <label className="field form-step">
        <StepLabel no={stepNo(5)}>
          {isAdjust ? '理由(あとで見返すために書いておくと安心です)' : 'メモ(任意)'}
        </StepLabel>
        <input type="text" placeholder={MEMO_PLACEHOLDER[type]} value={memo} onChange={(e) => setMemo(e.target.value)} />
      </label>

      <DateStep date={date} onDate={setDate} chips={dateChips} stepNo={stepNo(6)} />

      {/* この支出について — 気分(219)・おごり(favors.ts)。どちらも1タップで済むので畳まない。
          保存ボタンの直前に置くのは、指が必ず通る場所だから(気分は振り返りなので最後に聞く)。
          既定はどちらも選ばれていないので、触らなければ手数は1タップも増えない */}
      {isExpense && (satisfactionAvailable || favorAvailable) && (
        <div className="field about-expense">
          <span className="about-expense-title">この支出について(任意)</span>
          {satisfactionAvailable && <SatisfactionField value={satisfaction} onChange={setSatisfaction} />}
          {favorAvailable && (
            <FavorField
              kind={favorKind}
              onKind={chooseFavor}
              amountField={favorField}
              amountRef={favorRef}
              from={favorFrom}
              onFrom={setFavorFrom}
              // おごってくれた人の候補。過去の記録から、最近ご馳走になった順に出す
              // (毎回打ち直させると「田中 / 田中さん」と揺れて、人ごとの集計が割れてしまう)
              treatOptions={treatFromOptions(knownTransactions ?? [])}
              favor={favor}
              paidAmount={amountNum}
              onPaidWasTotal={() => {
                const favorAmount = Number(favorField.resolved || 0)
                amountField.setDirect(String(amountNum - favorAmount))
              }}
              // 分割中は付けられない(浮いた額を内訳に割り振れないため。splits.ts)
              disabled={splitting}
              keypadEnabled={keypad.enabled}
              onOpenKeypad={() => openKeypadFor('favor')}
              calc={calcActions}
            />
          )}
        </div>
      )}

      {/* タグ(088)・分割(096)。文字を打つ・内訳を組むという重い入力なので、
          ここだけは畳んで保存の直前に置く。畳んだままでも中身は右側の要約に出る */}
      {taggingAvailable && (
        <div className="detail-block">
          <button
            type="button"
            className="detail-toggle"
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen(!optionsOpen)}
          >
            <span className="detail-toggle-label">{`＃タグ${isExpense && onSubmitSplit ? '・分割' : ''}`}</span>
            <span className="detail-toggle-summary">{optionSummary}</span>
            <span className="detail-toggle-caret" aria-hidden="true">
              {optionsOpen ? '▲' : '▼'}
            </span>
          </button>

          {optionsOpen && (
            <div className="form-col detail-body">
              {taggingAvailable && (
                <TagField
                  tags={tags}
                  onTags={setTags}
                  draft={tagDraft}
                  onDraft={setTagDraft}
                  knownTransactions={knownTransactions ?? []}
                />
              )}

              {/* 機能096: 分割。入力タブからのみ(編集シートでは各行を個別に直す) */}
              {isExpense && taggingAvailable && onSubmitSplit && (
                <div className="form-col">
                  {!splitting ? (
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={!Number.isInteger(amountNum) || amountNum <= 0}
                      onClick={() => openSplit()}
                    >
                      カテゴリを分けて記録する
                    </button>
                  ) : (
                    <SplitEditor
                      parts={splitParts}
                      categories={categories}
                      notice={splitNotice}
                      validation={splitValidation}
                      amount={amountNum}
                      keypadEnabled={keypad.enabled}
                      inputOf={(target) => calcOf(target).input}
                      onCategory={(i, c) => updatePart(i, { category: c })}
                      onInput={(i, field, raw) => {
                        // 手で打ち直したら、その欄の打ちかけの式は捨てる
                        if (splitCalc?.target === `split:${i}:${field}`) setSplitCalc(null)
                        updatePart(i, { [field]: Number(raw || 0) })
                      }}
                      onOpenKeypad={openKeypadFor}
                      onRemove={(i) => {
                        releaseSplitTargets()
                        setSplitParts(splitParts.filter((_, j) => j !== i))
                      }}
                      onAdd={() => setSplitParts([...splitParts, { category: null, amount: 0, partnerAmount: 0 }])}
                      onClose={closeSplit}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* オフのときは何も描かないので、入力の手数は1タップも増えない */}
      {tripRowVisible && tripMode !== null && (
        <TripTagRow mode={tripMode} tags={tripTags} onToggleSkip={() => setTripTagSkipped(!tripTagSkipped)} />
      )}

      {error && <p className="error-text">{error}</p>}

      {/* 灰色になるだけでは、初めての人は何が足りないのか分からない */}
      {saveBlockedReason && !busy && (
        <p className="save-blocked" aria-live="polite">
          {saveBlockedReason}
        </p>
      )}

      {/* 機能048: 主は「記録する」、副が「保存して続ける」 */}
      <div className="save-row">
        {!initial && (
          <button
            type="button"
            className="btn-secondary save-continue"
            disabled={!valid || busy}
            onClick={() => void submit(true)}
          >
            保存して続ける
          </button>
        )}
        <button className="btn-primary save-main" disabled={!valid || busy} onClick={() => void submit(false)}>
          {busy ? '保存中…' : submitLabel}
        </button>
      </div>

      {streak > 0 && (
        <p className="streak-note" aria-live="polite">
          続けて{streak}件記録しました(最後は {yen(lastSavedAmount)})
        </p>
      )}

      {onDelete && (
        <button className="btn-ghost" style={{ color: 'var(--expense)' }} disabled={busy} onClick={onDelete}>
          削除する
        </button>
      )}
    </div>
  )
}
