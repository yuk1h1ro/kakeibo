import { describe, expect, it } from 'vitest'
import { buildRecurringTransaction, planGeneration, type RecurringRule } from './recurringRules'

const rule = (over: Partial<RecurringRule> = {}): RecurringRule => ({
  id: 'r1',
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
  ...over,
})

describe('buildRecurringTransaction', () => {
  it('自動生成の印を付けた支出を作る', () => {
    expect(buildRecurringTransaction(rule(), '2026-03-27')).toEqual({
      date: '2026-03-27',
      type: 'expense',
      amount: 80000,
      category: 'other',
      memo: '',
      store: '',
      partner_amount: 0,
      source: 'recurring',
    })
  })

  it('彼女の負担分が総額を超えないように丸める(保存時の制約に合わせる)', () => {
    const t = buildRecurringTransaction(rule({ amount: 1000, partnerAmount: 5000 }), '2026-03-27')
    expect(t.partner_amount).toBe(1000)
  })
})

describe('planGeneration', () => {
  it('未生成分があるルールだけを返す', () => {
    const plan = planGeneration(
      [
        rule({ id: 'a', lastGeneratedDate: '2026-01-27' }),
        rule({ id: 'b', lastGeneratedDate: '2026-03-28' }),
        rule({ id: 'c', active: false }),
      ],
      '2026-03-28'
    )
    expect(plan.map((p) => p.rule.id)).toEqual(['a'])
    expect(plan[0].dates).toEqual(['2026-02-27', '2026-03-27'])
  })

  it('該当が無ければ空(起動のたびに何も起きない)', () => {
    expect(planGeneration([rule({ lastGeneratedDate: '2026-03-28' })], '2026-03-28')).toEqual([])
  })
})
