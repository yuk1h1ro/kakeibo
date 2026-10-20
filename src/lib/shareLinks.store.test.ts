// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchShareLinks } from './shareLinks'

// ============================================================
// partner_share_links を読めないときの振る舞い。
//
// テーブルが無い(migration-partner-share.sql 未実行)ときも、通信できないときも
// **どちらも null** を返して黙る — 呼び出し側(ShareLinkCard)はカードごと出さない。
// どちらでもカードを出さない点では同じなので、見分けて扱いを変える必要が無い。
// ============================================================

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

describe('fetchShareLinks', () => {
  it('テーブルが無ければ null', async () => {
    expect(await fetchShareLinks(fakeSupabase({ selectError: schemaError }))).toBe(null)
  })

  it('通信できないときも null', async () => {
    expect(await fetchShareLinks(fakeSupabase({ selectError: networkError }))).toBe(null)
  })

  it('読めれば一覧を返す(テーブルが無かった次の回でも戻る)', async () => {
    await fetchShareLinks(fakeSupabase({ selectError: schemaError }))
    expect(await fetchShareLinks(fakeSupabase())).toEqual([])
  })
})
