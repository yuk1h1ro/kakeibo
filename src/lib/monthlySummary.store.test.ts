// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchSentMonths,
  isMonthlySummaryUnavailable,
  resetMonthlySummaryForTest,
  sendDueMonthlySummaries,
} from './monthlySummary'

// ============================================================
// partner_summary_sends が無い(migration-partner-summary.sql 未実行)ときの振る舞い。
//
// 検知したあとは月末サマリーを送らないだけ(記録・同期には触らない)。
//
// **この判定だけは localStorage に残さない。**
// このテーブルを確かめる経路は fetchSentMonths しか無く、その fetchSentMonths 自体が
// sendDueMonthlySummaries の「無いなら送らない」で飛ばされる。覚えてしまうと、
// マイグレーションを実行しても二度と送られなくなる。
// ============================================================

const MISSING_KEY = 'kakeibo.tableMissing.partner_summary_sends'

const schemaError = {
  message: 'relation "public.partner_summary_sends" does not exist',
  code: '42P01',
}
const networkError = { message: 'TypeError: Failed to fetch', code: null }

function fakeSupabase(opts: { selectError?: unknown; months?: string[] } = {}) {
  return {
    from: () => ({
      select: async () => ({
        data: (opts.months ?? []).map((month) => ({ month })),
        error: opts.selectError ?? null,
      }),
    }),
  } as unknown as SupabaseClient
}

beforeEach(() => {
  localStorage.clear()
  resetMonthlySummaryForTest()
})

describe('テーブルが無いと分かったあと', () => {
  it('null を返し、以後この起動では送らない', async () => {
    expect(await fetchSentMonths(fakeSupabase({ selectError: schemaError }))).toBe(null)
    expect(isMonthlySummaryUnavailable()).toBe(true)
    expect(
      await sendDueMonthlySummaries(fakeSupabase({ selectError: schemaError }), [], '2026-03-01', () => '食費')
    ).toBe(0)
  })

  it('答えは localStorage に残さない(次の起動でまた確かめ直す)', async () => {
    await fetchSentMonths(fakeSupabase({ selectError: schemaError }))
    expect(localStorage.getItem(MISSING_KEY)).toBe(null)
  })

  it('読めるようになれば戻る', async () => {
    await fetchSentMonths(fakeSupabase({ selectError: schemaError }))
    expect(await fetchSentMonths(fakeSupabase({ months: ['2026-01'] }))).toEqual(['2026-01'])
    expect(isMonthlySummaryUnavailable()).toBe(false)
  })
})

describe('通信できないだけのとき', () => {
  it('テーブルが無いとは見なさない(次に開いたときに送れる)', async () => {
    expect(await fetchSentMonths(fakeSupabase({ selectError: networkError }))).toBe(null)
    expect(isMonthlySummaryUnavailable()).toBe(false)
  })
})
