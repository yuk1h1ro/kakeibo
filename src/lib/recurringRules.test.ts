import { beforeEach, describe, expect, it, vi } from 'vitest'
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

// ============================================================
// generateDueTransactions と生成台帳のつなぎ目
//
// ここが「印だけ進んで取引が無い」不具合の現場なので、
// 順番(控えを残してから積む)と、行IDが控えと一致することを実物で確かめる。
// node には localStorage が無いので最小の代役を差し込む。
// ============================================================

function installStorage(): Map<string, string> {
  const map = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v)
      },
      removeItem: (k: string) => {
        map.delete(k)
      },
    },
    configurable: true,
    writable: true,
  })
  return map
}

/** 条件付き更新のふりをする最小の Supabase もどき */
function stubSupabase(result: { data: unknown; error: unknown }) {
  const calls: Record<string, unknown>[] = []
  const chain = {
    is: () => chain,
    eq: () => chain,
    select: () => Promise.resolve(result),
  }
  return {
    calls,
    client: {
      from: () => ({
        update: (patch: Record<string, unknown>) => {
          calls.push(patch)
          return chain
        },
      }),
    },
  }
}

const storedRule = {
  id: 'r1',
  title: '家賃',
  recurrence: { kind: 'monthly', dayOfMonth: 27, weekday: null, monthOfYear: null },
  amount: 80000,
  category: 'other',
  store: '',
  memo: '',
  partnerAmount: 0,
  startDate: '2026-03-01',
  lastGeneratedDate: null,
  active: true,
}

async function freshModules(rules: unknown[] = [storedRule]) {
  vi.resetModules()
  localStorage.setItem('kakeibo.recurringRules', JSON.stringify(rules))
  const ledger = await import('./recurringLedger')
  const store = await import('./recurringRules')
  return { ledger, store }
}

describe('generateDueTransactions と生成台帳', () => {
  beforeEach(() => {
    installStorage()
  })

  it('積む前に控えを残し、控えと同じ行IDで積む', async () => {
    const { ledger, store } = await freshModules()
    const sb = stubSupabase({ data: [{ id: 'r1' }], error: null })
    const seen: { id: string | undefined; recordedAlready: boolean }[] = []
    const n = await store.generateDueTransactions(
      sb.client as never,
      '2026-03-28',
      async (input, id) => {
        // 積まれた時点で、すでに控えが残っていること(順番の検査)
        seen.push({ id, recordedAlready: ledger.hasGeneratedMark('r1', input.date) })
      }
    )
    expect(n).toBe(1)
    expect(seen).toHaveLength(1)
    expect(seen[0].recordedAlready).toBe(true)
    // 控えの行IDと、積んだ行IDが一致する(回復のときに同じIDを使えることの前提)
    const marks = ledger.loadMarks()
    expect(marks).toHaveLength(1)
    expect(marks[0].txId).toBe(seen[0].id)
    expect(marks[0].date).toBe('2026-03-27')
    expect(marks[0].input.amount).toBe(80000)
    expect(marks[0].confirmed).toBe(false)
  })

  it('同じ(ルール, 日)の控えがすでにあれば生成しない(重複生成を絶対に起こさない)', async () => {
    const { ledger, store } = await freshModules()
    ledger.recordGeneratedMark({
      ruleId: 'r1',
      date: '2026-03-27',
      txId: 'tx-old',
      input: buildRecurringTransaction(rule(), '2026-03-27'),
    })
    const sb = stubSupabase({ data: [{ id: 'r1' }], error: null })
    const enqueued: string[] = []
    const n = await store.generateDueTransactions(sb.client as never, '2026-03-28', async (i) => {
      enqueued.push(i.date)
    })
    expect(n).toBe(0)
    expect(enqueued).toEqual([])
    expect(ledger.loadMarks()).toHaveLength(1)
  })

  it('印を進められなければ生成もせず、控えも残さない(従来どおり)', async () => {
    const { ledger, store } = await freshModules()
    // 他の端末が先に生成した = 1行も更新されない
    const sb = stubSupabase({ data: [], error: null })
    const enqueued: string[] = []
    const n = await store.generateDueTransactions(sb.client as never, '2026-03-28', async (i) => {
      enqueued.push(i.date)
    })
    expect(n).toBe(0)
    expect(enqueued).toEqual([])
    expect(ledger.loadMarks()).toEqual([])
  })

  it('複数の未生成日はそれぞれ別の行IDで控える', async () => {
    const { ledger, store } = await freshModules([
      { ...storedRule, startDate: '2026-01-01', lastGeneratedDate: '2026-01-28' },
    ])
    const sb = stubSupabase({ data: [{ id: 'r1' }], error: null })
    const ids: (string | undefined)[] = []
    const n = await store.generateDueTransactions(sb.client as never, '2026-03-28', async (_i, id) => {
      ids.push(id)
    })
    expect(n).toBe(2)
    expect(new Set(ids).size).toBe(2)
    expect(ledger.loadMarks().map((m) => m.date)).toEqual(['2026-02-27', '2026-03-27'])
  })
})
