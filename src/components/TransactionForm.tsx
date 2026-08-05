import { useEffect, useRef, useState } from 'react'
import { categoryLabel, useCategories, visualFromEmojiValue } from '../lib/categories'
import { CategoryVisualBadge } from './categoryIcons'
import { daysAgoISO, formatDate, maskAmountsIn, todayISO, yen } from '../lib/format'
import {
  EMPTY_CALC,
  OP_LABEL,
  clearAll,
  pressBackspace,
  pressDigits,
  pressEquals,
  pressOperator,
  resolveForSubmit,
  type CalcOp,
  type CalcState,
} from '../lib/calc'
import { useKeypadEnabled } from '../lib/keypadSettings'
import AmountKeypad from './AmountKeypad'
import AmountTextInput from './AmountTextInput'
import { normalizeAmountInput } from '../lib/amountFormat'
import { SATISFACTION_OPTIONS, useSatisfactionAvailable } from '../lib/satisfaction'
import {
  lookupStoreCategory,
  matchStoreSuggestions,
  useStoreCategories,
} from '../lib/storeCategories'
import type { Satisfaction, Transaction, TransactionType } from '../lib/types'
import { partnerPaid, satisfactionOf, tagsOf } from '../lib/types'
import { useTxFeature } from '../lib/txExtensions'
import { settlementImpact } from '../lib/partnerSettlement'
import { collectTags, parseTagInput, sanitizeTags, MAX_TAGS_PER_TX } from '../lib/tags'
import {
  buildSplitInputs,
  carryPartnerAmount,
  evenSplit,
  splitCarryNotice,
  isSplitPart,
  splitTotal,
  validateSplit,
  MAX_SPLIT_PARTS,
  MIN_SPLIT_PARTS,
  type SplitPart,
} from '../lib/splits'
import type { TransactionInput } from '../hooks/useTransactions'
import '../ledger.css'
import { describeUnknownError, isOnlineNow } from '../lib/errorGuidance'

// 「最近の記録から入力」などの外部プリフィル。nonce が変わるたびに適用される(日付は現在の選択を維持)
export interface FormPrefill {
  nonce: number
  amount: number
  category: string | null
  memo: string
  store: string
  partner_amount: number
  // 任意: 指定があるときだけ日付も更新する(レシート読み取り用。「最近の記録から入力」は渡さない)
  date?: string
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
}

/**
 * 支払った人 (機能018)。
 * 既定は 'me'(自分が全額)で、これは機能018 より前の唯一の前提でもある。
 */
type Payer = 'me' | 'partner' | 'both'

