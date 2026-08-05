// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  EMPTY_BACKLOG_STATE,
  fetchBacklogState,
  isBacklogSyncUnavailable,
  loadCachedBacklogState,
  mergeBacklogState,
  parseBacklogState,
  resetBacklogSendsForTest,
  rowToBacklogState,
  runBacklogSend,
  saveBacklogState,
  type BacklogSendState,
} from './partnerBacklogSends'
import { BACKLOG_RETRY_DELAY_MS, BACKLOG_SEND_INTERVAL_MS, type BacklogMessage } from './partnerBacklog'
import type { DiscordSendResult } from './discordNotify'

// ============================================================
// まとめ送信の実行と、「どこまで送ったか」の記録
//
// ここで守るのは2つだけ:
//   ・**送れた通のぶんだけ**カーソルが進むこと(3通目で失敗したら2通目まで)
//   ・カーソルが**絶対に戻らない**こと(戻ると彼女に同じ履歴が二度届く)
// 送信そのものと待ち時間は差し替えて、実時間を1ミリ秒も使わずに確かめる。
// ============================================================

function entry(id: string) {
  return {
    id,
    date: '2026-05-20',
    createdAt: `2026-05-20T0${id}:00:00.000Z`,
    title: id,
    impact: -100,
    balance: 0,
    paid: 0,
    share: 100,
  }
}

/** n 通ぶんの送信予定(1通につき明細1件が進む) */
function messages(n: number): BacklogMessage[] {
  return Array.from({ length: n }, (_, i) => ({
    text: `本文${i + 1}`,
    lastEntry: entry(String(i + 1)),
    entriesThrough: i + 1,
  }))
}

/** upsert された中身を覚える supabase もどき */
function fakeSupabase(row: unknown = null, error: unknown = null) {
  const upserts: Record<string, unknown>[] = []
  const client = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: () => ({
      select: () => ({ maybeSingle: async () => ({ data: row, error }) }),
      upsert: async (payload: Record<string, unknown>) => {
        upserts.push(payload)
        return { error: null }
      },
    }),
  } as unknown as SupabaseClient
  return { client, upserts }
}

const ok = async (): Promise<DiscordSendResult> => ({ ok: true })

beforeEach(() => {
  localStorage.clear()
  resetBacklogSendsForTest()
})

describe('逐次送信', () => {
  it('1通ずつ順番に送り、あいだに間隔を空ける(まとめて投げると 429 で落ちる)', async () => {
    const { client } = fakeSupabase()
    const sent: string[] = []
    const slept: number[] = []
    const result = await runBacklogSend(client, messages(3), EMPTY_BACKLOG_STATE, {
      send: async (text) => {
        sent.push(text)
        return { ok: true }
      },
      sleep: async (ms) => {
        slept.push(ms)
      },
    })

    expect(sent).toEqual(['本文1', '本文2', '本文3'])
    // 1通目の前には待たない(押してすぐ動き出す)
    expect(slept).toEqual([BACKLOG_SEND_INTERVAL_MS, BACKLOG_SEND_INTERVAL_MS])
    expect(result.sentMessages).toBe(3)
    expect(result.failure).toBeNull()
  })

  it('送るたびに進み具合を知らせる(無言で数十秒待たせない)', async () => {
    const { client } = fakeSupabase()
    const progress: string[] = []
    await runBacklogSend(client, messages(3), EMPTY_BACKLOG_STATE, {
      send: ok,
      sleep: async () => {},
      onProgress: (s, t) => progress.push(`${s}/${t}`),
    })
    expect(progress).toEqual(['1/3', '2/3', '3/3'])
  })

  it('最後まで送るとカーソルは最後の明細に進む', async () => {
    const { client } = fakeSupabase()
    const result = await runBacklogSend(client, messages(3), EMPTY_BACKLOG_STATE, {
      send: ok,
      sleep: async () => {},
    })
    expect(result.state.cursor?.id).toBe('3')
    expect(result.state.sentEntries).toBe(3)
    expect(result.state.sentMessages).toBe(3)
  })
})

