// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchComments,
  isCommentsUnavailable,
  resetPartnerCommentsForTest,
} from './partnerComments'

// ============================================================
// partner_share_comments が無い(migration-partner-share.sql 未実行)ときの振る舞い。
//
// 共有リンクと同じく、テーブルが無くても通信できなくても null を返して黙る。
// 呼び出し側(PartnerTab)はコメントの導線ごと出さないだけで、
// 彼女タブの残高や履歴はそのまま出る。
// ============================================================

const MISSING_KEY = 'kakeibo.tableMissing.partner_share_comments'

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

beforeEach(() => {
  localStorage.clear()
  resetPartnerCommentsForTest()
})

describe('テーブルが無いと分かったあと', () => {
  it('null を返し、以後この機能は無効と分かる', async () => {
    expect(await fetchComments(fakeSupabase({ selectError: schemaError }))).toBe(null)
    expect(isCommentsUnavailable()).toBe(true)
    expect(localStorage.getItem(MISSING_KEY)).toBe('1')
  })

  it('読めるようになれば戻る', async () => {
    await fetchComments(fakeSupabase({ selectError: schemaError }))
    expect(await fetchComments(fakeSupabase())).toEqual([])
    expect(isCommentsUnavailable()).toBe(false)
    expect(localStorage.getItem(MISSING_KEY)).toBe('0')
  })
})

describe('通信できないだけのとき', () => {
  it('null は返すが、テーブルが無いとは見なさない', async () => {
    expect(await fetchComments(fakeSupabase({ selectError: networkError }))).toBe(null)
    expect(isCommentsUnavailable()).toBe(false)
    expect(localStorage.getItem(MISSING_KEY)).toBe(null)
  })
})
