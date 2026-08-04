import { describe, expect, it } from 'vitest'
import {
  buildMonthlySummary,
  dueSummaryMonths,
  formatMonthlySummary,
  SUMMARY_LOOKBACK_MONTHS,
  type MonthlySummary,
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

// 機能012 の返金・手動調整と、機能018 の「彼女が払った回」
const refund = (date: string, amount: number): SummaryTxLike => ({
  date,
  type: 'partner_refund',
  amount,
  category: null,
  partner_amount: 0,
})

const adjust = (date: string, amount: number): SummaryTxLike => ({
  date,
  type: 'partner_adjust',
  amount,
  category: null,
  partner_amount: 0,
})

const paidByPartner = (
  date: string,
  paid: number,
  partner: number,
  category: string | null = 'eating_out'
): SummaryTxLike => ({
  date,
  type: 'expense',
  amount: paid,
  category,
  partner_amount: partner,
  partner_paid: paid,
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

  // ---- 機能012 / 018 を数える(本文の足し算が残高と合うこと) ----

  it('返金・調整・彼女が払った分をそれぞれ数える', () => {
    const s = buildMonthlySummary(
      [
        deposit('2026-02-01', 30000),
        expense('2026-02-02', 1500),
        refund('2026-02-03', 20000),
        adjust('2026-02-04', 500),
        adjust('2026-02-05', -300),
        paidByPartner('2026-02-06', 3000, 1200),
      ],
      '2026-02'
    )
    expect(s.depositTotal).toBe(30000)
    expect(s.withdrawTotal).toBe(1500 + 1200)
    expect(s.refundTotal).toBe(20000)
    expect(s.adjustTotal).toBe(200)
    expect(s.partnerPaidTotal).toBe(3000)
  })

  it('本文に出す数字の足し算が、残高の動きと一致する', () => {
    const rows = [
      deposit('2026-02-01', 30000),
      expense('2026-02-02', 1500),
      refund('2026-02-03', 20000),
      adjust('2026-02-04', -300),
      paidByPartner('2026-02-06', 3000, 1200),
    ]
    const s = buildMonthlySummary(rows, '2026-02')
    const fromLines =
      s.depositTotal - s.withdrawTotal + s.partnerPaidTotal - s.refundTotal + s.adjustTotal
    // その月しか記録が無いので、残高そのものと一致するはず
    expect(fromLines).toBe(s.balance)
  })

  it('返金しかなかった月も送る(2万円返した月に黙らない)', () => {
    const s = buildMonthlySummary([refund('2026-02-10', 20000)], '2026-02')
    expect(s.hasActivity).toBe(true)
    expect(s.refundTotal).toBe(20000)
  })

  it('調整しかなかった月も送る(増やす調整・減らす調整のどちらでも)', () => {
    expect(buildMonthlySummary([adjust('2026-02-10', 500)], '2026-02').hasActivity).toBe(true)
    expect(buildMonthlySummary([adjust('2026-02-10', -500)], '2026-02').hasActivity).toBe(true)
  })

  it('彼女が払った回しか無い月も送る(残高は増えている)', () => {
    const s = buildMonthlySummary([paidByPartner('2026-02-10', 3000, 0)], '2026-02')
    expect(s.hasActivity).toBe(true)
    expect(s.partnerPaidTotal).toBe(3000)
    expect(s.withdrawTotal).toBe(0)
  })

  it('増やす調整と減らす調整が同額の月でも、動きがあったことは伝える', () => {
    // 合計は 0 でも、記録は2件動いている。ここで黙ると調整の履歴が伝わらない
    const s = buildMonthlySummary(
      [adjust('2026-02-10', 500), adjust('2026-02-11', -500), deposit('2026-02-12', 1000)],
      '2026-02'
    )
    expect(s.adjustTotal).toBe(0)
    expect(s.hasActivity).toBe(true)
  })

  it('別の月の返金・調整は数えない', () => {
    const rows = [refund('2026-01-10', 5000), adjust('2026-03-10', 700)]
    const s = buildMonthlySummary(rows, '2026-02')
    expect(s.refundTotal).toBe(0)
    expect(s.adjustTotal).toBe(0)
    expect(s.hasActivity).toBe(false)
  })

  it('返金・調整・彼女が払った分も残高に効く(partnerBalance と同じ式)', () => {
    const rows = [
      deposit('2026-01-01', 30000),
      refund('2026-02-03', 20000),
      adjust('2026-02-04', -300),
      paidByPartner('2026-02-06', 3000, 1200),
    ]
    // 30000 - 20000 - 300 + (3000 - 1200)
    expect(buildMonthlySummary(rows, '2026-02').balance).toBe(11500)
  })
})

// ============================================================
// formatMonthlySummary
// ============================================================
describe('formatMonthlySummary', () => {
  const labelOf = (c: string | null) => (c === 'food' ? '食費' : c === null ? 'その他' : c)

  const summary = (over: Partial<MonthlySummary> = {}): MonthlySummary => ({
    month: '2026-02',
    withdrawTotal: 0,
    depositTotal: 0,
    refundTotal: 0,
    adjustTotal: 0,
    partnerPaidTotal: 0,
    balance: 0,
    categories: [],
    hasActivity: true,
    ...over,
  })

  it('合計・残高・内訳が入る', () => {
    const text = formatMonthlySummary(
      summary({
        withdrawTotal: 3500,
        depositTotal: 30000,
        balance: 21500,
        categories: [{ category: 'food', amount: 3500 }],
      }),
      labelOf
    )
    expect(text).toContain('2026年2月のまとめ')
    expect(text).toContain('使った分の合計: ¥3,500')
    expect(text).toContain('預かった合計: ¥30,000')
    expect(text).toContain('いまの残高: ¥21,500')
    expect(text).toContain('・食費 ¥3,500')
  })

  it('預かりが無い月は「預かった合計」の行を出さない', () => {
    const text = formatMonthlySummary(summary({ withdrawTotal: 100, balance: 900 }), labelOf)
    expect(text).not.toContain('預かった合計')
    expect(text).not.toContain('内訳')
  })

  it('返金・調整・彼女が払った分も本文に出る (機能012 / 018)', () => {
    const text = formatMonthlySummary(
      summary({
        withdrawTotal: 2700,
        depositTotal: 30000,
        refundTotal: 20000,
        adjustTotal: -300,
        partnerPaidTotal: 3000,
        balance: 10000,
      }),
      labelOf
    )
    expect(text).toContain('使った分の合計: ¥2,700')
    expect(text).toContain('彼女が払ってくれた分: ¥3,000')
    expect(text).toContain('預かった合計: ¥30,000')
    expect(text).toContain('返した合計: ¥20,000')
    expect(text).toContain('調整で減らした分: ¥300')
  })

  it('増やす調整は「増やした分」と書く(符号を数字だけに任せない)', () => {
    const text = formatMonthlySummary(summary({ adjustTotal: 500 }), labelOf)
    expect(text).toContain('調整で増やした分: ¥500')
    expect(text).not.toContain('減らした分')
  })

  it('動きの無かった項目は行ごと出さない(毎月同じ 0 を並べない)', () => {
    const text = formatMonthlySummary(summary({ withdrawTotal: 100, balance: 900 }), labelOf)
    for (const label of ['返した合計', '調整で', '彼女が払ってくれた分', '預かった合計']) {
      expect(text).not.toContain(label)
    }
  })

  it('残高がマイナスのときは符号ではなく言葉で意味を伝える (機能011)', () => {
    const text = formatMonthlySummary(summary({ withdrawTotal: 100, balance: -500 }), labelOf)
    // マイナスは「立て替え中(彼女への貸し)」。符号だけだと預かりが減ったのか
    // 貸しが増えたのか読めないので、絶対値 + 言葉で出す
    expect(text).toContain('いまの残高: ¥500(立て替え中(彼女への貸し))')
    expect(text).not.toContain('−¥500')
  })
})
