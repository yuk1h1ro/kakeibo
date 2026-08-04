import { describe, expect, it } from 'vitest'
import type { AssetDef, BalanceSnapshot } from './assets'
import {
  assetRows,
  balanceHistory,
  compactYen,
  daysBetween,
  formatBalanceInput,
  latestBalanceAsOf,
  monthEndISO,
  monthlyNetWorthSeries,
  netWorthAt,
  netWorthChange,
  parseBalanceInput,
  recordDates,
  shiftMonth,
} from './netWorth'

// テスト用のヘルパー。必要な項目だけ上書きする
let seq = 0
function asset(p: Partial<AssetDef> = {}): AssetDef {
  seq += 1
  return {
    id: p.id ?? `a${String(seq).padStart(3, '0')}`,
    kind: 'asset',
    category: 'bank',
    name: '銀行',
    sortOrder: seq,
    archived: false,
    ...p,
  }
}

function snap(assetId: string, asOf: string, balance: number, createdAt?: string): BalanceSnapshot {
  seq += 1
  return {
    id: `b${String(seq).padStart(3, '0')}`,
    assetId,
    asOf,
    balance,
    createdAt: createdAt ?? `${asOf}T00:00:00.000Z`,
  }
}

describe('日付ユーティリティ', () => {
  it('月末日を返す(うるう年も含む)', () => {
    expect(monthEndISO('2026-08')).toBe('2026-08-31')
    expect(monthEndISO('2026-02')).toBe('2026-02-28')
    expect(monthEndISO('2024-02')).toBe('2024-02-29')
  })

  it('月をまたいでずらせる(年またぎも)', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2025-12', 2)).toBe('2026-02')
  })

  it('日数の差を返す', () => {
    expect(daysBetween('2026-07-01', '2026-08-04')).toBe(34)
    expect(daysBetween('2026-08-04', '2026-08-04')).toBe(0)
  })
})

describe('latestBalanceAsOf', () => {
  const balances = [
    snap('a1', '2026-06-01', 100_000),
    snap('a1', '2026-07-01', 120_000),
    snap('a2', '2026-07-01', 5_000),
  ]

  it('基準日以前で最も新しい残高を返す', () => {
    expect(latestBalanceAsOf(balances, 'a1', '2026-07-15')?.balance).toBe(120_000)
    expect(latestBalanceAsOf(balances, 'a1', '2026-06-30')?.balance).toBe(100_000)
  })

  it('基準日より後の記録は見ない', () => {
    expect(latestBalanceAsOf(balances, 'a1', '2026-05-31')).toBeNull()
  })

  it('記録が1件も無ければ null', () => {
    expect(latestBalanceAsOf(balances, 'zzz', '2026-12-31')).toBeNull()
  })

  it('同じ日に複数回更新したときは作成時刻が後のものを採用する', () => {
    const sameDay = [
      snap('a1', '2026-08-01', 10_000, '2026-08-01T01:00:00.000Z'),
      snap('a1', '2026-08-01', 30_000, '2026-08-01T09:30:00.000Z'),
      snap('a1', '2026-08-01', 20_000, '2026-08-01T05:00:00.000Z'),
    ]
    expect(latestBalanceAsOf(sameDay, 'a1', '2026-08-01')?.balance).toBe(30_000)
    // 並び順を変えても結果は変わらない
    expect(latestBalanceAsOf([...sameDay].reverse(), 'a1', '2026-08-01')?.balance).toBe(30_000)
  })
})

describe('balanceHistory', () => {
  it('古い順に並べ、同じ日は1件に畳む', () => {
    const rows = [
      snap('a1', '2026-07-01', 1_000, '2026-07-01T00:00:00.000Z'),
      snap('a1', '2026-06-01', 500),
      snap('a1', '2026-07-01', 2_000, '2026-07-01T10:00:00.000Z'),
      snap('a2', '2026-07-01', 9_999),
    ]
    expect(balanceHistory(rows, 'a1').map((b) => [b.asOf, b.balance])).toEqual([
      ['2026-06-01', 500],
      ['2026-07-01', 2_000],
    ])
  })
})

