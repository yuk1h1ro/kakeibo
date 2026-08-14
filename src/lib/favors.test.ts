import { describe, expect, it } from 'vitest'
import {
  MAX_FAVOR_FROM_LENGTH,
  buildFavor,
  favorAmount,
  favorBadgeText,
  favorCategoryBreakdown,
  favorColumns,
  favorNoticeText,
  favorOf,
  favorSummary,
  favorTransactions,
  isTreat,
  listAmount,
  normalizeFavorFrom,
  personLineText,
  treatFromOptions,
} from './favors'
import { ownAmount, type Transaction } from './types'

// ============================================================
// おごり・値引きの純粋関数。
//
// ここで守っているのは4つ:
//   ・浮いた額は **支出に一切足さない**(ownAmount が変わらない)
//   ・額と理由が揃っていない行は「おごり」として数えない
//   ・おごってくれた人の名前は、こちらの都合で書き換えない
//   ・人ごとの集計の並びが、同額でもブレない
// ============================================================

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: 't1',
  date: '2026-08-03',
  type: 'expense',
  amount: 1000,
  category: 'food',
  memo: '',
  store: '',
  partner_amount: 0,
  created_at: '2026-08-03T01:00:00.000Z',
  ...over,
})

/** 全額おごってもらった1件(自分の支払いは 0円) */
const treated = (over: Partial<Transaction> = {}): Transaction =>
  tx({ amount: 0, favor_amount: 3200, favor_kind: 'treat', favor_from: '田中', ...over })

describe('favorOf', () => {
  it('付いていない記録は null(これまでの記録の意味は変わらない)', () => {
    expect(favorOf(tx())).toBeNull()
    expect(favorOf(tx({ favor_amount: 0, favor_kind: null, favor_from: '' }))).toBeNull()
  })

  it('おごりを読み取る', () => {
    expect(favorOf(treated())).toEqual({ kind: 'treat', amount: 3200, from: '田中' })
  })

  it('値引きには相手がいない(名前が入っていても捨てる)', () => {
    const t = tx({ favor_amount: 500, favor_kind: 'discount', favor_from: '田中' })
    expect(favorOf(t)).toEqual({ kind: 'discount', amount: 500, from: '' })
  })

  it('額だけ・理由だけの片方しかない行は認めない(人ごとの集計に混ぜないため)', () => {
    expect(favorOf(tx({ favor_amount: 500, favor_kind: null }))).toBeNull()
    expect(favorOf(tx({ favor_amount: 0, favor_kind: 'treat' }))).toBeNull()
    expect(favorOf(tx({ favor_amount: 500, favor_kind: 'なにか' }))).toBeNull()
  })

  it('壊れた値(負数・NaN・文字列)は「無し」に倒す', () => {
    expect(favorOf(tx({ favor_amount: -500, favor_kind: 'treat' }))).toBeNull()
    expect(favorOf(tx({ favor_amount: Number.NaN, favor_kind: 'treat' }))).toBeNull()
    expect(favorAmount({ favor_amount: null })).toBe(0)
    expect(favorAmount({})).toBe(0)
  })

  it('預かり・返金・調整には付かない(残高の付け替えにおごりは無い)', () => {
    const deposit = tx({ type: 'partner_deposit', favor_amount: 500, favor_kind: 'treat' })
    expect(favorOf(deposit)).toBeNull()
  })
})

describe('支出の集計に影響しない', () => {
  it('全額おごりの回の実質支出は 0円', () => {
    expect(ownAmount(treated())).toBe(0)
  })

  it('一部だけおごってもらっても、支出は自分が払った額のまま', () => {
    const t = tx({ amount: 1000, favor_amount: 2200, favor_kind: 'treat', favor_from: '田中' })
    expect(ownAmount(t)).toBe(1000)
    // 本来の値段だけは別に出せる
    expect(listAmount(t)).toBe(3200)
  })

  it('付いていない記録の本来の値段は支払い額そのもの', () => {
    expect(listAmount(tx({ amount: 1000 }))).toBe(1000)
  })

  it('isTreat は値引きに反応しない', () => {
    expect(isTreat(treated())).toBe(true)
    expect(isTreat(tx({ favor_amount: 500, favor_kind: 'discount' }))).toBe(false)
    expect(isTreat(tx())).toBe(false)
  })
})

