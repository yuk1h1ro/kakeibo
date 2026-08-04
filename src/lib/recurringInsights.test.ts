import { describe, expect, it } from 'vitest'
import type { Transaction } from './types'
import type { RecurringRule } from './recurringRules'
import {
  annualOfRule,
  buildRuleInputFromCandidate,
  detectRecurringCandidates,
  fixedCostSummary,
  normalizeStoreKey,
} from './recurringInsights'

let seq = 0
function tx(p: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: p.id ?? `r${String(seq).padStart(3, '0')}`,
    date: '2026-08-04',
    type: 'expense',
    amount: 1000,
    category: 'other',
    memo: '',
    store: 'ネトフリ',
    partner_amount: 0,
    created_at: '2026-08-04T03:00:00.000Z',
    ...p,
  }
}

function rule(p: Partial<RecurringRule> = {}): RecurringRule {
  seq += 1
  return {
    id: `rule${seq}`,
    title: '家賃',
    recurrence: { kind: 'monthly', dayOfMonth: 27, weekday: null, monthOfYear: null },
    amount: 80000,
    category: 'other',
    store: '',
    memo: '',
    partnerAmount: 0,
    startDate: '2026-01-01',
    lastGeneratedDate: null,
    active: true,
    ...p,
  }
}

// ---------- 122 ----------

describe('fixedCostSummary (122)', () => {
  it('登録が0件なら合計も0', () => {
    expect(fixedCostSummary([])).toMatchObject({
      items: [],
      monthlyTotal: 0,
      annualTotal: 0,
      pausedCount: 0,
    })
  })

  it('毎月・毎週・毎年を月額と年額に換算して束ねる', () => {
    const s = fixedCostSummary([
      rule({ title: '家賃', amount: 80000 }),
      rule({
        title: '新聞',
        amount: 1000,
        recurrence: { kind: 'weekly', dayOfMonth: null, weekday: 1, monthOfYear: null },
      }),
      rule({
        title: 'ドメイン',
        amount: 1200,
        recurrence: { kind: 'yearly', dayOfMonth: 1, weekday: null, monthOfYear: 4 },
      }),
    ])
    expect(s.items.map((i) => i.title)).toEqual(['家賃', '新聞', 'ドメイン'])
    expect(s.items[0]).toMatchObject({ monthly: 80000, annual: 960000 })
    expect(s.items[1].annual).toBe(Math.round(1000 * (365 / 7)))
    expect(s.items[2]).toMatchObject({ monthly: 100, annual: 1200 })
    expect(s.monthlyTotal).toBe(s.items.reduce((a, i) => a + i.monthly, 0))
  })

  it('停止中の登録は合計から外し、件数だけ残す', () => {
    const s = fixedCostSummary([rule({ amount: 80000 }), rule({ amount: 5000, active: false })])
    expect(s.monthlyTotal).toBe(80000)
    expect(s.pausedCount).toBe(1)
  })

  it('彼女の負担分を除いた自分の実質も出す', () => {
    const s = fixedCostSummary([rule({ amount: 10000, partnerAmount: 4000 })])
    expect(s.monthlyOwnTotal).toBe(6000)
    expect(s.annualOwnTotal).toBe(72000)
  })

  it('年額換算は周期ごとに変わる', () => {
    expect(annualOfRule(1000, 'monthly')).toBe(12000)
    expect(annualOfRule(1000, 'yearly')).toBe(1000)
    expect(annualOfRule(1000, 'weekly')).toBeCloseTo(52142.86, 1)
  })
})

// ---------- 081 ----------

describe('normalizeStoreKey', () => {
  it('前後の空白・大文字小文字・全角空白を吸収する', () => {
    expect(normalizeStoreKey('  Netflix ')).toBe('netflix')
    expect(normalizeStoreKey('NET　FLIX')).toBe('netflix')
  })
})

