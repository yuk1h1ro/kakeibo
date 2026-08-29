import { describe, expect, it } from 'vitest'
import type { Transaction } from './types'
import {
  NO_STORE_LABEL,
  annualFromMonthly,
  annualFromRange,
  dayOfWeek,
  hourBandStats,
  jstHour,
  lastYearMonth,
  monthRange,
  normalizeRange,
  partnerBalanceImpact,
  partnerImpactNote,
  rangeDays,
  rankByCategory,
  rankByStore,
  rankByTransaction,
  satisfactionSummary,
  totalOwn,
  totalPartner,
  weekdayStats,
} from './report'

// テスト用の取引を作るヘルパー。必要な項目だけ上書きする
let seq = 0
function tx(p: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: p.id ?? `id${String(seq).padStart(3, '0')}`,
    date: '2026-08-04',
    type: 'expense',
    amount: 1000,
    category: 'food',
    memo: '',
    store: '',
    partner_amount: 0,
    created_at: '2026-08-04T03:00:00.000Z',
    ...p,
  }
}

describe('monthRange / lastYearMonth', () => {
  it('月末日を月ごとに正しく出す', () => {
    expect(monthRange('2026-08')).toEqual({ start: '2026-08-01', end: '2026-08-31' })
    expect(monthRange('2026-04')).toEqual({ start: '2026-04-01', end: '2026-04-30' })
  })

  it('うるう年の2月は29日まで', () => {
    expect(monthRange('2024-02').end).toBe('2024-02-29')
    expect(monthRange('2023-02').end).toBe('2023-02-28')
    expect(monthRange('2100-02').end).toBe('2100-02-28') // 100年ルール
  })

  it('うるう年の2月の1年前は28日までの2月になる', () => {
    expect(lastYearMonth('2024-02')).toBe('2023-02')
    expect(monthRange(lastYearMonth('2024-02'))).toEqual({
      start: '2023-02-01',
      end: '2023-02-28',
    })
  })

  it('1月の1年前は前年の1月', () => {
    expect(lastYearMonth('2026-01')).toBe('2025-01')
    expect(lastYearMonth('2026-12')).toBe('2025-12')
  })
})

describe('normalizeRange / rangeDays / dayOfWeek', () => {
  it('開始と終了が逆なら入れ替える', () => {
    expect(normalizeRange('2026-08-31', '2026-08-01')).toEqual({
      start: '2026-08-01',
      end: '2026-08-31',
    })
  })

  it('同じ日なら1日', () => {
    expect(rangeDays({ start: '2026-08-04', end: '2026-08-04' })).toBe(1)
  })

  it('月をまたぐ期間の日数を数えられる', () => {
    // 8/25〜9/5 = 8月分7日 + 9月分5日
    expect(rangeDays({ start: '2026-08-25', end: '2026-09-05' })).toBe(12)
  })

  it('うるう日を含む期間を正しく数える', () => {
    expect(rangeDays({ start: '2024-02-01', end: '2024-03-01' })).toBe(30)
    expect(rangeDays({ start: '2023-02-01', end: '2023-03-01' })).toBe(29)
  })

  it('年をまたぐ期間も数えられる', () => {
    expect(rangeDays({ start: '2025-12-31', end: '2026-01-01' })).toBe(2)
  })

  it('曜日を返す', () => {
    expect(dayOfWeek('2026-08-04')).toBe(2) // 火
    expect(dayOfWeek('2026-08-09')).toBe(0) // 日
  })
})

describe('totalOwn / totalPartner', () => {
  const r = monthRange('2026-08')

  it('データ0件なら0', () => {
    expect(totalOwn([], r)).toBe(0)
    expect(totalPartner([], r)).toBe(0)
  })

  it('彼女負担分を差し引いた自分の実質支出を合計する', () => {
    const txs = [
      tx({ amount: 3000, partner_amount: 1000 }),
      tx({ amount: 500 }),
      tx({ type: 'partner_deposit', amount: 30000, partner_amount: 0 }),
      tx({ date: '2026-07-31', amount: 9999 }), // 期間外
    ]
    expect(totalOwn(txs, r)).toBe(2500)
    expect(totalPartner(txs, r)).toBe(1000)
  })
})

