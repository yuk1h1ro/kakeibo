import { describe, expect, it } from 'vitest'
import { chargeImpact, paidRowNote, signedAmountText, splitCharges } from './shareCharges'
import { partnerImpact } from './partnerBalance'
import type { ShareCharge } from './shareView'

function charge(p: Partial<ShareCharge> = {}): ShareCharge {
  return {
    id: 'c1',
    date: '2026-08-04',
    store: 'スーパー',
    amount: 1000, // 彼女の負担分
    paid: 0, // 彼女が払った額
    category: 'food',
    categoryLabel: '食費',
    ...p,
  }
}

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

describe('chargeImpact', () => {
  it('利用者が全額払った回は、負担分だけ残高が減る', () => {
    expect(chargeImpact(charge({ amount: 1000, paid: 0 }))).toBe(-1000)
  })

  it('彼女が全額払い、負担が0の回は、払った分だけ残高が増える', () => {
    // 以前はここが「—」と表示され、残高が増えた事実がどこにも出なかった
    expect(chargeImpact(charge({ amount: 0, paid: 3000 }))).toBe(3000)
  })

  it('彼女が払い、自分の負担も含む回は差額だけ動く', () => {
    expect(chargeImpact(charge({ amount: 1200, paid: 3000 }))).toBe(1800)
    expect(chargeImpact(charge({ amount: 3000, paid: 1200 }))).toBe(-1800)
  })

  it('ちょうど自分の負担分だけ払った回は動かない', () => {
    expect(chargeImpact(charge({ amount: 1500, paid: 1500 }))).toBe(0)
  })

  it('残高計算は partnerBalance.ts と必ず同じ結果になる(式を二重に持たない)', () => {
    for (const [amount, paid] of [
      [1000, 0],
      [0, 3000],
      [1200, 3000],
      [3000, 1200],
      [0, 0],
    ]) {
      expect(chargeImpact({ amount, paid })).toBe(
        partnerImpact({ type: 'expense', amount: paid, partner_amount: amount, partner_paid: paid })
      )
    }
  })
})

describe('splitCharges', () => {
  it('彼女が払った回だけ別の節にまとまる', () => {
    const rows = [
      charge({ id: 'a', paid: 0 }),
      charge({ id: 'b', paid: 2000 }),
      charge({ id: 'c', paid: 0 }),
    ]
    const { deducted, paidByPartner } = splitCharges(rows)
    expect(deducted.map((c) => c.id)).toEqual(['a', 'c'])
    expect(paidByPartner.map((c) => c.id)).toEqual(['b'])
  })

  it('1件も落とさない(どちらかの節に必ず入る)', () => {
    const rows = [charge({ id: 'a' }), charge({ id: 'b', paid: 1 }), charge({ id: 'c', paid: -5 })]
    const { deducted, paidByPartner } = splitCharges(rows)
    expect(deducted.length + paidByPartner.length).toBe(rows.length)
  })

  it('空でも壊れない', () => {
    expect(splitCharges([])).toEqual({ deducted: [], paidByPartner: [] })
  })
})

describe('signedAmountText', () => {
  it('増えた回はプラス、減った回はマイナスで出す', () => {
    expect(signedAmountText(1800, yen)).toBe('+¥1,800')
    expect(signedAmountText(-1000, yen)).toBe('-¥1,000')
  })

  it('動かなかった回は「—」ではなく 0 と書く(動いたのか読めるように)', () => {
    expect(signedAmountText(0, yen)).toBe('¥0')
  })
})

describe('paidRowNote', () => {
  it('多く出してくれた回は、増えた額まで書く', () => {
    const text = paidRowNote({ amount: 1200, paid: 3000 }, yen)
    expect(text).toContain('¥3,000 払い')
    expect(text).toContain('あなたの分は ¥1,200')
    expect(text).toContain('¥1,800')
    expect(text).toContain('のこりに足しました')
  })

  it('負担が0の回は「あなたの分は ¥0」と書かず、全額払ったことを書く', () => {
    const text = paidRowNote({ amount: 0, paid: 3000 }, yen)
    expect(text).toContain('ぜんぶあなたが払ってくれました')
    expect(text).toContain('¥3,000')
    expect(text).not.toContain('¥0')
  })

  it('足りなかった回は、引いた額を書く', () => {
    expect(paidRowNote({ amount: 3000, paid: 1200 }, yen)).toContain('のこりから引きました')
  })

  it('ちょうどの回は動かないと書く', () => {
    expect(paidRowNote({ amount: 1500, paid: 1500 }, yen)).toContain('のこりは動きません')
  })

  it('専門用語(残高・按分・立替)を彼女向けの文章に持ち込まない', () => {
    for (const c of [
      { amount: 1200, paid: 3000 },
      { amount: 3000, paid: 1200 },
      { amount: 1500, paid: 1500 },
    ]) {
      const text = paidRowNote(c, yen)
      expect(text).not.toMatch(/残高|按分|立替|精算/)
    }
  })
})
