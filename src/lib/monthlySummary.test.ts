import { describe, expect, it } from 'vitest'
import {
  buildMonthlySummary,
  dueSummaryMonths,
  formatMonthlySummary,
  SUMMARY_LOOKBACK_MONTHS,
  type SummaryTxLike,
} from './monthlySummary'

const expense = (date: string, partner: number, category: string | null = 'food'): SummaryTxLike => ({
  date,
  type: 'expense',
  amount: partner + 1000,
  category,
  partner_amount: partner,
})

const deposit = (date: string, amount: number): SummaryTxLike => ({
  date,
  type: 'partner_deposit',
  amount,
  category: null,
  partner_amount: 0,
})

// ============================================================
// dueSummaryMonths — 二重送信に直結するので境界を厚く見る
// ============================================================
describe('dueSummaryMonths', () => {
  it('既定では直近3ヶ月ぶんを古い順に返す', () => {
    expect(dueSummaryMonths('2026-04-10', [])).toEqual(['2026-01', '2026-02', '2026-03'])
  })

  it('当月は絶対に含めない(月の途中で送らない)', () => {
    for (const day of ['2026-04-01', '2026-04-15', '2026-04-30']) {
      expect(dueSummaryMonths(day, [])).not.toContain('2026-04')
    }
  })

  it('月末・月初でも結果が変わらない', () => {
    expect(dueSummaryMonths('2026-04-01', [])).toEqual(dueSummaryMonths('2026-04-30', []))
  })

  it('送信済みの月は返さない', () => {
    expect(dueSummaryMonths('2026-04-10', ['2026-03'])).toEqual(['2026-01', '2026-02'])
    expect(dueSummaryMonths('2026-04-10', ['2026-01', '2026-02', '2026-03'])).toEqual([])
  })

  it('順不同・重複・窓の外の送信済みが混ざっても壊れない', () => {
    expect(dueSummaryMonths('2026-04-10', ['2026-03', '2025-08', '2026-03', '2026-01'])).toEqual([
      '2026-02',
    ])
  })

  it('年をまたぐ(1月の前は前年12月)', () => {
    expect(dueSummaryMonths('2026-01-05', [])).toEqual(['2025-10', '2025-11', '2025-12'])
    expect(dueSummaryMonths('2026-01-31', ['2025-12'])).toEqual(['2025-10', '2025-11'])
  })

  it('31日の当月から見ても前月は正しい(2月・うるう年)', () => {
    expect(dueSummaryMonths('2024-03-31', [], 1)).toEqual(['2024-02'])
    expect(dueSummaryMonths('2026-03-31', [], 1)).toEqual(['2026-02'])
  })

  it('lookback を狭めれば前月だけになる', () => {
    expect(dueSummaryMonths('2026-04-10', [], 1)).toEqual(['2026-03'])
  })

  it('lookback が 0 以下なら何も返さない', () => {
    expect(dueSummaryMonths('2026-04-10', [], 0)).toEqual([])
    expect(dueSummaryMonths('2026-04-10', [], -3)).toEqual([])
  })

  it('窓から外れた古い月は二度と対象にならない(溢れ防止)', () => {
    // 2025-12 は 2026-04 時点で 4ヶ月前 = 窓の外
    expect(dueSummaryMonths('2026-04-10', [])).not.toContain('2025-12')
  })

  it('一度送った月は、翌月に開いても再送対象にならない', () => {
    const sent: string[] = []
    // 3月に開いて 2月ぶんを送る
    const first = dueSummaryMonths('2026-03-02', sent, 1)
    expect(first).toEqual(['2026-02'])
    sent.push(...first)
    // 同じ月にもう一度開いても対象なし
    expect(dueSummaryMonths('2026-03-20', sent, 1)).toEqual([])
    // 翌月に開くと 3月ぶんだけが対象
    expect(dueSummaryMonths('2026-04-01', sent, 1)).toEqual(['2026-03'])
  })

  it('既定の lookback は 3', () => {
    expect(SUMMARY_LOOKBACK_MONTHS).toBe(3)
    expect(dueSummaryMonths('2026-04-10', [])).toHaveLength(3)
  })
})

