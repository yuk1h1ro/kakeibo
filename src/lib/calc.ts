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

/* ------------------------------------------------------------
   パーセント計算と消費税 (機能043 の続き)

   要望は「小数点は要らない、%計算(とくに消費税)ができればいい」だった。
   なので小数点キーは足していない。金額は今までどおり円単位の整数のまま
   (DB に小数が入る余地を作らない)で、割合の計算だけを整数の世界で完結させる。
   ------------------------------------------------------------ */

/**
 * 金額として持てる範囲か。
 *
 * 9桁(MAX_AMOUNT_DIGITS)を超える値を入力欄に入れてしまうと、次に1文字でも
 * 編集した瞬間に normalizeAmountInput が末尾を黙って切り落として別の金額になる。
 * 「押したら金額が壊れた」を作らないため、範囲外になる計算は実行しない。
 */
function fitsAmount(n: number): boolean {
  return Number.isSafeInteger(n) && Math.abs(n) < 10 ** MAX_AMOUNT_DIGITS
}

/**
 * base の percent% を、円未満を切り捨てた整数で返す。計算できないときは null。(純粋関数)
 *
 * `base * percent / 100` と書くと 33.3 のような二進数で表せない値を経由するので、
 * 割り切れない額のたびに丸めの向きを疑うことになる。ここでは剰余を先に引いてから
 * 100 で割る — すべて整数どうしの演算なので誤差がそもそも入らない。
 *
 * JS の % は符号を残すので、この式はマイナスでも 0 に向かって切り捨てる
 * (-333 の10% は -34 ではなく -33)。金額の「切り捨て」は絶対値を削る意味で
 * 使うので、符号によって丸めの向きが変わらないほうが説明しやすい。
 */
export function percentOf(base: number, percent: number): number | null {
  if (!Number.isInteger(base) || !Number.isInteger(percent)) return null
  const product = base * percent
  if (!Number.isSafeInteger(product)) return null
  return (product - (product % 100)) / 100
}

/**
 * ％キーを押したときの遷移。電卓の一般的な挙動に合わせる。
 *
 *   1000 ＋ 10 ％ → 1100   (1000 の 10% を足す)
 *   1000 − 10 ％ →  900   (1000 の 10% を引く)
 *   1000 × 10 ％ →  100   (1000 の 10%)
 *
 * ＋ と − は「直前の値の割合を足し引きする」、× は「直前の値の割合そのもの」。
 * どちらも取り出す割合は同じ percentOf(直前の値, 打った数)で、＝ と同じく
 * その場で確定させる(押した結果がすぐ金額欄に出るほうが、税込ボタンと揃う)。
 *
 * 演算子が保留されていないときは **何もしない**。
 * よくある電卓は「打った数を1/100にする」(1000 ％ → 10)が、この家計簿は
 * 円未満を持たないので 10 という別の金額になって画面に残ってしまい、
 * 打ち間違いと見分けが付かない。何の割合なのかが決まっていない以上、
 * 黙って金額を書き換えないほうが安全なので、押しても無反応にしている
 * (税込にしたいだけなら、下の税込ボタンが1タップで済む)。
 */
export function pressPercent(state: CalcState): CalcState {
  const { pendingValue, pendingOp } = state
  if (pendingOp === null || pendingValue === null) return state
  const entered = parseAmountInput(state.input)
  if (entered === null) return state
  const portion = percentOf(pendingValue, entered)
  if (portion === null) return state
  // × のときだけ「割合そのもの」。＋ − は割合を足し引きする
  const result = pendingOp === '×' ? portion : applyOp(pendingValue, pendingOp, portion)
  if (!fitsAmount(result)) return state
  return { input: String(result), pendingValue: null, pendingOp: null }
}

/* ---------- 税込にする ---------- */

/**
 * 消費税率。日本の消費税は標準10%と軽減8%(持ち帰りの飲食料品など)の2本立てなので、
 * どちらも1タップで押せる位置に出す。並び順はそのまま画面のボタンの並び。
 */
export const TAX_RATES = [10, 8] as const
export type TaxRate = (typeof TAX_RATES)[number]

/**
 * 税抜き金額に消費税を足した税込金額。円未満は切り捨て。計算できないときは null。(純粋関数)
 *
 * 切り捨てにしたのは、レジの端数処理として最も一般的だから。
 * 設定で切り上げ・四捨五入を選べるようにはしない — 選べるようにした瞬間、
 * 使うたびに「今どの設定だったか」を思い出す必要が生まれるうえ、
 * ずれるのはたかだか1円で、それは金額欄を直接打ち直せば済む。
 */
export function withTax(base: number, rate: TaxRate): number | null {
  const tax = percentOf(base, rate)
  if (tax === null) return null
  const total = base + tax
  return fitsAmount(total) ? total : null
}

/** 税込ボタンを押した結果。押す前の金額も返すのは、画面に「何が起きたか」を出すため */
export interface TaxApplied {
  /** 押したあとの電卓の状態 */
  state: CalcState
  /** 押す前の金額(税抜き) */
  before: number
  /** 押したあとの金額(税込) */
  after: number
  rate: TaxRate
  /** 円未満を切り捨てたか(切り捨てが起きたときだけ画面にもそう書く) */
  truncated: boolean
}

/**
 * 「税込にする」を押したときの遷移。押せないときは null(= ボタンを無効にする合図)。
 *
 * 保留中の計算があれば先に確定させる(＝の押し忘れ対策。980 ＋ 200 のあとに
 * 押したら 1180 の税込になる)。0円・マイナスには税を掛けない — 掛けても
 * 結果が変わらない/保存できない金額のままで、押した意味が伝わらないため。
 */
export function pressTax(state: CalcState, rate: TaxRate): TaxApplied | null {
  const resolved = pressEquals(state)
  const before = parseAmountInput(resolved.input)
  if (before === null || before <= 0) return null
  const after = withTax(before, rate)
  if (after === null) return null
  return {
    state: { input: String(after), pendingValue: null, pendingOp: null },
    before,
    after,
    rate,
    truncated: (before * rate) % 100 !== 0,
  }
}

/**
 * 税込にした結果の説明文。(純粋関数)
 *
 * 黙って数字だけが変わると、打ち間違いと区別が付かない。
 * 「1,000 → 税込 1,100」と押す前の額を並べて出し、端数を落としたときだけ
 * その旨も添える(落ちていないときに毎回書くと、注意書きが読み飛ばされる)。
 */
export function taxNoticeText(applied: TaxApplied): string {
  const before = applied.before.toLocaleString('ja-JP')
  const after = applied.after.toLocaleString('ja-JP')
  const note = applied.truncated ? '・円未満切り捨て' : ''
  return `${before} → 税込 ${after}(${applied.rate}%${note})`
}