describe('netWorthAt', () => {
  it('資産が0件なら純資産も0', () => {
    expect(netWorthAt([], [], '2026-08-04')).toEqual({
      asOf: '2026-08-04',
      totalAssets: 0,
      totalLiabilities: 0,
      netWorth: 0,
    })
  })

  it('資産合計から負債合計を引く', () => {
    const bank = asset({ id: 'bank', kind: 'asset' })
    const card = asset({ id: 'card', kind: 'liability', category: 'credit_card' })
    const point = netWorthAt(
      [bank, card],
      [snap('bank', '2026-08-01', 1_200_000), snap('card', '2026-08-01', 85_000)],
      '2026-08-04'
    )
    expect(point.totalAssets).toBe(1_200_000)
    expect(point.totalLiabilities).toBe(85_000)
    expect(point.netWorth).toBe(1_115_000)
  })

  it('負債しか無ければ純資産はマイナスになる', () => {
    const loan = asset({ id: 'loan', kind: 'liability', category: 'scholarship' })
    const point = netWorthAt([loan], [snap('loan', '2026-04-01', 2_400_000)], '2026-08-04')
    expect(point.totalAssets).toBe(0)
    expect(point.netWorth).toBe(-2_400_000)
  })

  it('まだ残高を記録していない資産は0として扱う', () => {
    const a = asset({ id: 'a', kind: 'asset' })
    const b = asset({ id: 'b', kind: 'asset' })
    expect(netWorthAt([a, b], [snap('a', '2026-08-01', 1_000)], '2026-08-04').netWorth).toBe(1_000)
  })

  it('アーカイブした資産は集計から外れる', () => {
    const alive = asset({ id: 'alive' })
    const gone = asset({ id: 'gone', archived: true })
    const balances = [snap('alive', '2026-08-01', 1_000), snap('gone', '2026-08-01', 999_999)]
    expect(netWorthAt([alive, gone], balances, '2026-08-04').netWorth).toBe(1_000)
  })

  it('記録の無い月は直前の残高を持ち越す(月をまたいでも0に落ちない)', () => {
    const a = asset({ id: 'a' })
    const balances = [snap('a', '2026-05-31', 300_000)]
    expect(netWorthAt([a], balances, '2026-08-31').netWorth).toBe(300_000)
  })

  it('マイナスの残高もそのまま合算する', () => {
    const a = asset({ id: 'a' })
    expect(netWorthAt([a], [snap('a', '2026-08-01', -5_000)], '2026-08-04').netWorth).toBe(-5_000)
  })
})

describe('recordDates', () => {
  it('重複を除いて古い順に返し、アーカイブ済みの資産の記録は数えない', () => {
    const a = asset({ id: 'a' })
    const z = asset({ id: 'z', archived: true })
    const balances = [
      snap('a', '2026-07-01', 1),
      snap('a', '2026-06-01', 1),
      snap('z', '2026-05-01', 1),
      snap('a', '2026-07-01', 2, '2026-07-01T10:00:00.000Z'),
    ]
    expect(recordDates([a, z], balances)).toEqual(['2026-06-01', '2026-07-01'])
  })
})

describe('netWorthChange', () => {
  const bank = asset({ id: 'bank' })
  const card = asset({ id: 'card', kind: 'liability' })

  it('前回の記録日からの増減を出す', () => {
    const balances = [
      snap('bank', '2026-06-01', 1_000_000),
      snap('card', '2026-06-01', 100_000),
      snap('bank', '2026-07-01', 1_150_000),
      snap('card', '2026-07-01', 80_000),
    ]
    const c = netWorthChange([bank, card], balances, '2026-08-04')
    expect(c.current.netWorth).toBe(1_070_000)
    expect(c.previous?.netWorth).toBe(900_000)
    expect(c.delta).toBe(170_000)
    expect(c.lastRecordedOn).toBe('2026-07-01')
    expect(c.daysSinceLastRecord).toBe(34)
  })

  it('記録が1回だけなら増減は出さない', () => {
    const c = netWorthChange([bank], [snap('bank', '2026-08-01', 500)], '2026-08-04')
    expect(c.previous).toBeNull()
    expect(c.delta).toBeNull()
    expect(c.lastRecordedOn).toBe('2026-08-01')
  })

  it('記録が1件も無ければ純資産0・増減なし', () => {
    const c = netWorthChange([bank], [], '2026-08-04')
    expect(c.current.netWorth).toBe(0)
    expect(c.delta).toBeNull()
    expect(c.lastRecordedOn).toBeNull()
    expect(c.daysSinceLastRecord).toBeNull()
  })

  it('同じ日に複数回更新しても「前回」は別の日の記録を指す', () => {
    const balances = [
      snap('bank', '2026-07-01', 1_000_000),
      snap('bank', '2026-08-01', 1_100_000, '2026-08-01T01:00:00.000Z'),
      snap('bank', '2026-08-01', 1_200_000, '2026-08-01T12:00:00.000Z'),
    ]
    const c = netWorthChange([bank], balances, '2026-08-04')
    expect(c.current.netWorth).toBe(1_200_000)
    expect(c.previous?.netWorth).toBe(1_000_000)
    expect(c.delta).toBe(200_000)
  })

  it('未来日の記録は今日時点の純資産に含めない', () => {
    const balances = [snap('bank', '2026-08-01', 100), snap('bank', '2026-09-01', 999_999)]
    expect(netWorthChange([bank], balances, '2026-08-04').current.netWorth).toBe(100)
  })
})

