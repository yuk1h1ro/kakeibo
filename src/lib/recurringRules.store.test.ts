// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  generateDueTransactions,
  initRecurringRules,
  isRecurringUnavailable,
  resetRecurringRulesForTest,
} from './recurringRules'

// ============================================================
// recurring_rules が無い(migration-recurring-rules.sql 未実行)ときの振る舞い。
//
// 店名学習(キャッシュを残す)とは **わざと違う**:
// こちらはテーブルが無いと分かった時点で手元のルールも空にする。
// 別の環境で作ったキャッシュが残っていると、生成の印をサーバーに残せないまま
// 取引だけを積んでしまい、家賃が二重に入りかねないため。
// ============================================================

const MISSING_KEY = 'kakeibo.tableMissing.recurring_rules'
const CACHE_KEY = 'kakeibo.recurringRules'

const schemaError = { message: 'relation "public.recurring_rules" does not exist', code: '42P01' }
const networkError = { message: 'TypeError: Failed to fetch', code: null }

function fakeSupabase(opts: { selectError?: unknown } = {}) {
  const client = {
    from: () => ({
      select: () => ({
        order: async () => ({ data: [], error: opts.selectError ?? null }),
      }),
    }),
  } as unknown as SupabaseClient
  return client
}

const CACHED_RULE = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    title: '家賃',
    amount: 70000,
    category: 'housing',
    store: '',
    memo: '',
    partnerAmount: 0,
    recurrence: { kind: 'monthly', day: 27 },
    startDate: '2026-01-27',
    endDate: null,
    lastGeneratedDate: null,
    paused: false,
  },
]

beforeEach(() => {
  localStorage.clear()
  resetRecurringRulesForTest()
})

describe('テーブルが無いと分かったあと', () => {
  it('手元のキャッシュも空にする(別環境のルールを使わせない)', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(CACHED_RULE))
    await initRecurringRules(fakeSupabase({ selectError: schemaError }))
    expect(isRecurringUnavailable()).toBe(true)
    expect(localStorage.getItem(CACHE_KEY)).toBe('[]')
  })

  it('生成は試みない(印を残せないので1件も積まない)', async () => {
    await initRecurringRules(fakeSupabase({ selectError: schemaError }))
    const added: unknown[] = []
    const count = await generateDueTransactions(
      fakeSupabase({ selectError: schemaError }),
      '2026-03-01',
      async (input) => {
        added.push(input)
      }
    )
    expect(count).toBe(0)
    expect(added).toEqual([])
  })

  it('答えを localStorage に残すので、次の起動では判定を待たずに導線を隠せる', async () => {
    await initRecurringRules(fakeSupabase({ selectError: schemaError }))
    expect(localStorage.getItem(MISSING_KEY)).toBe('1')
  })

  it('読めるようになれば戻る', async () => {
    await initRecurringRules(fakeSupabase({ selectError: schemaError }))
    await initRecurringRules(fakeSupabase())
    expect(isRecurringUnavailable()).toBe(false)
    expect(localStorage.getItem(MISSING_KEY)).toBe('0')
  })
})

describe('通信できないだけのとき', () => {
  it('テーブルが無いとは見なさず、キャッシュも捨てない', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(CACHED_RULE))
    await initRecurringRules(fakeSupabase({ selectError: networkError }))
    expect(isRecurringUnavailable()).toBe(false)
    expect(localStorage.getItem(CACHE_KEY)).toBe(JSON.stringify(CACHED_RULE))
  })
})
