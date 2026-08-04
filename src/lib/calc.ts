/* ============================================================
   金額入力の簡易電卓(足し算・引き算・掛け算)
   - iOS の数字キーボードには + - × が無いため、数字はネイティブ入力欄のまま、
     演算子だけをボタンで扱う。ここはその状態遷移だけを担う純粋関数群。
   - 扱うのは円単位の整数のみ。React に依存しないので単体テストできる。
   ============================================================ */

export type CalcOp = '+' | '-' | '×'

export interface CalcState {
  /** 金額入力欄の生の文字列(input[type=number] の value) */
  input: string
  /** 確定済みの計算途中の値 */
  pendingValue: number | null
  /** 保留中の演算子 */
  pendingOp: CalcOp | null
}

export const EMPTY_CALC: CalcState = { input: '', pendingValue: null, pendingOp: null }

/** 画面表示用の演算子ラベル(全角で見やすく) */
export const OP_LABEL: Record<CalcOp, string> = { '+': '＋', '-': '−', '×': '×' }

/** 二項演算。円単位の整数のみを扱う。 */
export function applyOp(a: number, op: CalcOp, b: number): number {
  switch (op) {
    case '+':
      return a + b
    case '-':
      return a - b
    case '×':
      return a * b
  }
}

/**
 * 入力欄の文字列を整数に変換する。空・不正な値は null。
 * 小数が入力された場合(type=number では '.' が打てる)は四捨五入して円に丸める。
 */
export function parseAmountInput(input: string): number | null {
  const s = input.trim()
  if (s === '') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n)
  return Number.isSafeInteger(rounded) ? rounded : null
}

/**
 * 保留中の計算を評価する。評価できない(演算子や値が揃っていない、
 * 桁あふれする)場合は null。
 */
export function evaluatePending(state: CalcState): number | null {
  const { pendingValue, pendingOp } = state
  if (pendingOp === null || pendingValue === null) return null
  const b = parseAmountInput(state.input)
  if (b === null) return null
  const result = applyOp(pendingValue, pendingOp, b)
  return Number.isSafeInteger(result) ? result : null
}

/**
 * 演算子ボタン(＋ − ×)を押したときの遷移。
 * - 入力値があり保留演算子もある → まず保留計算を評価して pendingValue を更新
 * - 入力値があり保留演算子が無い → 入力値を pendingValue にする
 * - 入力欄が空 → pendingValue はそのまま(演算子の付け替え)
 * いずれも pendingOp を押した演算子にし、入力欄をクリアして次の数値を待つ。
 * まだ何も入力されていない(pendingValue も無い)ときは何もしない。
 */
export function pressOperator(state: CalcState, op: CalcOp): CalcState {
  const current = parseAmountInput(state.input)

  if (current === null) {
    // 入力欄が空 → 演算子の付け替えとして扱う(計算対象が無ければ無視)
    if (state.pendingValue === null) return state
    return { input: '', pendingValue: state.pendingValue, pendingOp: op }
  }

  const base = state.pendingOp !== null ? (evaluatePending(state) ?? state.pendingValue ?? current) : current
  return { input: '', pendingValue: base, pendingOp: op }
}

/**
 * ＝ を押したときの遷移。保留計算を評価して結果を入力欄に入れ、保留状態を消す。
 * - 評価できないときは、保留値があればそれを入力欄に戻して保留状態だけ消す
 *   (例: 「100 ＋」の直後に ＝ → 100)
 */
export function pressEquals(state: CalcState): CalcState {
  const result = evaluatePending(state)
  if (result !== null) {
    return { input: String(result), pendingValue: null, pendingOp: null }
  }
  if (state.pendingOp !== null && state.pendingValue !== null && parseAmountInput(state.input) === null) {
    return { input: String(state.pendingValue), pendingValue: null, pendingOp: null }
  }
  return { input: state.input, pendingValue: null, pendingOp: null }
}

/**
 * 保存時に使う確定値。＝ の押し忘れで意図しない金額が保存されるのを防ぐため、
 * 保留中の計算があれば自動的に評価する(＝ と同じ遷移)。
 */
export function resolveForSubmit(state: CalcState): CalcState {
  return pressEquals(state)
}

/** C(クリア): 入力欄も保留状態もすべてリセットする。 */
export function clearAll(): CalcState {
  return EMPTY_CALC
}

/* ------------------------------------------------------------
   自前テンキーからの数字入力
   OSキーボードの代わりにテンキーを使う場合も、演算子と同じ状態機械を通す。
   入力欄の文字列を組み立てるだけなので、pendingValue / pendingOp には触らない。
   ------------------------------------------------------------ */

/**
 * 金額として現実的な桁数の上限。押し続けても Number の精度を壊さないための歯止め。
 * 桁区切り(amountFormat.ts)も同じ上限で切るので export している。
 */
export const MAX_AMOUNT_DIGITS = 9
const MAX_DIGITS = MAX_AMOUNT_DIGITS

/**
 * テンキーの数字キー(0〜9 と 00)を押したときの遷移。
 * - 先頭の 0 は積まない(「0」「00」だけを押しても入力は空のまま)
 * - 上限桁数を超える分は無視する(打ち間違いで桁が暴走しないように)
 */
export function pressDigits(state: CalcState, digits: string): CalcState {
  if (!/^\d+$/.test(digits)) return state
  // 先頭の 0 は数値として意味が無いので、空欄のうちは 0 を積まない
  const base = state.input === '0' ? '' : state.input
  let next = base
  for (const d of digits) {
    if (next === '' && d === '0') continue
    if (next.length >= MAX_DIGITS) break
    next += d
  }
  if (next === state.input) return state
  return { ...state, input: next }
}

/** テンキーの1文字削除。入力欄が空のときは何もしない(保留中の計算は消さない) */
export function pressBackspace(state: CalcState): CalcState {
  if (state.input === '') return state
  return { ...state, input: state.input.slice(0, -1) }
}