describe('partnerBalanceImpact — この期間の支出が預かり残高に与えた影響', () => {
  const r = monthRange('2026-08')
  // 副題の文言まで含めて確かめる。金額の整形は画面側(目隠しを通した yen)の仕事なので、
  // テストでは素の表記を渡す
  const note = (impact: number) => partnerImpactNote(impact, (n) => `¥${n.toLocaleString('ja-JP')}`)

  it('データ0件なら0で、残高は動いていないと言う', () => {
    expect(partnerBalanceImpact([], r)).toBe(0)
    expect(note(0)).toBe('預かり残高への影響はありません')
  })

  it('自分が全額払った回は、彼女の負担分だけ残高から引かれる', () => {
    const txs = [tx({ amount: 3000, partner_amount: 1000 })] // partner_paid 無し = 自分が全額
    expect(partnerBalanceImpact(txs, r)).toBe(-1000)
    expect(note(-1000)).toBe('預かり残高から ¥1,000 を差し引いています')
  })

  it('彼女が払った回は残高が増える(「差引」と書いたら嘘になる回)', () => {
    // これが直した不具合そのもの。3,000円を彼女が払い、彼女の負担は1,000円なので
    // 差し引かれるどころか 2,000円 こちらが借りている
    const txs = [tx({ amount: 3000, partner_amount: 1000, partner_paid: 3000 })]
    expect(partnerBalanceImpact(txs, r)).toBe(2000)
    expect(note(2000)).toBe('彼女が多く払っており、預かり残高は ¥2,000 増えています')
    expect(note(2000)).not.toContain('差し引い')
  })

  it('分けて払って過不足がなければ影響なし', () => {
    const txs = [tx({ amount: 3000, partner_amount: 1000, partner_paid: 1000 })]
    expect(partnerBalanceImpact(txs, r)).toBe(0)
    expect(note(0)).toBe('預かり残高への影響はありません')
  })

  it('期間内の支出を足し合わせ、打ち消し合えば0になる', () => {
    const txs = [
      tx({ amount: 3000, partner_amount: 1000 }), // −1000
      tx({ amount: 3000, partner_amount: 1000, partner_paid: 3000 }), // +2000
      tx({ amount: 2000, partner_amount: 1000, partner_paid: 0 }), // −1000
    ]
    expect(partnerBalanceImpact(txs, r)).toBe(0)
  })

  it('預かり・返金・調整は含めない(この期間の支出の話であって、預け入れは別の出来事)', () => {
    const txs = [
      tx({ amount: 3000, partner_amount: 1000 }), // −1000
      tx({ type: 'partner_deposit', amount: 30000, partner_amount: 0 }),
      tx({ type: 'partner_refund', amount: 5000, partner_amount: 0 }),
      tx({ type: 'partner_adjust', amount: -700, partner_amount: 0 }),
    ]
    expect(partnerBalanceImpact(txs, r)).toBe(-1000)
  })

  it('期間外の支出は数えない', () => {
    const txs = [tx({ date: '2026-07-31', amount: 3000, partner_amount: 1000 })]
    expect(partnerBalanceImpact(txs, r)).toBe(0)
  })
})