describe('detectRecurringCandidates (081)', () => {
  const monthly = [
    tx({ date: '2026-05-15', amount: 1490, store: 'Netflix' }),
    tx({ date: '2026-06-15', amount: 1490, store: 'Netflix' }),
    tx({ date: '2026-07-15', amount: 1490, store: 'Netflix' }),
  ]

  it('記録が0件なら候補も0件', () => {
    expect(detectRecurringCandidates([], [], '2026-08-04')).toEqual([])
  })

  it('毎月ほぼ同額・ほぼ同間隔なら候補になる', () => {
    const [c] = detectRecurringCandidates(monthly, [], '2026-08-04')
    expect(c).toMatchObject({
      store: 'Netflix',
      occurrences: 3,
      medianAmount: 1490,
      medianIntervalDays: 31,
      monthlyEquivalent: 1490,
      lastDate: '2026-07-15',
    })
    expect(c.recurrence).toEqual({
      kind: 'monthly',
      dayOfMonth: 15,
      weekday: null,
      monthOfYear: null,
    })
  })

  it('2回だけでは候補にしない(たまたま2回と区別できない)', () => {
    expect(detectRecurringCandidates(monthly.slice(0, 2), [], '2026-08-04')).toEqual([])
  })

  it('間隔がばらつく買い物は候補にしない', () => {
    const irregular = [
      tx({ date: '2026-06-01', amount: 1000, store: 'スーパー' }),
      tx({ date: '2026-06-20', amount: 1000, store: 'スーパー' }),
      tx({ date: '2026-07-30', amount: 1000, store: 'スーパー' }),
    ]
    expect(detectRecurringCandidates(irregular, [], '2026-08-04')).toEqual([])
  })

  it('金額がばらつく店は候補にしない', () => {
    const varied = [
      tx({ date: '2026-05-15', amount: 1000, store: 'コンビニ' }),
      tx({ date: '2026-06-15', amount: 3000, store: 'コンビニ' }),
      tx({ date: '2026-07-15', amount: 8000, store: 'コンビニ' }),
    ]
    expect(detectRecurringCandidates(varied, [], '2026-08-04')).toEqual([])
  })

  it('端数のぶれ(10%以内)は同額とみなす', () => {
    const nearly = [
      tx({ date: '2026-05-15', amount: 1000, store: '電気' }),
      tx({ date: '2026-06-15', amount: 1050, store: '電気' }),
      tx({ date: '2026-07-15', amount: 980, store: '電気' }),
    ]
    expect(detectRecurringCandidates(nearly, [], '2026-08-04')).toHaveLength(1)
  })

  it('しばらく止まっている(解約済みらしい)ものは提案しない', () => {
    const stale = [
      tx({ date: '2026-01-15', amount: 1490, store: 'Hulu' }),
      tx({ date: '2026-02-15', amount: 1490, store: 'Hulu' }),
      tx({ date: '2026-03-15', amount: 1490, store: 'Hulu' }),
    ]
    expect(detectRecurringCandidates(stale, [], '2026-08-04')).toEqual([])
  })

  it('すでに繰り返し入力に登録済みの店は再提案しない(店名でも名前でも)', () => {
    expect(detectRecurringCandidates(monthly, [{ store: 'netflix', title: '' }], '2026-08-04')).toEqual([])
    expect(detectRecurringCandidates(monthly, [{ store: '', title: 'Netflix' }], '2026-08-04')).toEqual([])
  })

  it('停止中の登録でも再提案しない(意図的に止めたものを掘り返さない)', () => {
    const rules = [rule({ store: 'Netflix', title: 'ネトフリ', active: false })]
    expect(detectRecurringCandidates(monthly, rules, '2026-08-04')).toEqual([])
  })

  it('「いらない」と言われた候補は出さない', () => {
    expect(detectRecurringCandidates(monthly, [], '2026-08-04', ['netflix'])).toEqual([])
  })

  it('繰り返し入力が自動生成した記録は材料にしない', () => {
    const auto = monthly.map((t) => ({ ...t, source: 'recurring' }))
    expect(detectRecurringCandidates(auto, [], '2026-08-04')).toEqual([])
  })

  it('店名の無い記録は候補にしない', () => {
    const noStore = monthly.map((t) => ({ ...t, store: '' }))
    expect(detectRecurringCandidates(noStore, [], '2026-08-04')).toEqual([])
  })

  it('毎週の支払いを週次として拾う', () => {
    const weekly = [
      tx({ date: '2026-07-14', amount: 800, store: '習い事' }),
      tx({ date: '2026-07-21', amount: 800, store: '習い事' }),
      tx({ date: '2026-07-28', amount: 800, store: '習い事' }),
      tx({ date: '2026-08-04', amount: 800, store: '習い事' }),
    ]
    const [c] = detectRecurringCandidates(weekly, [], '2026-08-04')
    expect(c.recurrence).toEqual({ kind: 'weekly', dayOfMonth: null, weekday: 2, monthOfYear: null })
    expect(c.monthlyEquivalent).toBe(Math.round((800 * (365 / 7)) / 12))
  })

  it('毎年の支払いを年次として拾う(年またぎ・うるう年を含む)', () => {
    const yearly = [
      tx({ date: '2024-02-29', amount: 5000, store: 'ドメイン' }),
      tx({ date: '2025-03-01', amount: 5000, store: 'ドメイン' }),
      tx({ date: '2026-03-01', amount: 5000, store: 'ドメイン' }),
    ]
    const [c] = detectRecurringCandidates(yearly, [], '2026-08-04')
    expect(c.recurrence).toEqual({
      kind: 'yearly',
      dayOfMonth: 1,
      weekday: null,
      monthOfYear: 3,
    })
    expect(c.monthlyEquivalent).toBe(417)
  })

  it('同じ日の複数件は1回の支払いとして合算する', () => {
    const sameDay = [
      tx({ date: '2026-06-04', amount: 700, store: 'ジム' }),
      tx({ date: '2026-06-04', amount: 800, store: 'ジム' }),
      tx({ date: '2026-07-04', amount: 1500, store: 'ジム' }),
      tx({ date: '2026-08-04', amount: 1500, store: 'ジム' }),
    ]
    const [c] = detectRecurringCandidates(sameDay, [], '2026-08-04')
    expect(c.occurrences).toBe(3)
    expect(c.medianAmount).toBe(1500)
  })

  it('月額換算の大きい順に並ぶ', () => {
    const two = [
      ...monthly,
      tx({ date: '2026-05-20', amount: 9800, store: 'ジム' }),
      tx({ date: '2026-06-20', amount: 9800, store: 'ジム' }),
      tx({ date: '2026-07-20', amount: 9800, store: 'ジム' }),
    ]
    expect(detectRecurringCandidates(two, [], '2026-08-04').map((c) => c.store)).toEqual([
      'ジム',
      'Netflix',
    ])
  })
})