describe('normalizeFavorFrom', () => {
  it('前後の空白を落とす', () => {
    expect(normalizeFavorFrom('  田中さん  ')).toBe('田中さん')
  })

  it('名前の中の空白は残す(「山田 太郎」は1人の名前)', () => {
    expect(normalizeFavorFrom('山田 太郎')).toBe('山田 太郎')
  })

  it('全角の空白も1つの半角空白にそろえる(同じ人が別人に割れないように)', () => {
    expect(normalizeFavorFrom('山田　太郎')).toBe('山田 太郎')
  })

  it('長すぎる名前は切る(DB の制約と同じ長さ)', () => {
    const long = 'あ'.repeat(MAX_FAVOR_FROM_LENGTH + 5)
    expect(normalizeFavorFrom(long)).toHaveLength(MAX_FAVOR_FROM_LENGTH)
  })

  it('空白だけなら空文字', () => {
    expect(normalizeFavorFrom('　 ')).toBe('')
  })
})

describe('buildFavor / favorColumns', () => {
  it('種類を選んでいなければ付けない', () => {
    expect(buildFavor(null, 500, '田中')).toBeNull()
  })

  it('額が 0 以下・整数でなければ付けない(理由の無い 0円 を作らせない)', () => {
    expect(buildFavor('treat', 0, '田中')).toBeNull()
    expect(buildFavor('treat', -100, '田中')).toBeNull()
    expect(buildFavor('treat', 12.5, '田中')).toBeNull()
  })

  it('おごりは相手の名前を持ち、値引きは持たない', () => {
    expect(buildFavor('treat', 3200, ' 田中 ')).toEqual({
      kind: 'treat',
      amount: 3200,
      from: '田中',
    })
    expect(buildFavor('discount', 500, '田中')).toEqual({
      kind: 'discount',
      amount: 500,
      from: '',
    })
  })

  it('無しのときも「無し」を明示的に送る(編集で外したときに前の値を残さない)', () => {
    expect(favorColumns(null)).toEqual({ favor_amount: 0, favor_kind: null, favor_from: '' })
    expect(favorColumns({ kind: 'treat', amount: 3200, from: '田中' })).toEqual({
      favor_amount: 3200,
      favor_kind: 'treat',
      favor_from: '田中',
    })
  })
})

describe('表示の言い回し', () => {
  it('履歴には相手の名前を出す', () => {
    expect(favorBadgeText({ kind: 'treat', amount: 3200, from: '田中' })).toBe(
      '田中さんのおごり ¥3,200'
    )
  })

  it('名前を書いていないおごりでも、おごりだと分かる', () => {
    expect(favorBadgeText({ kind: 'treat', amount: 3200, from: '' })).toBe('¥3,200 おごり')
  })

  it('値引きは金額だけ', () => {
    expect(favorBadgeText({ kind: 'discount', amount: 500, from: '' })).toBe('¥500 割引')
  })

  it('全額おごりのときは「0円で記録される」ことを書く', () => {
    const text = favorNoticeText({ kind: 'treat', amount: 3200, from: '田中' }, 0)
    expect(text).toContain('本来 ¥3,200')
    expect(text).toContain('田中さんのおごり')
    expect(text).toContain('¥0')
  })

  it('一部だけのときは、本来の値段と自分の支払いの両方を書く', () => {
    const text = favorNoticeText({ kind: 'discount', amount: 500, from: '' }, 2500)
    expect(text).toContain('本来 ¥3,000')
    expect(text).toContain('支出は ¥2,500')
  })
})

describe('favorSummary', () => {
  const range = { start: '2026-08-01', end: '2026-08-31' }

  it('期間の外は数えない', () => {
    const txs = [treated({ id: 'a', date: '2026-07-31' }), treated({ id: 'b', date: '2026-09-01' })]
    expect(favorSummary(txs, range).treatCount).toBe(0)
    expect(favorTransactions(txs, range)).toHaveLength(0)
  })

  it('おごりと値引きを分けて数える', () => {
    const txs = [
      treated({ id: 'a', favor_amount: 3200 }),
      treated({ id: 'b', favor_amount: 1800, favor_from: '佐藤' }),
      tx({ id: 'c', favor_amount: 500, favor_kind: 'discount' }),
    ]
    const s = favorSummary(txs, range)
    expect(s.treatCount).toBe(2)
    expect(s.treatTotal).toBe(5000)
    expect(s.discountCount).toBe(1)
    expect(s.discountTotal).toBe(500)
    expect(s.total).toBe(5500)
  })

  it('人ごとに束ね、最後にご馳走になった日を残す', () => {
    const txs = [
      treated({ id: 'a', date: '2026-08-03', favor_amount: 1000 }),
      treated({ id: 'b', date: '2026-08-20', favor_amount: 2000 }),
      treated({ id: 'c', date: '2026-08-10', favor_amount: 500, favor_from: '佐藤' }),
    ]
    expect(favorSummary(txs, range).people).toEqual([
      { name: '田中', count: 2, total: 3000, lastDate: '2026-08-20' },
      { name: '佐藤', count: 1, total: 500, lastDate: '2026-08-10' },
    ])
  })

  it('同額のときも並びが決まる(額 → 回数 → 名前)', () => {
    const txs = [
      treated({ id: 'a', favor_amount: 1000, favor_from: '佐藤' }),
      treated({ id: 'b', favor_amount: 1000, favor_from: '相原' }),
    ]
    expect(favorSummary(txs, range).people.map((p) => p.name)).toEqual(['佐藤', '相原'])
  })

  it('名前を書かなかった回は1つに束ねる(値引きには混ぜない)', () => {
    const txs = [
      treated({ id: 'a', favor_from: '', favor_amount: 700 }),
      treated({ id: 'b', favor_from: '', favor_amount: 300 }),
    ]
    const s = favorSummary(txs, range)
    expect(s.people).toEqual([{ name: '', count: 2, total: 1000, lastDate: '2026-08-03' }])
    expect(s.discountCount).toBe(0)
  })
})