describe('途中で失敗したとき', () => {
  const failAt = (n: number) => {
    let count = 0
    return async (): Promise<DiscordSendResult> => {
      count += 1
      return count === n ? { ok: false, failure: { kind: 'webhook', status: 404 } } : { ok: true }
    }
  }

  it('3通目で失敗したら、2通目までを送信済みとして残す', async () => {
    const { client } = fakeSupabase()
    const result = await runBacklogSend(client, messages(10), EMPTY_BACKLOG_STATE, {
      send: failAt(3),
      sleep: async () => {},
    })
    expect(result.sentMessages).toBe(2)
    expect(result.sentEntries).toBe(2)
    expect(result.failure).toEqual({ kind: 'webhook', status: 404 })
    // カーソルは2通目までしか進まない = 残りは「前回の続き」でそのまま送れる
    expect(result.state.cursor?.id).toBe('2')
  })

  it('失敗した時点で止める(飛び飛びに届いて履歴が虫食いになるのを防ぐ)', async () => {
    const { client } = fakeSupabase()
    const sent: string[] = []
    const send = failAt(3)
    await runBacklogSend(client, messages(10), EMPTY_BACKLOG_STATE, {
      send: async (text) => {
        const r = await send()
        if (r.ok) sent.push(text)
        return r
      },
      sleep: async () => {},
    })
    expect(sent).toEqual(['本文1', '本文2'])
  })

  it('送れた通のぶんは、その場でサーバーにも残す(画面を閉じても続きから)', async () => {
    const { client, upserts } = fakeSupabase()
    await runBacklogSend(client, messages(10), EMPTY_BACKLOG_STATE, {
      send: failAt(3),
      sleep: async () => {},
    })
    expect(upserts).toHaveLength(2)
    expect(upserts[1]).toMatchObject({ last_tx_id: '2', sent_messages: 2, sent_entries: 2 })
    // 端末の控えにも同じところまで入っている
    expect(loadCachedBacklogState().cursor?.id).toBe('2')
  })

  it('1通目で失敗したら、まだ何も送っていない状態のまま', async () => {
    const { client, upserts } = fakeSupabase()
    const result = await runBacklogSend(client, messages(5), EMPTY_BACKLOG_STATE, {
      send: failAt(1),
      sleep: async () => {},
    })
    expect(result.sentMessages).toBe(0)
    expect(result.state.cursor).toBeNull()
    expect(upserts).toHaveLength(0)
  })
})

describe('レート制限(429)への当たり方', () => {
  it('429 は少し待って1回だけ送り直す', async () => {
    const { client } = fakeSupabase()
    const slept: number[] = []
    let first = true
    const result = await runBacklogSend(client, messages(1), EMPTY_BACKLOG_STATE, {
      send: async () => {
        if (first) {
          first = false
          return { ok: false, failure: { kind: 'http', status: 429 } }
        }
        return { ok: true }
      },
      sleep: async (ms) => {
        slept.push(ms)
      },
    })
    expect(slept).toEqual([BACKLOG_RETRY_DELAY_MS])
    expect(result.sentMessages).toBe(1)
    expect(result.failure).toBeNull()
  })

  it('待ち直しても駄目なら、そこで止めて理由を返す', async () => {
    const { client } = fakeSupabase()
    const result = await runBacklogSend(client, messages(3), EMPTY_BACKLOG_STATE, {
      send: async () => ({ ok: false, failure: { kind: 'http', status: 500 } }),
      sleep: async () => {},
    })
    expect(result.sentMessages).toBe(0)
    expect(result.failure).toEqual({ kind: 'http', status: 500 })
  })
})