describe('rankByStore', () => {
  const r = monthRange('2026-08')

  it('データ0件なら空配列', () => {
    expect(rankByStore([], r)).toEqual([])
  })

  it('店名で束ねて金額の多い順に並べる', () => {
    const txs = [
      tx({ store: 'セブン', amount: 500 }),
      tx({ store: 'セブン', amount: 300 }),
      tx({ store: 'スーパーA', amount: 2000 }),
    ]
    const got = rankByStore(txs, r)
    expect(got.map((x) => [x.label, x.total, x.count])).toEqual([
      ['スーパーA', 2000, 1],
      ['セブン', 800, 2],
    ])
  })

  it('店名が空(空白のみを含む)の記録は「店名なし」にまとめる', () => {
    const txs = [tx({ store: '', amount: 100 }), tx({ store: '   ', amount: 200 })]
    const got = rankByStore(txs, r)
    expect(got).toHaveLength(1)
    expect(got[0].label).toBe(NO_STORE_LABEL)
    expect(got[0].total).toBe(300)
  })

  it('彼女の負担分を除いた額で集計する', () => {
    const txs = [tx({ store: '居酒屋', amount: 6000, partner_amount: 2500 })]
    expect(rankByStore(txs, r)[0].total).toBe(3500)
  })

  it('彼女が全額負担した記録は含めない', () => {
    const txs = [tx({ store: 'カフェ', amount: 800, partner_amount: 800 })]
    expect(rankByStore(txs, r)).toEqual([])
  })

  it('預かり金の記録は支出として数えない', () => {
    const txs = [tx({ type: 'partner_deposit', amount: 30000, store: '銀行' })]
    expect(rankByStore(txs, r)).toEqual([])
  })

  it('同額なら件数の多い順、それも同じならキー順で安定する', () => {
    const txs = [
      tx({ store: 'B', amount: 1000 }),
      tx({ store: 'A', amount: 1000 }),
      tx({ store: 'C', amount: 500 }),
      tx({ store: 'C', amount: 500 }),
    ]
    const got = rankByStore(txs, r).map((x) => x.label)
    // C は2件で同額1000 → 件数が多いぶん先。A と B はキー順
    expect(got).toEqual(['C', 'A', 'B'])
  })

  it('月をまたぐ任意期間でも期間内だけを集計する', () => {
    const txs = [
      tx({ date: '2026-08-24', store: 'X', amount: 100 }),
      tx({ date: '2026-08-25', store: 'X', amount: 200 }),
      tx({ date: '2026-09-05', store: 'X', amount: 400 }),
      tx({ date: '2026-09-06', store: 'X', amount: 800 }),
    ]
    const got = rankByStore(txs, { start: '2026-08-25', end: '2026-09-05' })
    expect(got[0].total).toBe(600)
    expect(got[0].count).toBe(2)
  })
})

describe('rankByCategory', () => {
  const r = monthRange('2026-08')
  const labelOf = (id: string | null) => (id === null ? '未分類' : id === 'food' ? '食費' : id)

  it('カテゴリごとに束ねて表示名を解決する', () => {
    const txs = [
      tx({ category: 'food', amount: 1200 }),
      tx({ category: 'food', amount: 800 }),
      tx({ category: null, amount: 5000 }),
    ]
    expect(rankByCategory(txs, r, labelOf).map((x) => [x.label, x.total])).toEqual([
      ['未分類', 5000],
      ['食費', 2000],
    ])
  })
})

describe('rankByTransaction', () => {
  const r = monthRange('2026-08')

  it('1件ごとの高額順。同額なら新しい記録が先', () => {
    const txs = [
      tx({ id: 'a', date: '2026-08-01', amount: 1000, store: '古い' }),
      tx({ id: 'b', date: '2026-08-20', amount: 1000, store: '新しい' }),
      tx({ id: 'c', date: '2026-08-10', amount: 4000, store: '高い' }),
    ]
    expect(rankByTransaction(txs, r).map((x) => x.label)).toEqual(['高い', '新しい', '古い'])
  })

  it('店名が無ければメモ、どちらも無ければ「店名なし」を見出しにする', () => {
    const txs = [
      tx({ amount: 300, store: '', memo: '自販機' }),
      tx({ amount: 200, store: '', memo: '' }),
    ]
    expect(rankByTransaction(txs, r).map((x) => x.label)).toEqual(['自販機', NO_STORE_LABEL])
  })
})

