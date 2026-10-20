// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchComments } from './partnerComments'

// ============================================================
// partner_share_comments を読めないときの振る舞い。
//
// 共有リンクと同じく、テーブルが無くても通信できなくても null を返して黙る。
// 呼び出し側(PartnerTab)はコメントの導線ごと出さないだけで、
// 彼女タブの残高や履歴はそのまま出る。
// ============================================================

const schemaError = {
  message: 'relation "public.partner_share_comments" does not exist',
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

describe('fetchComments', () => {
  it('テーブルが無ければ null', async () => {
    expect(await fetchComments(fakeSupabase({ selectError: schemaError }))).toBe(null)
  })

  it('通信できないときも null', async () => {
    expect(await fetchComments(fakeSupabase({ selectError: networkError }))).toBe(null)
  })

  it('読めれば一覧を返す(テーブルが無かった次の回でも戻る)', async () => {
    await fetchComments(fakeSupabase({ selectError: schemaError }))
    expect(await fetchComments(fakeSupabase())).toEqual([])
  })
})