describe('monthlyNetWorthSeries', () => {
  const bank = asset({ id: 'bank' })
  const loan = asset({ id: 'loan', kind: 'liability' })

  it('記録が無ければ空', () => {
    expect(monthlyNetWorthSeries([bank], [], '2026-08-04')).toEqual([])
  })

  it('最初の記録の月から今月まで、記録の無い月は持ち越して埋める', () => {
    const balances = [snap('bank', '2026-06-15', 200_000), snap('bank', '2026-08-01', 260_000)]
    const series = monthlyNetWorthSeries([bank], balances, '2026-08-04')
    expect(series.map((p) => [p.month, p.netWorth])).toEqual([
      ['2026-06', 200_000],
      ['2026-07', 200_000], // 記録が無い月は6月の残高を持ち越す
      ['2026-08', 260_000],
    ])
  })

  it('年をまたいでも月キーが連続する', () => {
    const balances = [snap('bank', '2025-11-30', 10_000)]
    const series = monthlyNetWorthSeries([bank], balances, '2026-01-15')
    expect(series.map((p) => p.month)).toEqual(['2025-11', '2025-12', '2026-01'])
  })

  it('maxMonths を超えたぶんは古いほうから切り捨てる', () => {
    const balances = [snap('bank', '2024-01-01', 1_000)]
    const series = monthlyNetWorthSeries([bank], balances, '2026-08-04', 6)
    expect(series).toHaveLength(6)
    expect(series[0].month).toBe('2026-03')
    expect(series[5].month).toBe('2026-08')
  })

  it('負債だけならマイナスの推移になる', () => {
    const balances = [snap('loan', '2026-07-10', 500_000), snap('loan', '2026-08-10', 480_000)]
    const series = monthlyNetWorthSeries([loan], balances, '2026-08-20')
    expect(series.map((p) => p.netWorth)).toEqual([-500_000, -480_000])
  })

  it('月末時点で評価する(月内の記録はその月に反映される)', () => {
    const balances = [snap('bank', '2026-08-31', 7_000)]
    const series = monthlyNetWorthSeries([bank], balances, '2026-08-04')
    expect(series).toEqual([
      { month: '2026-08', asOf: '2026-08-31', totalAssets: 7_000, totalLiabilities: 0, netWorth: 7_000 },
    ])
  })
})

describe('assetRows', () => {
  it('資産ごとの現在残高と前回比を返す', () => {
    const bank = asset({ id: 'bank', name: '三井住友', sortOrder: 1 })
    const sec = asset({ id: 'sec', name: 'NISA', sortOrder: 0 })
    const balances = [
      snap('bank', '2026-07-01', 100_000),
      snap('bank', '2026-08-01', 90_000),
      snap('sec', '2026-08-01', 300_000),
    ]
    const rows = assetRows([bank, sec], balances, '2026-08-04')
    // sortOrder 順に並ぶ
    expect(rows.map((r) => r.asset.id)).toEqual(['sec', 'bank'])
    expect(rows[0]).toMatchObject({ balance: 300_000, delta: null, recordedOn: '2026-08-01' })
    expect(rows[1]).toMatchObject({ balance: 90_000, delta: -10_000, recordedOn: '2026-08-01' })
  })

  it('まだ記録の無い資産は balance が null', () => {
    const a = asset({ id: 'a' })
    expect(assetRows([a], [], '2026-08-04')[0]).toMatchObject({ balance: null, delta: null })
  })
})

describe('parseBalanceInput', () => {
  it('カンマや単位を落として整数にする', () => {
    expect(parseBalanceInput('1,234,567')).toBe(1_234_567)
    expect(parseBalanceInput(' 12000円 ')).toBe(12_000)
    expect(parseBalanceInput('１２３')).toBe(123) // 全角
  })

  it('先頭の0を落とす', () => {
    expect(parseBalanceInput('007')).toBe(7)
    expect(parseBalanceInput('0')).toBe(0)
  })

  it('マイナスを扱える', () => {
    expect(parseBalanceInput('-5000')).toBe(-5_000)
    expect(parseBalanceInput('−5,000')).toBe(-5_000) // 全角マイナス
  })

  it('未入力は null(0 とは区別する)', () => {
    expect(parseBalanceInput('')).toBeNull()
    expect(parseBalanceInput('   ')).toBeNull()
    expect(parseBalanceInput('-')).toBeNull()
  })

  it('小数点は無視して整数だけを拾う(円未満は持たない)', () => {
    expect(parseBalanceInput('1000.55')).toBe(100_055)
  })

  it('桁数の上限で打ち止めにする', () => {
    expect(parseBalanceInput('9'.repeat(20))).toBe(9_999_999_999_999)
  })
})

describe('formatBalanceInput / compactYen', () => {
  it('3桁区切りにする', () => {
    expect(formatBalanceInput(1_234_567)).toBe('1,234,567')
    expect(formatBalanceInput(-5_000)).toBe('-5,000')
    expect(formatBalanceInput(0)).toBe('0')
    expect(formatBalanceInput(null)).toBe('')
  })

  it('1万円以上は「万」でまとめる', () => {
    expect(compactYen(0)).toBe('0')
    expect(compactYen(9_999)).toBe('9,999')
    expect(compactYen(1_200_000)).toBe('120万')
    expect(compactYen(-2_400_000)).toBe('-240万')
  })
})