describe('buildRuleInputFromCandidate', () => {
  it('開始日を翌日にして、過去分が自動生成されないようにする', () => {
    const [c] = detectRecurringCandidates(
      [
        tx({ date: '2026-06-04', amount: 1490, store: 'Netflix', category: 'sub' }),
        tx({ date: '2026-07-04', amount: 1490, store: 'Netflix', category: 'sub' }),
        tx({ date: '2026-08-04', amount: 1490, store: 'Netflix', category: 'sub' }),
      ],
      [],
      '2026-08-04'
    )
    expect(buildRuleInputFromCandidate(c, '2026-08-04')).toEqual({
      title: 'Netflix',
      recurrence: { kind: 'monthly', dayOfMonth: 4, weekday: null, monthOfYear: null },
      amount: 1490,
      category: 'sub',
      store: 'Netflix',
      memo: '',
      partnerAmount: 0,
      startDate: '2026-08-05',
      active: true,
    })
  })

  it('月末の翌日は月をまたぐ', () => {
    const [c] = detectRecurringCandidates(
      [
        tx({ date: '2026-05-31', amount: 500, store: 'A' }),
        tx({ date: '2026-06-30', amount: 500, store: 'A' }),
        tx({ date: '2026-07-31', amount: 500, store: 'A' }),
      ],
      [],
      '2026-08-31'
    )
    expect(buildRuleInputFromCandidate(c, '2026-08-31').startDate).toBe('2026-09-01')
  })
})
