import { describe, expect, it } from 'vitest'
import { entryKey, frequentEntries, frequentLabel, FREQUENT_LIMIT } from './frequentEntries'
import type { Transaction } from './types'

const TODAY = '2026-10-24'
let seq = 0

function tx(over: Partial<Transaction> = {}): Transaction {
  seq++
  return {
    id: `t${seq}`,
    date: '2026-10-20',
    type: 'expense',
    amount: 418,
    category: 'transport',
    memo: '羽沢横浜国大→新宿',
    store: '',
    partner_amount: 0,
    created_at: `2026-10-20T00:00:${String(seq % 60).padStart(2, '0')}Z`,
    ...over,
  }
}

const train = (date: string, over: Partial<Transaction> = {}) => tx({ date, ...over })

describe('frequentEntries', () => {
  it('同じ内容・同じ金額で2回以上記録したものだけを候補にする', () => {
    const out = frequentEntries(
      [train('2026-10-20'), train('2026-10-21'), tx({ memo: 'コンビニ', category: 'food', amount: 300 })],
      TODAY
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ memo: '羽沢横浜国大→新宿', amount: 418, count: 2, lastDate: '2026-10-21' })
  })

  it('金額・彼女の負担分・カテゴリ・お店のどれかが違えば別の候補(押したのに金額が違う、を起こさない)', () => {
    const out = frequentEntries(
      [
        train('2026-10-01'),
        train('2026-10-02'),
        train('2026-10-03', { amount: 500 }),
        train('2026-10-04', { amount: 500 }),
        train('2026-10-05', { partner_amount: 418, amount: 836 }),
        train('2026-10-06', { partner_amount: 418, amount: 836 }),
      ],
      TODAY
    )
    expect(out.map((e) => [e.amount, e.partnerAmount])).toEqual([
      [836, 418],
      [500, 0],
      [418, 0],
    ])
  })

  it('回数の多い順。同じ回数なら最近使ったほうが先', () => {
    const out = frequentEntries(
      [
        tx({ memo: 'A', date: '2026-10-01' }),
        tx({ memo: 'A', date: '2026-10-02' }),
        tx({ memo: 'B', date: '2026-10-05' }),
        tx({ memo: 'B', date: '2026-10-06' }),
        tx({ memo: 'C', date: '2026-09-01' }),
        tx({ memo: 'C', date: '2026-09-02' }),
        tx({ memo: 'C', date: '2026-09-03' }),
      ],
      TODAY
    )
    expect(out.map((e) => e.memo)).toEqual(['C', 'B', 'A'])
  })

  it('お店の書き方の揺れ(全角・空白・大文字)は同じ店として数え、表記は最近のものを出す', () => {
    const out = frequentEntries(
      [
        tx({ store: 'ＪＲ', memo: '', date: '2026-10-01' }),
        tx({ store: 'jr ', memo: '', date: '2026-10-02' }),
        tx({ store: 'JR', memo: '', date: '2026-10-10' }),
      ],
      TODAY
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ store: 'JR', count: 3 })
  })

  it('半年より前の記録は数えない(値段が変わったあとの古い金額を出さない)', () => {
    const out = frequentEntries([train('2026-03-01'), train('2026-03-02'), train('2026-10-01')], TODAY)
    expect(out).toEqual([])
  })

  it('支出以外・繰り返し入力・分割の内訳・おごり付きは数えない', () => {
    const twice = (over: Partial<Transaction>) => [train('2026-10-01', over), train('2026-10-02', over)]
    const out = frequentEntries(
      [
        ...twice({ type: 'partner_deposit', category: null }),
        ...twice({ source: 'recurring', memo: '家賃' }),
        ...twice({ split_group: 'g1', memo: '分割' }),
        ...twice({ favor_amount: 100, favor_kind: 'treat', favor_from: '田中', memo: 'おごり' }),
      ],
      TODAY
    )
    expect(out).toEqual([])
  })

  it('テンプレートと同じ内容は出さない(同じ候補が2か所に並ぶため)', () => {
    const exclude = new Set([
      entryKey({ category: 'transport', store: '', memo: '羽沢横浜国大→新宿', amount: 418, partnerAmount: 0 }),
    ])
    expect(frequentEntries([train('2026-10-01'), train('2026-10-02')], TODAY, exclude)).toEqual([])
  })

  it(`多くても ${FREQUENT_LIMIT} 件まで`, () => {
    const rows = Array.from({ length: 10 }, (_, i) => [
      tx({ memo: `区間${i}`, date: '2026-10-01' }),
      tx({ memo: `区間${i}`, date: '2026-10-02' }),
    ]).flat()
    expect(frequentEntries(rows, TODAY)).toHaveLength(FREQUENT_LIMIT)
  })

  it('未来の日付(先に入れておいた予定)は数えない', () => {
    expect(frequentEntries([train('2026-11-01'), train('2026-11-02')], TODAY)).toEqual([])
  })
})

describe('frequentLabel', () => {
  const labelOf = (c: string | null) => (c === 'transport' ? '交通費' : 'その他')
  const base = { key: 'k', category: 'transport', amount: 418, partnerAmount: 0, count: 2, lastDate: TODAY }

  it('お店とメモの両方があれば両方を出す(電車は片方だけだと区間が分からない)', () => {
    expect(frequentLabel({ ...base, store: 'JR', memo: '羽沢横浜国大→新宿' }, labelOf)).toBe('JR 羽沢横浜国大→新宿')
  })

  it('どちらも無ければカテゴリ名', () => {
    expect(frequentLabel({ ...base, store: '', memo: '' }, labelOf)).toBe('交通費')
  })
})
