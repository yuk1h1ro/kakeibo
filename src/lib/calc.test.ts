import { describe, expect, it } from 'vitest'
import {
  EMPTY_CALC,
  TAX_RATES,
  clearAll,
  percentOf,
  pressBackspace,
  pressDigits,
  pressEquals,
  pressOperator,
  pressPercent,
  pressTax,
  resolveForSubmit,
  taxNoticeText,
  withTax,
  type CalcState,
} from './calc'

const state = (input: string, pendingValue: number | null = null, pendingOp: CalcState['pendingOp'] = null): CalcState => ({
  input,
  pendingValue,
  pendingOp,
})

describe('pressDigits — 自前テンキーの数字入力', () => {
  it('押した順に桁が積まれる', () => {
    let s = EMPTY_CALC
    s = pressDigits(s, '1')
    s = pressDigits(s, '2')
    s = pressDigits(s, '00')
    expect(s.input).toBe('1200')
  })

  it('先頭の 0 と 00 は積まない', () => {
    expect(pressDigits(EMPTY_CALC, '0').input).toBe('')
    expect(pressDigits(EMPTY_CALC, '00').input).toBe('')
    expect(pressDigits(pressDigits(EMPTY_CALC, '00'), '5').input).toBe('5')
  })

  it('入力欄が 0 のときは置き換える', () => {
    expect(pressDigits(state('0'), '5').input).toBe('5')
  })

  it('保留中の計算状態には触らない', () => {
    const s = pressDigits(state('', 350, '+'), '2')
    expect(s).toEqual(state('2', 350, '+'))
  })

  it('桁数の上限を超えたら無視する', () => {
    const s = pressDigits(state('123456789'), '0')
    expect(s.input).toBe('123456789')
  })

  it('数字以外は無視する', () => {
    expect(pressDigits(state('12'), 'a')).toEqual(state('12'))
  })
})

describe('pressBackspace', () => {
  it('末尾の1文字を消す', () => {
    expect(pressBackspace(state('1200')).input).toBe('120')
  })

  it('空欄なら何も起きない(保留中の計算も消さない)', () => {
    expect(pressBackspace(state('', 350, '+'))).toEqual(state('', 350, '+'))
  })
})

describe('既存の電卓の挙動(テンキー追加後も変わらないこと)', () => {
  it('＋ で保留し、＝ で計算する', () => {
    let s = state('350')
    s = pressOperator(s, '+')
    expect(s).toEqual(state('', 350, '+'))
    s = pressDigits(s, '1')
    s = pressDigits(s, '50')
    s = pressEquals(s)
    expect(s).toEqual(state('500'))
  })

  it('× も同じ状態機械を通る', () => {
    let s = pressDigits(EMPTY_CALC, '3')
    s = pressOperator(s, '×')
    s = pressDigits(s, '4')
    expect(resolveForSubmit(s).input).toBe('12')
  })

  it('C ですべて消える', () => {
    expect(clearAll()).toEqual(EMPTY_CALC)
  })
})

// ============================================================
// パーセント計算と消費税
// 要望は「小数点は要らない、%(とくに消費税)が計算できればいい」。
// 金額は円単位の整数のままで、端数は切り捨てる。
// ============================================================

describe('percentOf — 割合の切り捨て', () => {
  it('割り切れる割合はそのまま', () => {
    expect(percentOf(1000, 10)).toBe(100)
    expect(percentOf(1000, 8)).toBe(80)
  })

  it('円未満は切り捨てる', () => {
    expect(percentOf(333, 10)).toBe(33) // 33.3
    expect(percentOf(333, 8)).toBe(26) // 26.64
    expect(percentOf(999, 8)).toBe(79) // 79.92 — 切り上げなら 80
  })

  it('0円・1円などの端は 0 に落ちる', () => {
    expect(percentOf(0, 10)).toBe(0)
    expect(percentOf(1, 10)).toBe(0) // 0.1
    expect(percentOf(9, 10)).toBe(0) // 0.9 — 四捨五入なら 1
    expect(percentOf(10, 10)).toBe(1)
  })

  it('0% は常に 0', () => {
    expect(percentOf(1234, 0)).toBe(0)
  })

  it('マイナスでも 0 に向かって切り捨てる(符号で丸めの向きが変わらない)', () => {
    expect(percentOf(-333, 10)).toBe(-33)
    expect(percentOf(-333, 8)).toBe(-26)
  })

  it('浮動小数の誤差で1円ずれない', () => {
    // 二進数で表せない 0.1 系の値を経由すると、切り捨ての向きが揺れうる場所
    expect(percentOf(70, 10)).toBe(7)
    expect(percentOf(29, 10)).toBe(2)
    expect(percentOf(2960, 10)).toBe(296)
    expect(percentOf(1_000_000_007, 10)).toBe(100_000_000)
  })

  it('整数でない値・桁あふれは null', () => {
    expect(percentOf(100.5, 10)).toBeNull()
    expect(percentOf(100, 10.5)).toBeNull()
    expect(percentOf(Number.MAX_SAFE_INTEGER, 10)).toBeNull()
  })
})