describe('weekdayStats', () => {
  it('データ0件でも7曜日ぶん返す', () => {
    const got = weekdayStats([], monthRange('2026-08'))
    expect(got).toHaveLength(7)
    expect(got.every((d) => d.total === 0 && d.average === 0)).toBe(true)
    expect(got.map((d) => d.label)).toEqual(['日', '月', '火', '水', '木', '金', '土'])
  })

  it('曜日ごとの合計と、その曜日の日数で割った平均を出す', () => {
    // 2026-08-01 は土曜。8月の土曜は 1,8,15,22,29 の5日
    const txs = [
      tx({ date: '2026-08-01', amount: 3000 }),
      tx({ date: '2026-08-08', amount: 2000 }),
      tx({ date: '2026-08-03', amount: 500 }), // 月曜
    ]
    const got = weekdayStats(txs, monthRange('2026-08'))
    const sat = got[6]
    expect(sat.days).toBe(5)
    expect(sat.total).toBe(5000)
    expect(sat.average).toBe(1000)
    expect(got[1].total).toBe(500) // 月曜
  })

  it('短い期間では現れない曜日の日数が0になり、平均は0のまま', () => {
    // 2026-08-04(火)〜2026-08-06(木) の3日間
    const got = weekdayStats([], { start: '2026-08-04', end: '2026-08-06' })
    expect(got.map((d) => d.days)).toEqual([0, 0, 1, 1, 1, 0, 0])
    expect(got[0].average).toBe(0)
  })

  it('月をまたぐ期間でも曜日の出現回数を数えられる', () => {
    const got = weekdayStats([], { start: '2026-08-31', end: '2026-09-06' }) // 月〜日の7日間
    expect(got.map((d) => d.days)).toEqual([1, 1, 1, 1, 1, 1, 1])
  })
})

describe('jstHour', () => {
  it('UTC の ISO 文字列を日本時間の「時」に直す', () => {
    expect(jstHour('2026-08-04T03:00:00.000Z')).toBe(12)
    expect(jstHour('2026-08-04T00:00:00Z')).toBe(9)
  })

  it('日付をまたぐ時刻も正しく折り返す', () => {
    expect(jstHour('2026-08-04T15:30:00Z')).toBe(0) // 翌日の0時台
    expect(jstHour('2026-08-04T20:00:00Z')).toBe(5)
  })

  it('タイムゾーン指定が無ければ UTC とみなす(Supabase の返り値に合わせる)', () => {
    expect(jstHour('2026-08-04 03:00:00')).toBe(12)
  })

  it('オフセット付きの文字列も扱える', () => {
    expect(jstHour('2026-08-04T12:00:00+09:00')).toBe(12)
    expect(jstHour('2026-08-03T23:00:00-05:00')).toBe(13)
  })

  it('読み取れない値は null', () => {
    expect(jstHour('')).toBe(null)
    expect(jstHour(null)).toBe(null)
    expect(jstHour('きのう')).toBe(null)
  })
})