describe('favorCategoryBreakdown', () => {
  const range = { start: '2026-08-01', end: '2026-08-31' }
  const labelOf = (id: string | null) =>
    id === 'food' ? '食費' : id === 'fun' ? '娯楽' : id === null ? '未分類' : id

  it('浮いた額をカテゴリごとに足す(払った額ではない)', () => {
    const txs = [
      treated({ id: 'a', category: 'food', amount: 0, favor_amount: 3200 }),
      treated({ id: 'b', category: 'food', amount: 1000, favor_amount: 800 }),
      treated({ id: 'c', category: 'fun', favor_amount: 1500 }),
    ]
    expect(favorCategoryBreakdown(txs, range, 'treat', labelOf)).toEqual([
      { key: 'food', label: '食費', total: 4000, count: 2 },
      { key: 'fun', label: '娯楽', total: 1500, count: 1 },
    ])
  })

  it('おごりと値引きは混ぜない', () => {
    const txs = [
      treated({ id: 'a', category: 'food', favor_amount: 1000 }),
      tx({ id: 'b', category: 'food', favor_amount: 500, favor_kind: 'discount' }),
    ]
    expect(favorCategoryBreakdown(txs, range, 'treat', labelOf)).toEqual([
      { key: 'food', label: '食費', total: 1000, count: 1 },
    ])
    expect(favorCategoryBreakdown(txs, range, 'discount', labelOf)).toEqual([
      { key: 'food', label: '食費', total: 500, count: 1 },
    ])
  })

  it('カテゴリが無い記録も1つに束ねて出す(黙って落とさない)', () => {
    const txs = [treated({ id: 'a', category: null, favor_amount: 900 })]
    expect(favorCategoryBreakdown(txs, range, 'treat', labelOf)).toEqual([
      { key: '', label: '未分類', total: 900, count: 1 },
    ])
  })

  it('期間の外は数えない', () => {
    const txs = [treated({ id: 'a', date: '2026-07-31', category: 'food' })]
    expect(favorCategoryBreakdown(txs, range, 'treat', labelOf)).toEqual([])
  })
})

describe('treatFromOptions', () => {
  it('最近ご馳走になった順に出す(件数順ではない)', () => {
    const txs = [
      treated({ id: 'a', date: '2026-01-05', favor_from: '田中' }),
      treated({ id: 'b', date: '2026-02-05', favor_from: '田中' }),
      treated({ id: 'c', date: '2026-08-01', favor_from: '佐藤' }),
    ]
    expect(treatFromOptions(txs)).toEqual(['佐藤', '田中'])
  })

  it('名前の無いおごり・値引きは候補に出さない', () => {
    const txs = [
      treated({ id: 'a', favor_from: '' }),
      tx({ id: 'b', favor_amount: 500, favor_kind: 'discount' }),
    ]
    expect(treatFromOptions(txs)).toEqual([])
  })

  it('上限で打ち切る', () => {
    const txs = Array.from({ length: 12 }, (_, i) =>
      treated({ id: `t${i}`, date: `2026-08-${String(i + 1).padStart(2, '0')}`, favor_from: `人${i}` })
    )
    expect(treatFromOptions(txs)).toHaveLength(8)
    expect(treatFromOptions(txs, 3)).toHaveLength(3)
  })
})

describe('personLineText', () => {
  it('何回・いくらぶんかを1行で出す', () => {
    expect(
      personLineText({ name: '田中', count: 3, total: 6200, lastDate: '2026-07-12' })
    ).toBe('田中さん 3回・¥6,200')
  })

  it('名前を書いていない回も、それと分かる言葉にする', () => {
    expect(personLineText({ name: '', count: 1, total: 500, lastDate: '2026-07-12' })).toBe(
      '名前を書いていない回 1回・¥500'
    )
  })
})
