// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchChangeLog,
  initChangeLog,
  newEntry,
  recordChange,
  resetChangeLogForTest,
} from './changeLog'

// ============================================================
// transaction_changes が無い(migration-change-log.sql 未実行)ときの振る舞い。
//
// 検知したあとにやることは、この機能だけの判断:
//   ・端末に貯めた履歴を捨てる(送り先が無いものを貯め続けても意味がない)
//   ・以後 recordChange は素通りする
// **だからこそ、この判定だけは localStorage に残さない。**
// 覚えたまま次の起動を迎えると、initChangeLog が確かめ直すより前に起きた変更を
// 黙って落としてしまう(記録そのものではないとはいえ、落とす理由が無い)。
// ============================================================

const MISSING_KEY = 'kakeibo.tableMissing.transaction_changes'
const BUFFER_KEY = 'kakeibo.changeLogBuffer'

const schemaError = {
  message: 'relation "public.transaction_changes" does not exist',
  code: '42P01',
}
const networkError = { message: 'TypeError: Failed to fetch', code: null }

function fakeSupabase(opts: { selectError?: unknown; insertError?: unknown } = {}) {
  const inserted: unknown[][] = []
  const client = {
    from: () => ({
      select: () => ({
        limit: async () => ({ data: [], error: opts.selectError ?? null }),
        order: () => ({
          limit: async () => ({ data: [], error: opts.selectError ?? null }),
        }),
      }),
      insert: async (rows: unknown[]) => {
        inserted.push(rows)
        return { error: opts.insertError ?? null }
      },
      delete: () => ({ lt: async () => ({ error: null }) }),
    }),
  } as unknown as SupabaseClient
  return { client, inserted }
}

const entry = () => newEntry('11111111-1111-1111-1111-111111111111', 'update', '金額 ¥100 → ¥200', [
  { label: '金額', from: '¥100', to: '¥200' },
])

beforeEach(() => {
  localStorage.clear()
  resetChangeLogForTest()
})

describe('テーブルが無いと分かったあと', () => {
  it('貯めた履歴を捨て、以後は記録しない', async () => {
    const before = fakeSupabase({ insertError: networkError })
    await initChangeLog(before.client)
    recordChange(entry())
    expect(localStorage.getItem(BUFFER_KEY)).not.toBe('[]') // 送れなくても端末には残る

    const missing = fakeSupabase({ selectError: schemaError })
    await initChangeLog(missing.client)
    expect(localStorage.getItem(BUFFER_KEY)).toBe('[]')

    recordChange(entry())
    expect(localStorage.getItem(BUFFER_KEY)).toBe('[]')
  })

  it('答えは localStorage に残さない(次の起動でまた確かめ直す)', async () => {
    const { client } = fakeSupabase({ selectError: schemaError })
    await initChangeLog(client)
    expect(localStorage.getItem(MISSING_KEY)).toBe(null)
  })

  it('読めるようになれば戻る', async () => {
    await initChangeLog(fakeSupabase({ selectError: schemaError }).client)
    const ok = fakeSupabase()
    await initChangeLog(ok.client)
    recordChange(entry()) // 送信は投げっぱなしなので、片付くまで1周待つ
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(localStorage.getItem(BUFFER_KEY)).toBe('[]') // 送れたので手元には残らない
    expect(ok.inserted).toHaveLength(1)
  })
})

describe('通信できないだけのとき', () => {
  it('テーブルが無いとは見なさず、履歴も捨てない(オフラインでも消えない)', async () => {
    const { client } = fakeSupabase({ selectError: networkError })
    await initChangeLog(client)
    recordChange(entry())
    const buffered = JSON.parse(localStorage.getItem(BUFFER_KEY) ?? '[]') as unknown[]
    expect(buffered).toHaveLength(1)
    // 表示は端末に貯まっている分で続く
    expect(await fetchChangeLog()).toHaveLength(1)
  })
})
