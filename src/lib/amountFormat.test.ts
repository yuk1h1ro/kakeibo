import { describe, expect, it } from 'vitest'
import {
  applyAmountEdit,
  caretAfterDigits,
  formatAmountDisplay,
  normalizeAmountInput,
} from './amountFormat'

describe('formatAmountDisplay — 表示用の桁区切り', () => {
  it('3桁ごとにカンマを入れる', () => {
    expect(formatAmountDisplay('1234')).toBe('1,234')
    expect(formatAmountDisplay('123')).toBe('123')
    expect(formatAmountDisplay('1234567')).toBe('1,234,567')
  })

  it('空文字はそのまま空文字', () => {
    expect(formatAmountDisplay('')).toBe('')
  })

  it('0 と先頭0は値を変えずに表示する(整形は値を書き換えない)', () => {
    expect(formatAmountDisplay('0')).toBe('0')
    expect(formatAmountDisplay('0123')).toBe('0,123')
  })

  it('引き算の結果のマイナスを保つ', () => {
    expect(formatAmountDisplay('-1234')).toBe('-1,234')
  })
})

describe('normalizeAmountInput — 入力文字列の解析', () => {
  it('カンマ・空白・単位を落として数字だけにする(貼り付け)', () => {
    expect(normalizeAmountInput('1,234')).toBe('1234')
    expect(normalizeAmountInput(' ¥ 12,345 円 ')).toBe('12345')
    expect(normalizeAmountInput('abc')).toBe('')
  })

  it('全角数字を半角に寄せる', () => {
    expect(normalizeAmountInput('１２３')).toBe('123')
  })

  it('空文字・0・先頭0', () => {
    expect(normalizeAmountInput('')).toBe('')
    expect(normalizeAmountInput('0')).toBe('')
    expect(normalizeAmountInput('000')).toBe('')
    expect(normalizeAmountInput('0123')).toBe('123')
  })

  it('マイナスは残す', () => {
    expect(normalizeAmountInput('-1,234')).toBe('-1234')
  })

  it('桁数の上限を超えた分は捨てる', () => {
    expect(normalizeAmountInput('1234567890123')).toBe('123456789')
  })
})

describe('caretAfterDigits', () => {
  it('n個目の数字の直後を返す', () => {
    expect(caretAfterDigits('1,234', 0)).toBe(0)
    expect(caretAfterDigits('1,234', 1)).toBe(1)
    expect(caretAfterDigits('1,234', 2)).toBe(3)
    expect(caretAfterDigits('1,234', 4)).toBe(5)
  })

  it('マイナス記号の手前にはキャレットを置かない', () => {
    expect(caretAfterDigits('-400', 0)).toBe(1)
  })
})

describe('applyAmountEdit — 打っている最中のキャレット維持', () => {
  it('末尾に打ち足すとカンマが入り、キャレットは末尾のまま', () => {
    // '123' の末尾に '4' を打った直後
    const r = applyAmountEdit('123', '1234', 4)
    expect(r.raw).toBe('1234')
    expect(r.display).toBe('1,234')
    expect(r.caret).toBe(5)
  })

  it('途中に挿入してもキャレットが挿入した数字の直後に残る', () => {
    // '1,234' の '1' の直後に '9' を入れた → '19,234'
    const r = applyAmountEdit('1,234', '19,234', 2)
    expect(r.raw).toBe('19234')
    expect(r.display).toBe('19,234')
    // 数字2つぶんの直後 = '19' の直後
    expect(r.caret).toBe(2)
  })

  it('末尾の1文字を消すとカンマが減り、キャレットも詰まる', () => {
    const r = applyAmountEdit('1,234', '1,23', 4)
    expect(r.raw).toBe('123')
    expect(r.display).toBe('123')
    expect(r.caret).toBe(3)
  })

  it('カンマを消したときは直前の数字ごと消す(空振りさせない)', () => {
    // '1,234' でカンマの直後にキャレットを置いてバックスペース
    const r = applyAmountEdit('1,234', '1234', 1)
    expect(r.raw).toBe('234')
    expect(r.display).toBe('234')
    expect(r.caret).toBe(0)
  })

  it('全体を消すと空になる', () => {
    const r = applyAmountEdit('1,234', '', 0)
    expect(r).toEqual({ raw: '', display: '', caret: 0 })
  })

  it('カンマ付きの文字列を貼り付けても壊れない', () => {
    const r = applyAmountEdit('', '¥12,345', 7)
    expect(r.raw).toBe('12345')
    expect(r.display).toBe('12,345')
    expect(r.caret).toBe(6)
  })

  it('数字以外を打っても無視され、キャレットは数字の位置に落ち着く', () => {
    const r = applyAmountEdit('1,234', '1,2a34', 4)
    expect(r.raw).toBe('1234')
    expect(r.display).toBe('1,234')
    expect(r.caret).toBe(3)
  })

  it('先頭に 0 を打っても値は増えない', () => {
    const r = applyAmountEdit('', '0', 1)
    expect(r.raw).toBe('')
    expect(r.display).toBe('')
    expect(r.caret).toBe(0)
  })

  it('先頭0のあとに数字を打つと 0 が落ち、キャレットもその分詰まる', () => {
    const r = applyAmountEdit('', '05', 2)
    expect(r.raw).toBe('5')
    expect(r.display).toBe('5')
    expect(r.caret).toBe(1)
  })

  it('上限を超える桁は増えない', () => {
    const r = applyAmountEdit('123,456,789', '1234567890', 10)
    expect(r.raw).toBe('123456789')
    expect(r.display).toBe('123,456,789')
  })
})