describe('カーソルは戻さない', () => {
  it('古い期間を選んで送り直しても、進んだカーソルは巻き戻らない', async () => {
    // 「2025年12月をもう一度送る」= 送信済みの分。ここでカーソルが戻ると、
    // 次の「前回の続き」で 2026年ぶんがまるごと再送されてしまう
    const { client } = fakeSupabase()
    const ahead: BacklogSendState = {
      cursor: { date: '2026-05-20', createdAt: '2026-05-20T09:00:00.000Z', id: 'z' },
      lastSentAt: '2026-05-21T00:00:00.000Z',
      sentEntries: 10,
      sentMessages: 2,
    }
    const old: BacklogMessage[] = [
      {
        text: '古い月ぶん',
        lastEntry: { ...entry('a'), date: '2025-12-01', createdAt: '2025-12-01T01:00:00.000Z' },
        entriesThrough: 1,
      },
    ]
    const result = await runBacklogSend(client, old, ahead, { send: ok, sleep: async () => {} })
    expect(result.state.cursor?.id).toBe('z')
    // 送ったこと自体(累計)は増える
    expect(result.state.sentMessages).toBe(3)
  })

  it('サーバーと端末が食い違ったら、進んでいる方を採る', () => {
    const older: BacklogSendState = {
      cursor: { date: '2026-01-01', createdAt: 'a', id: 'a' },
      lastSentAt: '2026-01-01T00:00:00.000Z',
      sentEntries: 1,
      sentMessages: 1,
    }
    const newer: BacklogSendState = {
      cursor: { date: '2026-05-01', createdAt: 'b', id: 'b' },
      lastSentAt: '2026-05-01T00:00:00.000Z',
      sentEntries: 9,
      sentMessages: 3,
    }
    expect(mergeBacklogState(older, newer).cursor?.id).toBe('b')
    expect(mergeBacklogState(newer, older).cursor?.id).toBe('b')
    expect(mergeBacklogState(newer, older).sentEntries).toBe(9)
    expect(mergeBacklogState(null, older)).toEqual(older)
  })
})

describe('記録の読み書き', () => {
  it('サーバーの行を状態に読み替える', () => {
    expect(
      rowToBacklogState({
        last_date: '2026-05-20',
        last_created_at: 'ts',
        last_tx_id: 'x',
        sent_entries: 42,
        sent_messages: 3,
        last_sent_at: '2026-05-21T00:00:00.000Z',
      })
    ).toEqual({
      cursor: { date: '2026-05-20', createdAt: 'ts', id: 'x' },
      lastSentAt: '2026-05-21T00:00:00.000Z',
      sentEntries: 42,
      sentMessages: 3,
    })
    expect(rowToBacklogState(null)).toBeNull()
  })

  it('壊れた控えは「まだ送っていない」に倒す(送り直しの方が安全)', () => {
    expect(parseBacklogState('{')).toEqual(EMPTY_BACKLOG_STATE)
    expect(parseBacklogState({ cursor: { date: 1 } })).toEqual(EMPTY_BACKLOG_STATE)
    localStorage.setItem('kakeibo.partnerBacklogCursor', 'これはJSONではない')
    expect(loadCachedBacklogState()).toEqual(EMPTY_BACKLOG_STATE)
  })

  it('サーバーから読んだら端末にも控える(次はオフラインでも続きが分かる)', async () => {
    const { client } = fakeSupabase({
      last_date: '2026-05-20',
      last_created_at: 'ts',
      last_tx_id: 'x',
      sent_entries: 42,
      sent_messages: 3,
      last_sent_at: null,
    })
    const state = await fetchBacklogState(client)
    expect(state.cursor?.id).toBe('x')
    expect(loadCachedBacklogState().cursor?.id).toBe('x')
  })
})

describe('マイグレーション未実行の環境', () => {
  const schemaError = { message: 'relation "partner_backlog_sends" does not exist', code: '42P01' }

  it('テーブルが無くても壊れず、端末の控えだけで動く', async () => {
    const { client, upserts } = fakeSupabase(null, schemaError)
    expect(await fetchBacklogState(client)).toEqual(EMPTY_BACKLOG_STATE)
    expect(isBacklogSyncUnavailable()).toBe(true)

    // 送信そのものは止まらない。カーソルは端末の中だけに残る
    const result = await runBacklogSend(client, messages(2), EMPTY_BACKLOG_STATE, {
      send: ok,
      sleep: async () => {},
    })
    expect(result.sentMessages).toBe(2)
    expect(upserts).toHaveLength(0)
    expect(loadCachedBacklogState().cursor?.id).toBe('2')
  })

  it('サーバーへの書き込みに失敗しても、送信の結果は返す', async () => {
    const { client } = fakeSupabase(null, schemaError)
    await saveBacklogState(client, {
      cursor: { date: '2026-05-20', createdAt: 'ts', id: 'x' },
      lastSentAt: null,
      sentEntries: 1,
      sentMessages: 1,
    })
    expect(loadCachedBacklogState().cursor?.id).toBe('x')
  })
})
