// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchShareLinks, isShareUnavailable, resetShareLinksForTest } from './shareLinks'

// ============================================================
// partner_share_links が無い(migration-partner-share.sql 未実行)ときの振る舞い。
//
// 検知したあとにやることは「黙って null を返す」だけ — 呼び出し側(ShareLinkCard)は
// カードごと出さない。テーブルが無いのと通信できないのを **どちらも null** で
// 返すのは元からの判断で、カードを出さない点では同じだから。
// 変えていないのは見分け方だけ(tableAvailability.ts)。
// ============================================================

const MISSING_KEY = 'kakeibo.tableMissing.partner_share_links'

const schemaError = {
  message: 'relation "public.partner_share_links" does not exist',
  code: '42P01',
}
const networkError = { message: 'TypeError: Failed to fetch', code: null }

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
  resetShareLinksForTest()
})

describe('テーブルが無いと分かったあと', () => {
  it('null を返し、以後この機能は無効と分かる', async () => {
    expect(await fetchShareLinks(fakeSupabase({ selectError: schemaError }))).toBe(null)
    expect(isShareUnavailable()).toBe(true)
  })

  it('答えを localStorage に残す(オフライン起動でも前回の答えが効く)', async () => {
    await fetchShareLinks(fakeSupabase({ selectError: schemaError }))
    expect(localStorage.getItem(MISSING_KEY)).toBe('1')
  })

  it('読めるようになれば戻る', async () => {
    await fetchShareLinks(fakeSupabase({ selectError: schemaError }))
    expect(await fetchShareLinks(fakeSupabase())).toEqual([])
    expect(isShareUnavailable()).toBe(false)
    expect(localStorage.getItem(MISSING_KEY)).toBe('0')
  })
})

describe('通信できないだけのとき', () => {
  it('カードは出さない(null)が、テーブルが無いとは見なさない', async () => {
    expect(await fetchShareLinks(fakeSupabase({ selectError: networkError }))).toBe(null)
    expect(isShareUnavailable()).toBe(false)
    expect(localStorage.getItem(MISSING_KEY)).toBe(null)
  })
})