describe('pressPercent — ％キー', () => {
  it('1000 ＋ 10 ％ → 1100(直前の値の10%を足す)', () => {
    let s = pressOperator(state('1000'), '+')
    s = pressDigits(s, '10')
    expect(pressPercent(s)).toEqual(state('1100'))
  })

  it('1000 − 10 ％ → 900', () => {
    let s = pressOperator(state('1000'), '-')
    s = pressDigits(s, '10')
    expect(pressPercent(s)).toEqual(state('900'))
  })

  it('1000 × 10 ％ → 100(割合そのもの)', () => {
    let s = pressOperator(state('1000'), '×')
    s = pressDigits(s, '10')
    expect(pressPercent(s)).toEqual(state('100'))
  })

  it('端数は切り捨ててから足し引きする', () => {
    let s = pressOperator(state('333'), '+')
    s = pressDigits(s, '10')
    expect(pressPercent(s).input).toBe('366') // 333 + 33.3 の切り捨て
  })

  it('演算子が無いときは何も起きない(打った数を勝手に 1/100 にしない)', () => {
    expect(pressPercent(state('1000'))).toEqual(state('1000'))
    expect(pressPercent(EMPTY_CALC)).toEqual(EMPTY_CALC)
  })

  it('演算子はあるが数を打っていないときは何も起きない', () => {
    expect(pressPercent(state('', 1000, '+'))).toEqual(state('', 1000, '+'))
  })

  it('連打しても2回目からは何も起きない(1回で確定するため)', () => {
    let s = pressOperator(state('1000'), '+')
    s = pressDigits(s, '10')
    const once = pressPercent(s)
    expect(once).toEqual(state('1100'))
    expect(pressPercent(once)).toEqual(once)
    expect(pressPercent(pressPercent(once))).toEqual(once)
  })

  it('確定したあとに ＝ を押しても値は変わらない', () => {
    let s = pressOperator(state('1000'), '+')
    s = pressDigits(s, '10')
    expect(pressEquals(pressPercent(s))).toEqual(state('1100'))
  })

  it('％のあとに続けて計算できる', () => {
    let s = pressOperator(state('1000'), '+')
    s = pressDigits(s, '10')
    s = pressPercent(s) // 1100
    s = pressOperator(s, '+')
    s = pressDigits(s, '400')
    expect(pressEquals(s).input).toBe('1500')
  })

  it('0 の割合・1円の割合は 0 円として扱われる', () => {
    let s = pressOperator(state('1'), '+')
    s = pressDigits(s, '10')
    expect(pressPercent(s).input).toBe('1') // 1 + 0.1 の切り捨て

    let z = pressOperator(state('1000'), '×')
    z = pressDigits(z, '0') // 0 は先頭では積まれないので入力は空のまま
    expect(pressPercent(z)).toEqual(z)
  })

  it('引きすぎてマイナスになる場合もそのまま出す(保存側で止める)', () => {
    let s = pressOperator(state('1000'), '-')
    s = pressDigits(s, '200')
    expect(pressPercent(s).input).toBe('-1000')
  })

  it('9桁を超える結果になる計算は実行しない(桁が黙って切れるのを防ぐ)', () => {
    let s = pressOperator(state('999999999'), '+')
    s = pressDigits(s, '10')
    expect(pressPercent(s)).toEqual(s)
  })

  it('C ですべて消える', () => {
    let s = pressOperator(state('1000'), '+')
    s = pressDigits(s, '10')
    s = pressPercent(s)
    expect(clearAll()).toEqual(EMPTY_CALC)
  })
})

describe('withTax — 税込にする', () => {
  it('標準10%と軽減8%', () => {
    expect(withTax(1000, 10)).toBe(1100)
    expect(withTax(1000, 8)).toBe(1080)
  })

  it('端数は切り捨て', () => {
    expect(withTax(333, 10)).toBe(366) // 366.3
    expect(withTax(333, 8)).toBe(359) // 359.64
    expect(withTax(198, 8)).toBe(213) // 213.84
  })

  it('0円・1円', () => {
    expect(withTax(0, 10)).toBe(0)
    expect(withTax(1, 10)).toBe(1) // 1.1 の切り捨て
    expect(withTax(1, 8)).toBe(1)
    expect(withTax(10, 10)).toBe(11)
  })

  it('9桁を超える結果は null', () => {
    expect(withTax(999_999_999, 10)).toBeNull()
    // ちょうど収まる側(9桁のまま)は通る
    expect(withTax(900_000_000, 10)).toBe(990_000_000)
    expect(withTax(910_000_000, 10)).toBeNull() // 1,001,000,000 で10桁
  })

  it('用意している税率は 10% と 8% の2つだけ', () => {
    expect(TAX_RATES).toEqual([10, 8])
  })
})