describe('hourBandStats', () => {
  const r = monthRange('2026-08')

  it('データ0件でも6本の帯を返す', () => {
    const got = hourBandStats([], r)
    expect(got.bands.map((b) => b.label)).toEqual([
      '0-4時',
      '4-8時',
      '8-12時',
      '12-16時',
      '16-20時',
      '20-24時',
    ])
    expect(got.bands.every((b) => b.total === 0)).toBe(true)
    expect(got.unknownCount).toBe(0)
  })

  it('記録時刻(日本時間)の帯に振り分ける', () => {
    const txs = [
      tx({ amount: 1000, created_at: '2026-08-04T03:00:00Z' }), // JST 12時 → 12-16時
      tx({ amount: 500, created_at: '2026-08-04T14:00:00Z' }), // JST 23時 → 20-24時
      tx({ amount: 200, created_at: '2026-08-04T16:00:00Z' }), // JST 翌1時 → 0-4時
    ]
    const got = hourBandStats(txs, r)
    expect(got.bands[3].total).toBe(1000)
    expect(got.bands[5].total).toBe(500)
    expect(got.bands[0].total).toBe(200)
  })

  it('記録時刻が読み取れない行は集計から外して件数だけ数える', () => {
    const txs = [tx({ amount: 1000, created_at: '' }), tx({ amount: 100 })]
    const got = hourBandStats(txs, r)
    expect(got.unknownCount).toBe(1)
    expect(got.bands.reduce((s, b) => s + b.total, 0)).toBe(100)
  })

  it('平均は期間の日数で割る', () => {
    const txs = [tx({ date: '2026-08-04', amount: 620, created_at: '2026-08-04T03:00:00Z' })]
    const got = hourBandStats(txs, { start: '2026-08-01', end: '2026-08-31' })
    expect(got.bands[3].average).toBe(20) // 620 / 31
  })
})

describe('年換算', () => {
  it('月額は12倍', () => {
    expect(annualFromMonthly(12345)).toBe(148140)
    expect(annualFromMonthly(0)).toBe(0)
  })

  it('任意期間は1日あたり×365', () => {
    expect(annualFromRange(1000, 10)).toBe(36500)
    expect(annualFromRange(0, 10)).toBe(0)
    expect(annualFromRange(1000, 0)).toBe(0) // 0除算を避ける
  })
})

describe('satisfactionSummary — 感情スタンプの振り返り', () => {
  const r = monthRange('2026-08')

  it('スタンプ別の件数と後悔の合計を出す', () => {
    const txs = [
      tx({ date: '2026-08-03', amount: 1200, satisfaction: 'regret' }),
      tx({ date: '2026-08-04', amount: 800, satisfaction: 'regret' }),
      tx({ date: '2026-08-05', amount: 500, satisfaction: 'good' }),
      tx({ date: '2026-08-06', amount: 300 }), // 未設定
    ]
    const got = satisfactionSummary(txs, r)
    expect(got.counts).toEqual({ good: 1, neutral: 0, regret: 2, unset: 1 })
    expect(got.regretCount).toBe(2)
    expect(got.regretTotal).toBe(2000)
    expect(got.stampedCount).toBe(3)
  })

  it('後悔の金額は彼女の負担分を除いた自分の実質支出で数える', () => {
    const txs = [tx({ date: '2026-08-03', amount: 1000, partner_amount: 400, satisfaction: 'regret' })]
    expect(satisfactionSummary(txs, r).regretTotal).toBe(600)
  })

  it('後悔が多い曜日を返す(2026-08-07 は金曜)', () => {
    const txs = [
      tx({ date: '2026-08-07', amount: 100, satisfaction: 'regret' }),
      tx({ date: '2026-08-14', amount: 100, satisfaction: 'regret' }),
      tx({ date: '2026-08-05', amount: 900, satisfaction: 'regret' }),
    ]
    const got = satisfactionSummary(txs, r)
    expect(got.worstWeekday?.label).toBe('金')
    expect(got.worstWeekday?.count).toBe(2)
    expect(got.worstWeekday?.total).toBe(200)
  })

  it('後悔が1件も無ければ曜日は出さない', () => {
    const txs = [tx({ date: '2026-08-03', satisfaction: 'good' })]
    expect(satisfactionSummary(txs, r).worstWeekday).toBeNull()
  })

  it('期間外の記録は数えない', () => {
    const txs = [tx({ date: '2026-07-31', satisfaction: 'regret' })]
    const got = satisfactionSummary(txs, r)
    expect(got.regretCount).toBe(0)
    expect(got.stampedCount).toBe(0)
  })
})