function initialPayer(initial?: Transaction): Payer {
  if (!initial) return 'me'
  const paid = partnerPaid(initial)
  if (paid <= 0) return 'me'
  return paid >= initial.amount ? 'partner' : 'both'
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

const PAYER_OPTIONS: readonly { id: Payer; label: string }[] = [
  { id: 'me', label: '自分が全額' },
  { id: 'partner', label: '彼女が全額' },
  { id: 'both', label: '分けて払った' },
]

/** タグの候補に出す件数。多すぎると詳細欄が縦に伸びて入力の邪魔になる */
const TAG_SUGGESTION_LIMIT = 8

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
}: Props) {
  const type = fixedType ?? initial?.type ?? 'expense'
  const isExpense = type === 'expense'
  // 手動調整 (機能012) だけは残高への影響が符号つき。
  // 入力欄では絶対値を扱い、向きは専用のボタンで選ばせる
  // (符号を数字に打たせると、マイナスの打ち間違いが残高に直結する)
  const isAdjust = type === 'partner_adjust'
  const categories = useCategories()

  const [amount, setAmount] = useState(
    initial ? String(isAdjust ? Math.abs(initial.amount) : initial.amount) : ''
  )
  const [adjustSign, setAdjustSign] = useState<1 | -1>(
    initial && isAdjust && initial.amount < 0 ? -1 : 1
  )
  const [category, setCategory] = useState<string | null>(initial?.category ?? null)
  const [date, setDate] = useState(initial?.date ?? todayISO())
  const [memo, setMemo] = useState(initial?.memo ?? '')
  const [store, setStore] = useState(initial?.store ?? '')
  const [withPartner, setWithPartner] = useState((initial?.partner_amount ?? 0) > 0)
  const [partnerAmount, setPartnerAmount] = useState(
    initial && initial.partner_amount > 0 ? String(initial.partner_amount) : ''
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ---- 後から足した列に依存する項目。列が無い環境では導線ごと出さない ----
  const settlementAvailable = useTxFeature('settlement') // 機能018
  const taggingAvailable = useTxFeature('tagging') // 機能088 / 096

  // 機能018: 支払った人。既定は「自分が全額」= これまでの前提なので、
  // 何も触らなければ入力の手数はまったく増えない
  const [payer, setPayer] = useState<Payer>(() => initialPayer(initial))
  const [partnerPaidInput, setPartnerPaidInput] = useState(
    initial && partnerPaid(initial) > 0 ? String(partnerPaid(initial)) : ''
  )

  // 機能088: タグ
  const [tags, setTags] = useState<string[]>(() => (initial ? tagsOf(initial) : []))
  const [tagDraft, setTagDraft] = useState('')

  // 機能096: 分割。開いている間だけ内訳を持つ(閉じれば普通の1件に戻る)
  const [splitParts, setSplitParts] = useState<SplitPart[] | null>(null)
  // 分割を開いたときに「上段の入力をどう扱ったか」を伝える1行。
  // 支払った人・彼女の負担分は分割では使えないので、黙って捨てないための表示
  const [splitNotice, setSplitNotice] = useState<string | null>(null)
  // 金額入力の簡易電卓(保留中の値と演算子)。数字は入力欄か自前テンキーから入る
  const [calc, setCalc] = useState<{ pendingValue: number | null; pendingOp: CalcOp | null }>({
    pendingValue: null,
    pendingOp: null,
  })

  // 感情スタンプ (機能219)。列が無い環境では導線ごと出さない
  const satisfactionAvailable = useSatisfactionAvailable()
  const [satisfaction, setSatisfaction] = useState<Satisfaction | null>(
    initial ? satisfactionOf(initial) : null
  )

  // 必須でない項目(日付・お店・メモ・彼女の負担分)は畳んでおき、
  // カテゴリ→金額の2タップ(機能051)を最短距離に保つ。
  // 編集時は「今入っている内容を確かめる」画面なので最初から開く
  const [detailsOpen, setDetailsOpen] = useState(initial !== undefined)

  // 調整 (機能012) は理由を残すことが記録の目的そのものなので、
  // 理由欄が畳まれたままにならないように開いておく
  useEffect(() => {
    if (isAdjust) setDetailsOpen(true)
  }, [isAdjust])

  // 連続保存(機能048)の手応え。通常保存では 0 に戻す
  const [streak, setStreak] = useState(0)
  const [lastSavedAmount, setLastSavedAmount] = useState(0)

  // 自前テンキー(機能052)。タッチ端末では既定で有効、PC では OS のキーボードのまま
  const keypadEnabled = useKeypadEnabled()
  const [keypadOpen, setKeypadOpen] = useState(false)
  const amountRef = useRef<HTMLInputElement | null>(null)
  // プログラムからフォーカスするとき、onFocus 経由でテンキーが開くのを抑える印
  const silentFocusRef = useRef(false)

  // 店名からのカテゴリ自動選択(機能067+075)
  const learned = useStoreCategories()
  const [storeFocused, setStoreFocused] = useState(false)
  // 自動で入ったカテゴリを黙って使わせないための1行。ユーザーが選び直したら消す
  const [autoCategory, setAutoCategory] = useState<string | null>(null)

  const suggestions = storeFocused ? matchStoreSuggestions(learned, store) : []

  // 店名から学習済みのカテゴリを当てる。すでに選ばれているときは尊重する
  const applyLearnedCategory = (name: string, current: string | null): void => {
    if (current !== null) return
    const found = lookupStoreCategory(learned, name)
    if (found === null) return
    setCategory(found)
    setAutoCategory(found)
  }

  /**
   * 金額欄にフォーカスを移す (機能047)。
   * 自前テンキーが有効なときは inputMode="none" なので、フォーカスしても
   * OS のキーボードは出ない(= 画面が跳ねない)。パッドだけを開く。
   * 無効なときは OS の数値キーボードを呼ぶが、iOS はユーザー操作の延長でしか
   * 開かないので、必ずタップのハンドラの中から同期的に呼ぶこと。
   */
  const focusAmount = () => {
    const el = amountRef.current
    if (!el) return
    if (keypadEnabled) setKeypadOpen(true)
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
    const el = amountRef.current
    if (!el) return
    silentFocusRef.current = true
    el.focus({ preventScroll: true })
    el.select() // 打ち直しがそのまま置き換えになる
    silentFocusRef.current = false
  }, [initial])

  const chooseCategory = (id: string) => {
    setCategory(id)
    setAutoCategory(null) // 手で選び直したので、以降は自動選択の表示を出さない
    // 機能051(カテゴリ→金額)と機能047(金額に自動フォーカス)の両立点。
    // 入力タブを開いた瞬間ではなく「カテゴリを押した瞬間」に金額へ移す。
    // すでに金額を打ったあとの選び直しでは動かさない(キーボードが再度出て画面が跳ねる)
    if (amount === '' && calc.pendingOp === null) focusAmount()
  }

  // 編集モーダルの対象が変わったら計算途中の状態を持ち越さない
  useEffect(() => {
    setCalc(EMPTY_CALC)
  }, [initial])

  // テンキーの高さぶんの余白を本文に持たせる(保存ボタンがパッドの下に隠れないように)
  useEffect(() => {
    if (!keypadOpen) return
    document.body.classList.add('keypad-open')
    return () => document.body.classList.remove('keypad-open')
  }, [keypadOpen])

  // 金額欄・テンキー以外を触ったら閉じる。
  // blur ではなく click で閉じるのは、押した相手の onClick が先に走るようにするため
  // (先に閉じると余白が消えてボタンが指の下からずれることがある)
  useEffect(() => {
    if (!keypadOpen) return
    const onDocumentClick = (e: MouseEvent) => {
      const target = e.target
      if (!(target instanceof HTMLElement)) return
      // 「保存して続ける」は次の1件をそのまま打つためのボタンなので、閉じない
      if (
        target === amountRef.current ||
        target.closest('.keypad-dock') ||
        target.closest('.save-continue')
      ) {
        return
      }
      setKeypadOpen(false)
    }
    document.addEventListener('click', onDocumentClick)
    return () => document.removeEventListener('click', onDocumentClick)
  }, [keypadOpen])

  // 外部プリフィル適用(日付は prefill.date があるときだけ更新)
  useEffect(() => {
    if (!prefill) return
    setCalc(EMPTY_CALC) // 計算途中の状態が混ざらないようにリセット
    setAmount(prefill.amount > 0 ? String(prefill.amount) : '')
    if (prefill.date) setDate(prefill.date)
    setMemo(prefill.memo)
    setStore(prefill.store)
    setWithPartner(prefill.partner_amount > 0)
    setPartnerAmount(prefill.partner_amount > 0 ? String(prefill.partner_amount) : '')
    // テンプレート・レシート・最近の記録から入れ直すときは、
    // 前の1件の「支払った人」「タグ」「分割」を持ち越さない
    setPayer('me')
    setPartnerPaidInput('')
    setTags([])
    setTagDraft('')
    setSplitParts(null)
    setSplitNotice(null)
    // レシート読み取りのように店名だけ入ってくる場合も、手入力と同じ経路でカテゴリを補う
    setCategory(prefill.category)
    setAutoCategory(null)
    if (prefill.category === null && prefill.store !== '') {
      applyLearnedCategory(prefill.store, null)
    }
    // 畳んだままだと入った内容(お店・メモ・彼女の負担分)が見えないので開く
    if (prefill.store !== '' || prefill.memo !== '' || prefill.partner_amount > 0 || prefill.date) {
      setDetailsOpen(true)
    }
    // applyLearnedCategory は学習内容のスナップショットに依存するだけなので依存に含めない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  // カレンダーから渡された日付を反映する(機能053)。他の入力には触らない。
  // 今日以外の日付で入力することになるので、確認できるよう詳細を開く
  useEffect(() => {
    if (!datePrefill) return
    setDate(datePrefill.date)
    if (datePrefill.date !== todayISO()) setDetailsOpen(true)
  }, [datePrefill])

  const calcState: CalcState = { input: amount, pendingValue: calc.pendingValue, pendingOp: calc.pendingOp }
  // ＝ の押し忘れに備え、保留中の計算を評価した値を「確定した金額」として扱う
  const resolvedAmount = resolveForSubmit(calcState).input
  const amountNum = Number(resolvedAmount)
  const partnerNum = withPartner ? Number(partnerAmount || 0) : 0

  // 機能018: 彼女が実際に払った額。
  // 「彼女が全額」は金額を打ち直させない(支払い総額と必ず一致させる)
  const partnerPaidNum = !isExpense
    ? 0
    : payer === 'partner'
      ? amountNum
      : payer === 'both'
        ? Number(partnerPaidInput || 0)
        : 0

  // 機能096: 分割中か。編集シート(onSubmitSplit 無し)では分割しない
  const splitting = splitParts !== null
  const splitValidation = splitting ? validateSplit(splitParts, amountNum) : null

  // 機能088: 打ちかけの文字列をタグとして確定する(Enter と、欄から離れたとき)
  const commitTagDraft = () => {
    const parsed = parseTagInput(tagDraft)
    if (parsed.length === 0) {
      setTagDraft('')
      return
    }
    setTags(sanitizeTags([...tags, ...parsed]))
    setTagDraft('')
  }

  // 過去に使ったタグの候補。すでに付いているものは出さない
  const tagSuggestions = collectTags(knownTransactions ?? [], 30)
    .filter((t) => !tags.includes(t.tag))
    .slice(0, TAG_SUGGESTION_LIMIT)

  /**
   * 機能096: 分割を開く。
   * 上段の「彼女の負担分」は内訳へ引き継ぎ、引き継いだこと・
   * 「支払った人」が使われないことをその場に出す(黙って捨てない)。
   */
  const openSplit = () => {
    const carried = withPartner && partnerNum > 0 ? Math.min(partnerNum, amountNum) : 0
    setSplitParts(carryPartnerAmount(evenSplit(amountNum, 2, category), carried))
    setSplitNotice(splitCarryNotice(carried, payer !== 'me'))
  }

  const closeSplit = () => {
    setSplitParts(null)
    setSplitNotice(null)
  }

  // 機能096: 内訳の1つを書き換える
  const updatePart = (index: number, patch: Partial<SplitPart>) => {
    setSplitParts((prev) =>
      prev === null ? prev : prev.map((p, i) => (i === index ? { ...p, ...patch } : p))
    )
  }

  const runOperator = (op: CalcOp) => {
    const next = pressOperator(calcState, op)
    setAmount(next.input)
    setCalc({ pendingValue: next.pendingValue, pendingOp: next.pendingOp })
  }

  const runEquals = () => {
    const next = pressEquals(calcState)
    setAmount(next.input)
    setCalc({ pendingValue: next.pendingValue, pendingOp: next.pendingOp })
  }

  const runClear = () => {
    const next = clearAll()
    setAmount(next.input)
    setCalc({ pendingValue: next.pendingValue, pendingOp: next.pendingOp })
  }

  // テンキーの数字も演算子と同じ状態機械を通す(挙動を1本に保つため)
  const runDigits = (digits: string) => {
    setAmount(pressDigits(calcState, digits).input)
  }

  const runBackspace = () => {
    setAmount(pressBackspace(calcState).input)
  }

  // 入力中の1件が残高に与える影響額を親に通知(残高カードの見込み表示用)。
  // 分割中は内訳の負担分の合計で見る(機能096 は各行が負担分を持つ)
  useEffect(() => {
    if (!onPartnerImpactChange) return
    if (!isExpense) {
      // 預かり・返金・調整も残高を動かす (機能012)。
      // 「押す前に結果が見える」ことが安全装置なので、支出と同じ経路で親に伝える。
      // 影響額の決め方は partnerSettlement.ts の純粋関数に任せる(保存後の残高とずれない)
      const magnitude = Number.isFinite(amountNum) && amountNum > 0 ? amountNum : 0
      onPartnerImpactChange(
        settlementImpact({ type, amount: isAdjust ? adjustSign * magnitude : magnitude })
      )
      return
    }
    if (splitting && splitParts) {
      const sum = splitParts.reduce((s, p) => s + (Number.isFinite(p.partnerAmount) ? p.partnerAmount : 0), 0)
      onPartnerImpactChange(-sum)
      return
    }
    const owed = withPartner ? Number(partnerAmount || 0) : 0
    const paid = Number.isFinite(partnerPaidNum) ? partnerPaidNum : 0
    const impact = paid - (Number.isFinite(owed) && owed > 0 ? owed : 0)
    onPartnerImpactChange(Number.isFinite(impact) ? impact : 0)
  }, [
    isExpense,
    withPartner,
    partnerAmount,
    partnerPaidNum,
    splitting,
    splitParts,
    onPartnerImpactChange,
    // 預かり・返金・調整の見込み表示に効く(支出では使われない)
    type,
    isAdjust,
    adjustSign,
    amountNum,
  ])

  const partnerPaidValid =
    !isExpense ||
    payer === 'me' ||
    (Number.isInteger(partnerPaidNum) && partnerPaidNum > 0 && partnerPaidNum <= amountNum)

  const valid =
    Number.isInteger(amountNum) &&
    amountNum > 0 &&
    (!isExpense || !withPartner || (Number.isInteger(partnerNum) && partnerNum >= 0 && partnerNum <= amountNum)) &&
    partnerPaidValid &&
    // 分割中は内訳が完全に揃っていることが保存の条件。
    // ここを緩めると支出の合計と預かり残高が静かにずれる
    (!splitting ? !isExpense || category !== null : (splitValidation?.ok ?? false))

  const dateChips = [
    { label: '今日', value: daysAgoISO(0) },
    { label: '昨日', value: daysAgoISO(1) },
    { label: '一昨日', value: daysAgoISO(2) },
  ]

  // 畳んでいる間も中身が分かるようにする(特に日付が今日でないとき)
  const dateShortLabel =
    dateChips.find((c) => c.value === date)?.label ?? formatDate(date)
  const detailSummary = [
    dateShortLabel,
    store.trim(),
    memo.trim(),
    withPartner && partnerNum > 0 ? `彼女 ${yen(partnerNum)}` : '',
    // 畳んだままでも「誰が払ったか」「タグ」「分割中か」が分かるようにする
    isExpense && payer !== 'me' ? (payer === 'partner' ? '彼女が支払い' : '割り勘払い') : '',
    tags.length > 0 ? tags.map((t) => `#${t}`).join(' ') : '',
    splitting ? '分割中' : '',
  ]
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
    if (calc.pendingOp !== null) {
      setAmount(resolvedAmount)
      setCalc(EMPTY_CALC)
    }
    setBusy(true)
    setError(null)
    try {
      // 打ちかけのタグ(確定していない文字列)も取りこぼさずに拾う
      const finalTags = sanitizeTags([...tags, ...parseTagInput(tagDraft)])
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
        setAmount('')
        setCalc(EMPTY_CALC)
        setMemo('')
        setStore('')
        setWithPartner(false)
        setPartnerAmount('')
        setAutoCategory(null)
        setSatisfaction(null)
        // 支払った人・タグ・分割も1件ごとの事実なので次には持ち越さない
        setPayer('me')
        setPartnerPaidInput('')
        setTags([])
        setTagDraft('')
        setSplitParts(null)
        setSplitNotice(null)
        if (continueAfter) {
          setStreak((n) => n + 1)
          setLastSavedAmount(amountNum)
          // 保存の間に別の要素へフォーカスが移っていても金額欄に戻す
          amountRef.current?.focus({ preventScroll: true })
        } else {
          setStreak(0)
          setDetailsOpen(false)
          setKeypadOpen(false)
        }
      }
    } catch (e) {
      // 原文をそのまま出さない。原因と次の行動に置き換える (機能161)
      setError(describeUnknownError(e, isOnlineNow()))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="form-col">
      {/* 機能096: 分割された記録であることを編集画面で明示する。
          この行だけを直しても他の内訳は変わらない、と分かるようにするため */}
      {initial && isSplitPart(initial) && (
        <p className="muted">
          <span className="split-badge">分割</span> 1回の会計を分けた記録のうちの1件です(この行だけが変わります)
        </p>
      )}

      {/* 機能051: カテゴリ → 金額の順に並べる(最短2タップ+数字で保存まで届く) */}
      {isExpense && (
        <div>
          <label className="field">
            <span>カテゴリ</span>
          </label>
          <div className="category-grid">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`category-chip ${category === c.id ? 'selected' : ''}`}
                onClick={() => chooseCategory(c.id)}
              >
                <CategoryVisualBadge visual={visualFromEmojiValue(c.emoji)} size={34} />
                {c.label}
              </button>
            ))}
          </div>
          {autoCategory !== null && category === autoCategory && (
            <p className="muted auto-category-note">
              前回このお店で選んだ「{categoryLabel(autoCategory)}」にしました(違うときは選び直してください)
            </p>
          )}
        </div>
      )}

      {/* 機能012: 調整の向き。編集シートから開いたときもここで直せる */}
      {isAdjust && (
        <div className="field">
          <span>どちらに直しますか</span>
          {/* 残高の向きを決める2択。すぐ上の種類チップ(settle-mode)と同じ見た目・
              同じ 16px にそろえる — 押し間違いがそのまま残高の符号になる操作なので、
              他のチップより小さくしない */}
          <div className="settle-modes" role="group" aria-label="調整の向き">
            <button
              type="button"
              className={`settle-mode${adjustSign === 1 ? ' selected' : ''}`}
              aria-pressed={adjustSign === 1}
              onClick={() => setAdjustSign(1)}
            >
              残高を増やす
            </button>
            <button
              type="button"
              className={`settle-mode${adjustSign === -1 ? ' selected' : ''}`}
              aria-pressed={adjustSign === -1}
              onClick={() => setAdjustSign(-1)}
            >
              残高を減らす
            </button>
          </div>
        </div>
      )}

      <div className="field">
        <span>{AMOUNT_LABEL[type]}</span>
        <div className="amount-row">
          <AmountTextInput
            inputRef={amountRef}
            className={`amount-input ${amountNum < 0 ? 'negative' : ''}`}
            ariaLabel={AMOUNT_LABEL[type]}
            /* テンキー使用中も readOnly にはしない — 貼り付け・選択を殺さず、
               OS のキーボードだけを呼ばないようにする */
            inputMode={keypadEnabled ? 'none' : 'numeric'}
            placeholder="0"
            value={amount}
            onChange={setAmount}
            onFocus={() => {
              if (silentFocusRef.current) return
              if (keypadEnabled) setKeypadOpen(true)
            }}
            // すでにフォーカスがある(編集シートを開いた直後など)ときは
            // onFocus が来ないので、タップでも開けるようにしておく
            onClick={() => keypadEnabled && setKeypadOpen(true)}
          />
          <button type="button" className="amount-clear" aria-label="金額をクリア" onClick={runClear}>
            C
          </button>
        </div>
        <div className="calc-bar">
          <div className="calc-status" aria-live="polite">
            {calc.pendingOp !== null && calc.pendingValue !== null && (
              <span className="calc-pending">
                {calc.pendingValue.toLocaleString('ja-JP')} {OP_LABEL[calc.pendingOp]}
              </span>
            )}
            {amountNum < 0 && <span className="calc-warn">マイナスの金額は保存できません</span>}
          </div>
          {/* テンキーを開いている間は同じ演算子が下に出るので、こちらは畳む */}
          {!keypadOpen && (
            <div className="calc-keys">
              <button type="button" className="calc-key" aria-label="足す" onClick={() => runOperator('+')}>
                ＋
              </button>
              <button type="button" className="calc-key" aria-label="引く" onClick={() => runOperator('-')}>
                −
              </button>
              <button type="button" className="calc-key" aria-label="掛ける" onClick={() => runOperator('×')}>
                ×
              </button>
              <button
                type="button"
                className="calc-key calc-key-equals"
                aria-label="計算する"
                onClick={runEquals}
              >
                ＝
              </button>
            </div>
          )}
        </div>
      </div>

      {keypadEnabled && keypadOpen && (
        <AmountKeypad
          pending={
            calc.pendingOp !== null && calc.pendingValue !== null
              ? { value: calc.pendingValue, op: calc.pendingOp }
              : null
          }
          onDigits={runDigits}
          onBackspace={runBackspace}
          onOperator={runOperator}
          onEquals={runEquals}
          onClear={runClear}
          onDone={() => {
            setKeypadOpen(false)
            // フォーカスが金額欄に残ったままだと、もう一度タップしても開き直せない
            if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
          }}
        />
      )}

      {/* 機能219: 感情スタンプ。1タップで押せて、もう一度押すと未入力に戻せる */}
      {isExpense && satisfactionAvailable && (
        <div className="field">
          <span>この支出の気分(任意)</span>
          <div className="stamp-row" role="group" aria-label="この支出の気分">
            {SATISFACTION_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`stamp-btn ${satisfaction === o.value ? 'selected' : ''}`}
                aria-pressed={satisfaction === o.value}
                onClick={() => setSatisfaction(satisfaction === o.value ? null : o.value)}
              >
                <span className="stamp-emoji" aria-hidden="true">
                  {o.emoji}
                </span>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 必須でない項目は畳む。畳んだままでも中身が要約で分かるようにする */}
      <div className="detail-block">
        <button
          type="button"
          className="detail-toggle"
          aria-expanded={detailsOpen}
          onClick={() => setDetailsOpen(!detailsOpen)}
        >
          <span className="detail-toggle-label">
            日付・お店・メモ{isExpense ? '・彼女の分' : ''}
            {taggingAvailable ? '・タグ' : ''}
          </span>
          <span className="detail-toggle-summary">{detailSummary}</span>
          <span className="detail-toggle-caret" aria-hidden="true">
            {detailsOpen ? '▲' : '▼'}
          </span>
        </button>

        {detailsOpen && (
          <div className="form-col detail-body">
            <div className="field">
              <span>日付</span>
              <div className="date-quick">
                {dateChips.map((c) => (
                  <button
                    key={c.label}
                    type="button"
                    className={`date-chip ${date === c.value ? 'selected' : ''}`}
                    onClick={() => setDate(c.value)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>

            {isExpense && (
              <div className="field store-field">
                <span>お店(任意)</span>
                <input
                  type="text"
                  aria-label="お店"
                  placeholder="例: セブンイレブン"
                  value={store}
                  autoComplete="off"
                  onChange={(e) => setStore(e.target.value)}
                  onFocus={() => setStoreFocused(true)}
                  onBlur={() => {
                    setStoreFocused(false)
                    // 候補を選ばずに打ち切った場合も、同じ店名を知っていればカテゴリを補う
                    applyLearnedCategory(store, category)
                  }}
                />
                {suggestions.length > 0 && (
                  <ul className="store-suggestions">
                    {suggestions.map((s) => (
                      <li key={s.storeKey}>
                        <button
                          type="button"
                          className="store-suggestion"
                          // blur より先に確定させたいので mousedown/pointerdown で拾う
                          onPointerDown={(e) => {
                            e.preventDefault()
                            setStore(s.storeName)
                            setStoreFocused(false)
                            setCategory(s.category)
                            setAutoCategory(s.category)
                          }}
                        >
                          <span className="store-suggestion-name">{s.storeName}</span>
                          <span className="store-suggestion-cat">{categoryLabel(s.category)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <label className="field">
              {/* 調整だけは「なぜ直したか」が記録の本体なので、任意のメモではなく理由として聞く */}
              <span>{isAdjust ? '理由(あとで見返すために書いておくと安心です)' : 'メモ(任意)'}</span>
              <input
                type="text"
                placeholder={MEMO_PLACEHOLDER[type]}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </label>

            {/* 分割中は上段の「彼女の負担分」を出さない (機能096)。
                分割では内訳ごとの負担分だけが保存されるので、上段の欄を残すと
                「入れたのに効かない欄」になる。開いたときに値を内訳へ引き継ぎ、
                引き継いだことは split-notice に出している(黙って捨てない)。
                「分割をやめる」を押せば、入れた値のまま元の欄に戻る */}
            {isExpense && !splitting && (
              <div className="form-col">
                <button
                  type="button"
                  className={`partner-toggle ${withPartner ? 'on' : ''}`}
                  onClick={() => setWithPartner(!withPartner)}
                >
                  <span>彼女の分もまとめて払った</span>
                  <span className="toggle-check">{withPartner ? '✓' : ''}</span>
                </button>
                {withPartner && (
                  <>
                    <div className="field">
                      <span>彼女の負担分(円) — 預かり残高から差し引かれます</span>
                      <AmountTextInput
                        ariaLabel="彼女の負担分"
                        inputMode="numeric"
                        placeholder="0"
                        value={partnerAmount}
                        onChange={setPartnerAmount}
                      />
                    </div>
                    <div className="quick-row">
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={!amountNum}
                        onClick={() =>
                          setPartnerAmount(normalizeAmountInput(String(Math.round(amountNum / 2))))
                        }
                      >
                        半分
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={!amountNum}
                        onClick={() => setPartnerAmount(normalizeAmountInput(String(amountNum)))}
                      >
                        全額
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* 機能018: 誰が払ったか。既定の「自分が全額」は今までの前提そのものなので、
                触らなければ手数は増えない。分割中は使わない(splits.ts の理由を参照) */}
            {isExpense && settlementAvailable && !splitting && (
              <div className="field">
                <span>支払った人</span>
                <div className="payer-row" role="group" aria-label="支払った人">
                  {PAYER_OPTIONS.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={`payer-chip${payer === o.id ? ' selected' : ''}`}
                      aria-pressed={payer === o.id}
                      onClick={() => setPayer(o.id)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {payer === 'both' && (
                  <>
                    <div className="field">
                      <span>そのうち彼女が払った額(円)</span>
                      <AmountTextInput
                        ariaLabel="彼女が払った額"
                        inputMode="numeric"
                        placeholder="0"
                        value={partnerPaidInput}
                        onChange={setPartnerPaidInput}
                      />
                    </div>
                    {!partnerPaidValid && partnerPaidInput !== '' && (
                      <p className="error-text">彼女が払った額は、支払い金額までにしてください</p>
                    )}
                  </>
                )}
                {payer !== 'me' && (
                  <p className="muted payer-note">
                    彼女が払った {yen(partnerPaidNum || 0)} と負担分 {yen(partnerNum)} の差が、
                    預かり残高に反映されます
                  </p>
                )}
              </div>
            )}

            {/* 機能088: タグ。付けたい人だけが開く「詳細」の中に置く */}
            {taggingAvailable && (
              <div className="field tag-field">
                <span>タグ(任意・{MAX_TAGS_PER_TX}個まで)</span>
                {tags.length > 0 && (
                  <div className="tag-chips">
                    {tags.map((tag) => (
                      <span key={tag} className="tag-chip is-on">
                        #{tag}
                        <button
                          type="button"
                          className="tag-chip-remove"
                          aria-label={`タグ ${tag} を外す`}
                          onClick={() => setTags(tags.filter((x) => x !== tag))}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  type="text"
                  aria-label="タグ"
                  placeholder="例: 旅行2026 デート(空白で区切る)"
                  value={tagDraft}
                  autoComplete="off"
                  onChange={(e) => setTagDraft(e.target.value)}
                  onBlur={commitTagDraft}
                  onKeyDown={(e) => {
                    // Enter で確定。フォーム送信は起きない(button type=button のため)
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitTagDraft()
                    }
                  }}
                />
                {tagSuggestions.length > 0 && (
                  <div className="tag-chips">
                    {tagSuggestions.map((s) => (
                      <button
                        key={s.tag}
                        type="button"
                        className="tag-chip"
                        onClick={() => setTags(sanitizeTags([...tags, s.tag]))}
                      >
                        #{s.tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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
                  <div className="split-block">
                    <p className="muted">
                      内訳ごとに1件ずつ記録します。上のカテゴリではなく、下の内訳のカテゴリで残ります
                    </p>
                    {splitNotice && (
                      // 目隠し (機能169) 中は、ここに出る金額も伏せる
                      <p className="split-notice">{maskAmountsIn(splitNotice)}</p>
                    )}
                    {splitParts.map((p, i) => (
                      <div className="split-part" key={i}>
                        <div className="split-part-head">
                          <span>内訳 {i + 1}</span>
                          {splitParts.length > MIN_SPLIT_PARTS && (
                            <button
                              type="button"
                              className="btn-ghost"
                              onClick={() => setSplitParts(splitParts.filter((_, j) => j !== i))}
                            >
                              削除
                            </button>
                          )}
                        </div>
                        <select
                          className="split-cat-select"
                          aria-label={`内訳 ${i + 1} のカテゴリ`}
                          value={p.category ?? ''}
                          onChange={(e) =>
                            updatePart(i, { category: e.target.value === '' ? null : e.target.value })
                          }
                        >
                          <option value="">カテゴリを選ぶ</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                        <AmountTextInput
                          ariaLabel={`内訳 ${i + 1} の金額`}
                          inputMode="numeric"
                          placeholder="金額"
                          value={p.amount > 0 ? String(p.amount) : ''}
                          onChange={(v) => updatePart(i, { amount: Number(v || 0) })}
                        />
                        <AmountTextInput
                          ariaLabel={`内訳 ${i + 1} の彼女の負担分`}
                          inputMode="numeric"
                          placeholder="彼女の負担分(任意)"
                          value={p.partnerAmount > 0 ? String(p.partnerAmount) : ''}
                          onChange={(v) => updatePart(i, { partnerAmount: Number(v || 0) })}
                        />
                      </div>
                    ))}
                    <p
                      className={`split-remaining${splitValidation && !splitValidation.ok ? ' is-off' : ''}`}
                      aria-live="polite"
                    >
                      内訳の合計 {yen(splitTotal(splitParts))} / 支払い {yen(amountNum || 0)}
                      {/* 目隠し (機能169) 中は、残りの金額も伏せる。
                          すぐ上の合計だけ伏せて残額が見えていては意味がない */}
                      {splitValidation?.message
                        ? ` — ${maskAmountsIn(splitValidation.message)}`
                        : ' — そろっています'}
                    </p>
                    <div className="split-actions">
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={splitParts.length >= MAX_SPLIT_PARTS}
                        onClick={() =>
                          setSplitParts([
                            ...splitParts,
                            { category: null, amount: 0, partnerAmount: 0 },
                          ])
                        }
                      >
                        内訳を足す
                      </button>
                      <button type="button" className="btn-ghost" onClick={() => closeSplit()}>
                        分割をやめる
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

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