// ============================================================
// buildMonthlySummary
// ============================================================
describe('buildMonthlySummary', () => {
  const rows: SummaryTxLike[] = [
    deposit('2026-02-01', 30000),
    expense('2026-02-03', 1500, 'eating_out'),
    expense('2026-02-10', 800, 'food'),
    expense('2026-02-20', 1200, 'eating_out'),
    expense('2026-02-25', 0, 'food'), // 彼女の負担なし = 集計にも内訳にも入らない
    expense('2026-03-01', 5000, 'food'), // 別の月
  ]

  it('その月の取り崩し合計を出す', () => {
    expect(buildMonthlySummary(rows, '2026-02').withdrawTotal).toBe(3500)
  })

  it('その月に預かった合計を出す', () => {
    expect(buildMonthlySummary(rows, '2026-02').depositTotal).toBe(30000)
  })

  it('残高は月で区切らず全期間の積み上げ(送信時点の残高)', () => {
    // 30000 - (1500+800+1200+0+5000)
    expect(buildMonthlySummary(rows, '2026-02').balance).toBe(21500)
    expect(buildMonthlySummary(rows, '2026-03').balance).toBe(21500)
  })

  it('カテゴリ別の内訳は多い順', () => {
    expect(buildMonthlySummary(rows, '2026-02').categories).toEqual([
      { category: 'eating_out', amount: 2700 },
      { category: 'food', amount: 800 },
    ])
  })

  it('彼女の負担が0の支出は内訳に出ない', () => {
    const cats = buildMonthlySummary([expense('2026-02-25', 0)], '2026-02').categories
    expect(cats).toEqual([])
  })

  it('動きが無い月は hasActivity が false', () => {
    expect(buildMonthlySummary(rows, '2026-01').hasActivity).toBe(false)
    expect(buildMonthlySummary([], '2026-01').hasActivity).toBe(false)
  })

  it('預かりだけの月でも hasActivity は true', () => {
    expect(buildMonthlySummary([deposit('2026-01-05', 10000)], '2026-01').hasActivity).toBe(true)
  })

  it('カテゴリ未設定 (null) もまとめられる', () => {
    const s = buildMonthlySummary([expense('2026-02-01', 500, null)], '2026-02')
    expect(s.categories).toEqual([{ category: null, amount: 500 }])
  })
})

// ============================================================
// formatMonthlySummary
// ============================================================
describe('formatMonthlySummary', () => {
  const labelOf = (c: string | null) => (c === 'food' ? '食費' : c === null ? 'その他' : c)

  it('合計・残高・内訳が入る', () => {
    const text = formatMonthlySummary(
      {
        month: '2026-02',
        withdrawTotal: 3500,
        depositTotal: 30000,
        balance: 21500,
        categories: [{ category: 'food', amount: 3500 }],
        hasActivity: true,
      },
      labelOf
    )
    expect(text).toContain('2026年2月のまとめ')
    expect(text).toContain('使った分の合計: ¥3,500')
    expect(text).toContain('預かった合計: ¥30,000')
    expect(text).toContain('いまの残高: ¥21,500')
    expect(text).toContain('・食費 ¥3,500')
  })

  it('預かりが無い月は「預かった合計」の行を出さない', () => {
    const text = formatMonthlySummary(
      {
        month: '2026-02',
        withdrawTotal: 100,
        depositTotal: 0,
        balance: 900,
        categories: [],
        hasActivity: true,
      },
      labelOf
    )
    expect(text).not.toContain('預かった合計')
    expect(text).not.toContain('内訳')
  })

  it('残高がマイナスでも読める形にする', () => {
    const text = formatMonthlySummary(
      {
        month: '2026-02',
        withdrawTotal: 100,
        depositTotal: 0,
        balance: -500,
        categories: [],
        hasActivity: true,
      },
      labelOf
    )
    expect(text).toContain('いまの残高: −¥500')
  })
})