describe('pressTax — 「税込にする」ボタン', () => {
  it('打った金額をその場で税込にする', () => {
    const applied = pressTax(state('1000'), 10)
    expect(applied?.state).toEqual(state('1100'))
    expect(applied?.before).toBe(1000)
    expect(applied?.after).toBe(1100)
    expect(applied?.truncated).toBe(false)
  })

  it('軽減税率でも同じ1タップ', () => {
    expect(pressTax(state('1000'), 8)?.after).toBe(1080)
  })

  it('端数が出たときは切り捨てたことを持ち帰る', () => {
    const applied = pressTax(state('333'), 10)
    expect(applied?.after).toBe(366)
    expect(applied?.truncated).toBe(true)
  })

  it('保留中の計算は先に確定してから税込にする(＝の押し忘れ対策)', () => {
    let s = pressOperator(state('980'), '+')
    s = pressDigits(s, '200')
    const applied = pressTax(s, 10)
    expect(applied?.before).toBe(1180)
    expect(applied?.after).toBe(1298)
    expect(applied?.state.pendingOp).toBeNull()
  })

  it('「1000 ＋」で止まっているときは 1000 の税込になる', () => {
    expect(pressTax(state('', 1000, '+'), 10)?.after).toBe(1100)
  })

  it('空欄・0円・マイナスでは押しても何も起きない', () => {
    expect(pressTax(EMPTY_CALC, 10)).toBeNull()
    expect(pressTax(state('0'), 10)).toBeNull()
    expect(pressTax(state('-500'), 10)).toBeNull()
  })

  it('1円は税込でも1円(切り捨てで税が付かない)', () => {
    const applied = pressTax(state('1'), 10)
    expect(applied?.after).toBe(1)
    expect(applied?.truncated).toBe(true)
  })

  it('連打すると税込に税込を重ねる(1回ごとに結果が画面に出る)', () => {
    const once = pressTax(state('1000'), 10)
    expect(once?.after).toBe(1100)
    const twice = pressTax(once!.state, 10)
    expect(twice?.before).toBe(1100)
    expect(twice?.after).toBe(1210)
  })

  it('9桁を超える結果になる金額では押せない', () => {
    expect(pressTax(state('999999999'), 10)).toBeNull()
  })

  it('税込にしたあと ＝ を押しても値は変わらない', () => {
    const applied = pressTax(state('1000'), 10)!
    expect(pressEquals(applied.state)).toEqual(state('1100'))
    expect(resolveForSubmit(applied.state).input).toBe('1100')
  })

  it('税込にしたあとも続けて計算できる', () => {
    const applied = pressTax(state('1000'), 10)!
    let s = pressOperator(applied.state, '+')
    s = pressDigits(s, '500')
    expect(resolveForSubmit(s).input).toBe('1600')
  })

  it('保存される金額は整数のまま', () => {
    for (const rate of TAX_RATES) {
      for (const base of [1, 7, 99, 333, 1234, 99999]) {
        const applied = pressTax(state(String(base)), rate)!
        expect(Number.isInteger(applied.after)).toBe(true)
        expect(applied.state.input).toBe(String(applied.after))
        expect(applied.state.input).toMatch(/^\d+$/)
      }
    }
  })
})

describe('taxNoticeText — 押した結果の見え方', () => {
  it('押す前と押したあとを並べて出す', () => {
    const applied = pressTax(state('1000'), 10)!
    expect(taxNoticeText(applied)).toBe('1,000 → 税込 1,100(10%)')
  })

  it('端数を落としたときだけ、そう書く', () => {
    expect(taxNoticeText(pressTax(state('333'), 10)!)).toBe('333 → 税込 366(10%・円未満切り捨て)')
    expect(taxNoticeText(pressTax(state('1000'), 8)!)).toBe('1,000 → 税込 1,080(8%)')
  })

  it('大きな桁でも桁区切りされる', () => {
    expect(taxNoticeText(pressTax(state('1234567'), 10)!)).toBe(
      '1,234,567 → 税込 1,358,023(10%・円未満切り捨て)'
    )
  })
})
