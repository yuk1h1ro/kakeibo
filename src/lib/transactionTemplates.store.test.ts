// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  initTransactionTemplates,
  isTemplatesUnavailable,
  resetTransactionTemplatesForTest,
} from './transactionTemplates'

// ============================================================
// transaction_templates が無い(migration-transaction-templates.sql 未実行)ときの振る舞い。
//
// 繰り返し入力と同じく、テーブルが無ければ手元の控えも空にする
// (別環境の控えを出しても、押した瞬間に保存できないだけなので)。
// 消えるのはテンプレートの導線だけで、通常の入力には影響しない。
// ============================================================

const MISSING_KEY = 'kakeibo.tableMissing.transaction_templates'
const CACHE_KEY = 'kakeibo.transactionTemplates'

const schemaError = {
  message: "Could not find the table 'public.transaction_templates' in the schema cache",
  code: 'PGRST205',
}
const networkError = { message: 'TypeError: Failed to fetch', code: null }

const CACHED = [
  {
    id: '22222222-2222-2222-2222-222222222222',
    title: 'コンビニ',
    amount: 500,
    category: 'food',
    store: 'セブンイレブン',
    memo: '',
    partnerAmount: 0,
    sortOrder: 0,
  },
]

function fakeSupabase(opts: { selectError?: unknown } = {}) {
  return {
    from: () => ({
      select: () => ({
        order: async () => ({ data: [], error: opts.selectError ?? null }),
      }),
    }),
  } as unknown as SupabaseClient
}

beforeEach(() => {
  localStorage.clear()
  resetTransactionTemplatesForTest()
})

describe('テーブルが無いと分かったあと', () => {
  it('導線を隠し、手元の控えも空にする', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(CACHED))
    await initTransactionTemplates(fakeSupabase({ selectError: schemaError }))
    expect(isTemplatesUnavailable()).toBe(true)
    expect(localStorage.getItem(CACHE_KEY)).toBe('[]')
  })

  it('答えを localStorage に残すので、次の起動では判定を待たずに導線を隠せる', async () => {
    await initTransactionTemplates(fakeSupabase({ selectError: schemaError }))
    expect(localStorage.getItem(MISSING_KEY)).toBe('1')
  })

  it('読めるようになれば戻る', async () => {
    await initTransactionTemplates(fakeSupabase({ selectError: schemaError }))
    await initTransactionTemplates(fakeSupabase())
    expect(isTemplatesUnavailable()).toBe(false)
    expect(localStorage.getItem(MISSING_KEY)).toBe('0')
  })
})

describe('通信できないだけのとき', () => {
  it('テーブルが無いとは見なさず、控えも捨てない', async () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify(CACHED))
    await initTransactionTemplates(fakeSupabase({ selectError: networkError }))
    expect(isTemplatesUnavailable()).toBe(false)
    expect(localStorage.getItem(CACHE_KEY)).toBe(JSON.stringify(CACHED))
  })
})
