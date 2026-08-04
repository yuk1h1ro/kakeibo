import { describe, expect, it } from 'vitest'
import {
  EMPTY_CALC,
  clearAll,
  pressBackspace,
  pressDigits,
  pressEquals,
  pressOperator,
  resolveForSubmit,
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
