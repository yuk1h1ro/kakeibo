import { describe, expect, it } from 'vitest'
import {
  MASKED_AMOUNT,
  MASKED_COMPACT,
  amountMaskStateLabel,
  amountMaskToggleLabel,
  isAmountMasked,
  maskedAmountText,
  maskedCompactText,
  maskedSignedText,
  maskedTextAmounts,
  parseMasked,
  serializeMasked,
  setAmountMasked,
  toggleAmountMask,
} from './amountMask'
import { maskAmountsIn, maskCompact, signedYen, signedYenPlain, yen, yenPlain } from './format'

describe('parseMasked', () => {
  it('未設定は「表示」。人前で開くときに自分で押す機能なので、既定で隠さない', () => {
    expect(parseMasked(null)).toBe(false)
  })

  it('on を保存したときだけ伏字(壊れた値は表示側に倒す)', () => {
    expect(parseMasked('on')).toBe(true)
    expect(parseMasked('off')).toBe(false)
    expect(parseMasked('')).toBe(false)
    expect(parseMasked('yes')).toBe(false)
  })

  it('書いた値をそのまま読み戻せる', () => {
    expect(parseMasked(serializeMasked(true))).toBe(true)
    expect(parseMasked(serializeMasked(false))).toBe(false)
  })
})

describe('maskedAmountText', () => {
  it('目隠しがオフなら元の表記のまま', () => {
    expect(maskedAmountText('¥1,234', false)).toBe('¥1,234')
  })

  it('金額が違っても伏字は同じ = 桁数が推測できない', () => {
    expect(maskedAmountText('¥8', true)).toBe(maskedAmountText('¥1,234,567', true))
  })

  it('伏字に数字も桁区切りも残らない', () => {
    expect(MASKED_AMOUNT).not.toMatch(/[0-9,]/)
  })
})

describe('maskedSignedText', () => {
  it('オフなら元の表記のまま', () => {
    expect(maskedSignedText('+', '+¥500', false)).toBe('+¥500')
  })

  it('符号だけ残して伏せる(増減の向きは金額を明かさない)', () => {
    expect(maskedSignedText('+', '+¥500', true)).toBe(`+${MASKED_AMOUNT}`)
    expect(maskedSignedText('-', '-¥500', true)).toBe(`-${MASKED_AMOUNT}`)
  })

  it('符号が違っても金額の長さは伝わらない', () => {
    expect(maskedSignedText('-', '-¥7', true)).toBe(maskedSignedText('-', '-¥7,654,321', true))
  })
})

describe('maskedCompactText', () => {
  it('オフなら元の表記のまま', () => {
    expect(maskedCompactText('12,000', false)).toBe('12,000')
  })

  it('中身によらず同じ長さの伏字になる', () => {
    expect(maskedCompactText('9', true)).toBe(MASKED_COMPACT)
    expect(maskedCompactText('120,000', true)).toBe(MASKED_COMPACT)
  })

  it('空欄(支出のない日など)は空欄のまま — 無い額を「隠した」ことにしない', () => {
    expect(maskedCompactText('', true)).toBe('')
  })
})

describe('maskedTextAmounts', () => {
  it('オフなら元の文のまま', () => {
    expect(maskedTextAmounts('金額 ¥1,000 → ¥1,200', false)).toBe('金額 ¥1,000 → ¥1,200')
  })

  it('保存済みの文の中の金額だけを伏せる', () => {
    expect(maskedTextAmounts('金額 ¥1,000 → ¥1,200', true)).toBe(
      `金額 ${MASKED_AMOUNT} → ${MASKED_AMOUNT}`,
    )
  })

  it('金額でない数字(日付・件数)は触らない', () => {
    expect(maskedTextAmounts('7月20日(月) セブンイレブン ¥1,200(3件)', true)).toBe(
      `7月20日(月) セブンイレブン ${MASKED_AMOUNT}(3件)`,
    )
  })
})

describe('文言', () => {
  it('ボタン名は「押すとどうなるか」', () => {
    expect(amountMaskToggleLabel(false)).toBe('金額を隠す')
    expect(amountMaskToggleLabel(true)).toBe('金額を表示する')
  })

  it('設定の説明はいまの状態を述べる(オン/オフで別の文)', () => {
    expect(amountMaskStateLabel(true)).not.toBe(amountMaskStateLabel(false))
    expect(amountMaskStateLabel(true)).toContain('伏字')
  })
})

// ---- 状態の受け渡し(format.ts の整形関数まで効いているか) ----

describe('目隠しの切り替えが整形関数に届く', () => {
  it('既定では素の金額が出る', () => {
    expect(isAmountMasked()).toBe(false)
    expect(yen(1234)).toBe('¥1,234')
    expect(signedYen(-1234)).toBe('-¥1,234')
  })

  it('オンにすると画面用の整形だけが伏字になる', () => {
    setAmountMasked(true)
    try {
      expect(yen(1234)).toBe(MASKED_AMOUNT)
      expect(yen(1234)).toBe(yen(98765432))
      expect(signedYen(1234)).toBe(`+${MASKED_AMOUNT}`)
      expect(maskCompact('12,000')).toBe(MASKED_COMPACT)
      expect(maskAmountsIn('金額 ¥1,000 → ¥1,200')).toBe(
        `金額 ${MASKED_AMOUNT} → ${MASKED_AMOUNT}`,
      )
      // 保存・通知用は伏字にしない(伏字のまま Discord に送られたり
      // 変更履歴に残ったりすると、後から真実が読めなくなる)
      expect(yenPlain(1234)).toBe('¥1,234')
      expect(signedYenPlain(-1234)).toBe('-¥1,234')
    } finally {
      setAmountMasked(false)
    }
  })

  it('切り替えで元に戻る', () => {
    toggleAmountMask()
    expect(isAmountMasked()).toBe(true)
    toggleAmountMask()
    expect(isAmountMasked()).toBe(false)
    expect(yen(1234)).toBe('¥1,234')
  })
})
