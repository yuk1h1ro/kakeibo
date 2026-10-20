import { describe, expect, it } from 'vitest'
import {
  draftPartnerImpact,
  initialPayer,
  isPartnerPaidValid,
  partnerPaidAmount,
  saveBlockedReason,
  type DraftState,
} from './transactionDraft'
import type { Transaction } from './types'

const base: DraftState = {
  type: 'expense',
  category: 'food',
  amount: 1000,
  withPartner: false,
  partnerAmount: 0,
  payer: 'me',
  partnerPaid: 0,
  hasFavor: false,
  splitting: false,
  splitOk: false,
}

function tx(amount: number, partner_paid: number): Transaction {
  return {
    id: 't1',
    date: '2026-10-01',
    type: 'expense',
    amount,
    category: 'food',
    memo: '',
    store: '',
    partner_amount: 0,
    partner_paid,
    created_at: '2026-10-01T00:00:00Z',
  }
}

describe('initialPayer', () => {
  it('新規は自分が全額', () => {
    expect(initialPayer()).toBe('me')
  })

  it('保存済みの彼女が払った額から読み戻す', () => {
    expect(initialPayer(tx(1000, 0))).toBe('me')
    expect(initialPayer(tx(1000, 400))).toBe('both')
    expect(initialPayer(tx(1000, 1000))).toBe('partner')
  })
})

describe('partnerPaidAmount', () => {
  it('彼女が全額なら支払い金額そのもの(打ち直させない)', () => {
    expect(partnerPaidAmount('expense', 'partner', 1200, '300')).toBe(1200)
  })

  it('分けて払ったなら打った額、自分が全額なら 0', () => {
    expect(partnerPaidAmount('expense', 'both', 1200, '300')).toBe(300)
    expect(partnerPaidAmount('expense', 'both', 1200, '')).toBe(0)
    expect(partnerPaidAmount('expense', 'me', 1200, '300')).toBe(0)
  })

  it('支出以外には「誰が払ったか」が無い', () => {
    expect(partnerPaidAmount('partner_deposit', 'partner', 5000, '')).toBe(0)
  })
})

describe('isPartnerPaidValid', () => {
  it('分けて払ったときは 1円以上・支払い金額まで', () => {
    expect(isPartnerPaidValid({ ...base, payer: 'both', partnerPaid: 0 })).toBe(false)
    expect(isPartnerPaidValid({ ...base, payer: 'both', partnerPaid: 1 })).toBe(true)
    expect(isPartnerPaidValid({ ...base, payer: 'both', partnerPaid: 1000 })).toBe(true)
    expect(isPartnerPaidValid({ ...base, payer: 'both', partnerPaid: 1001 })).toBe(false)
  })

  it('自分が全額・支出以外は常に成り立つ', () => {
    expect(isPartnerPaidValid({ ...base, payer: 'me', partnerPaid: 99999 })).toBe(true)
    expect(isPartnerPaidValid({ ...base, type: 'partner_refund', payer: 'both', partnerPaid: 0 })).toBe(true)
  })
})

describe('saveBlockedReason', () => {
  it('そろっていれば null(保存できる)', () => {
    expect(saveBlockedReason(base)).toBeNull()
  })

  it('支出はカテゴリが要る。分割中は内訳のカテゴリで見るので要らない', () => {
    expect(saveBlockedReason({ ...base, category: null })).toBe('カテゴリを選んでください')
    expect(saveBlockedReason({ ...base, category: null, splitting: true, splitOk: true })).toBeNull()
    expect(saveBlockedReason({ ...base, type: 'partner_deposit', category: null })).toBeNull()
  })

  it('マイナスと空の金額を分けて言う', () => {
    expect(saveBlockedReason({ ...base, amount: -1 })).toMatch(/マイナス/)
    expect(saveBlockedReason({ ...base, amount: 0 })).toBe('金額を入れてください')
    expect(saveBlockedReason({ ...base, amount: 10.5 })).toBe('金額を入れてください')
  })

  it('0円 はおごり・値引きが付いた支出だけ通す', () => {
    expect(saveBlockedReason({ ...base, amount: 0, hasFavor: true })).toBeNull()
    expect(saveBlockedReason({ ...base, type: 'partner_deposit', amount: 0, hasFavor: true })).toBe(
      '金額を入れてください'
    )
  })

  it('彼女の負担分はマイナス・支払い金額超えを弾く(二人で使ったときだけ見る)', () => {
    expect(saveBlockedReason({ ...base, withPartner: true, partnerAmount: -100 })).toMatch(
      /彼女の負担分がマイナス/
    )
    expect(saveBlockedReason({ ...base, withPartner: true, partnerAmount: 1001 })).toBe(
      '彼女の負担分が支払い金額を超えています'
    )
    expect(saveBlockedReason({ ...base, withPartner: false, partnerAmount: -100 })).toBeNull()
  })

  it('彼女が払った額は「入れてください」と「超えています」を言い分ける', () => {
    expect(saveBlockedReason({ ...base, payer: 'both', partnerPaid: 0 })).toBe('彼女が払った額を入れてください')
    expect(saveBlockedReason({ ...base, payer: 'both', partnerPaid: 2000 })).toBe(
      '彼女が払った額が支払い金額を超えています'
    )
  })

  it('分割中は内訳がそろうまで保存させない', () => {
    expect(saveBlockedReason({ ...base, splitting: true, splitOk: false })).toMatch(/分割の内訳/)
    expect(saveBlockedReason({ ...base, splitting: true, splitOk: true })).toBeNull()
  })

  it('いちばん先に引っかかった1つだけを言う', () => {
    expect(saveBlockedReason({ ...base, category: null, amount: -1 })).toBe('カテゴリを選んでください')
  })
})

describe('draftPartnerImpact', () => {
  const impact = (d: Partial<Parameters<typeof draftPartnerImpact>[0]>) =>
    draftPartnerImpact({
      type: 'expense',
      amount: 1000,
      partnerAmount: 0,
      partnerPaid: 0,
      splitting: false,
      adjustSign: 1,
      splitPartnerAmounts: [],
      ...d,
    })

  it('支出は「彼女が払った額 − 彼女の負担分」', () => {
    expect(impact({ partnerAmount: 400 })).toBe(-400)
    expect(impact({ partnerAmount: 400, partnerPaid: 1000 })).toBe(600)
    expect(impact({})).toBe(0)
  })

  it('数字になっていない打ちかけは 0 とみなす', () => {
    expect(impact({ partnerAmount: NaN, partnerPaid: NaN })).toBe(0)
  })

  it('分割中は内訳の負担分の合計だけ減る', () => {
    expect(impact({ splitting: true, partnerPaid: 1000, splitPartnerAmounts: [300, 200] })).toBe(-500)
  })

  it('預かり・返金・調整は種類と向きで決まる', () => {
    expect(impact({ type: 'partner_deposit', amount: 5000 })).toBe(5000)
    expect(impact({ type: 'partner_refund', amount: 2000 })).toBe(-2000)
    expect(impact({ type: 'partner_adjust', amount: 300, adjustSign: -1 })).toBe(-300)
    expect(impact({ type: 'partner_deposit', amount: NaN })).toBe(0)
  })
})
