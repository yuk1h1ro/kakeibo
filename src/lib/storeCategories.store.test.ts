// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getStoreCategories,
  initStoreCategories,
  rememberStoreCategory,
  resetStoreCategoriesForTest,
} from './storeCategories'

// ============================================================
// store_categories が無い(migration-store-categories.sql 未実行)ときの振る舞い。
//
// ここで守りたいのは **学習が端末内で続くこと**。
// テーブルが無いと分かってもキャッシュは捨てない — 捨ててしまうと、
// マイグレーションを実行していない人だけ店名の自動選択が永久に効かなくなる。
// (空にする recurringRules / transactionTemplates とは、わざと違う判断)
// ============================================================

const MISSING_KEY = 'kakeibo.tableMissing.store_categories'

const schemaError = { message: 'relation "public.store_categories" does not exist', code: '42P01' }
const networkError = { message: 'TypeError: Failed to fetch', code: null }

function fakeSupabase(opts: { selectError?: unknown; rows?: unknown[] } = {}) {
  const writes: string[] = []
  const client = {
    from: () => ({
      select: async () => ({ data: opts.rows ?? [], error: opts.selectError ?? null }),
      update: () => {
        writes.push('update')
        return { eq: async () => ({ error: null }) }
      },
      insert: async () => {
        writes.push('insert')
        return { error: null }
      },
    }),
  } as unknown as SupabaseClient
  return { client, writes }
}

beforeEach(() => {
  localStorage.clear()
  resetStoreCategoriesForTest()
})

describe('テーブルが無いと分かったあと', () => {
  it('学習は端末内で続く(キャッシュを捨てない)', async () => {
    const { client, writes } = fakeSupabase({ selectError: schemaError })
    await initStoreCategories(client)

    await rememberStoreCategory(client, 'セブンイレブン', 'food')
    // 端末内には残る = 次の入力から自動選択が効く
    expect(getStoreCategories().find((e) => e.storeKey === 'セブンイレブン')?.category).toBe('food')
    // 通らないと分かっているサーバーへは行かない
    expect(writes).toEqual([])
  })

  it('答えを localStorage に残すので、オフライン起動でも書きに行かない', async () => {
    const { client } = fakeSupabase({ selectError: schemaError })
    await initStoreCategories(client)
    expect(localStorage.getItem(MISSING_KEY)).toBe('1')
  })

  it('マイグレーションを実行して読めるようになれば、サーバーへの記憶が再開する', async () => {
    const missing = fakeSupabase({ selectError: schemaError })
    await initStoreCategories(missing.client)

    const ok = fakeSupabase({ rows: [] })
    await initStoreCategories(ok.client)
    await rememberStoreCategory(ok.client, 'まいばすけっと', 'food')
    expect(ok.writes).toEqual(['insert'])
    expect(localStorage.getItem(MISSING_KEY)).toBe('0')
  })
})

describe('通信できないだけのとき', () => {
  it('テーブルが無いとは見なさない(サーバーへの記憶を諦めない)', async () => {
    const { client, writes } = fakeSupabase({ selectError: networkError })
    await initStoreCategories(client)
    await rememberStoreCategory(client, 'ローソン', 'food')
    expect(writes).toEqual(['insert'])
    expect(localStorage.getItem(MISSING_KEY)).toBe(null)
  })
})
