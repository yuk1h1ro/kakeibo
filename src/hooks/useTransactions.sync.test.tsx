// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useTransactions, type TransactionInput } from './useTransactions'
import { saveQueue, type PendingOp } from '../lib/offlineQueue'
import { discardQuarantineEntry, loadQuarantine } from '../lib/quarantine'
import { resetDiscordWebhookForTest } from '../lib/discordWebhook'
import type { Transaction } from '../lib/types'

// ============================================================
// 圏外から復帰したときの同期。ここには実際に起きた不具合が2件ぶら下がっている。
//
//  1. サーバーが行を確定させた直後に接続が切れ、**応答だけ** が失われた場合。
//     端末は「届いていない」と見て同じ行IDで送り直す → 主キー重複 (23505)。
//     これを拒否として扱うと、分割は会計まるごと隔離されたうえ、隔離箱から
//     送り直しても同じ行IDでまた 23505 になり、永久に復旧できなかった。
//     行IDは端末が採番しているので、これは「すでに終わっている」= 成功。
//
//  2. flush が途中で切れると、次の flush が「成功済みの op を含まない
//     古いスナップショット」から残高を計算し直し、彼女の Discord に
//     古い残高が届いていた(画面は正しいので気付きにくい)。
//
// どちらも lib の純粋関数だけでは再現できない —— **flush の道筋** の問題なので、
// フックを実際に回して、サーバーに入った行と彼女に届いた文面で確かめる。
// ============================================================

interface FakeServer {
  /** サーバーに実際に入っている行 */
  rows: Transaction[]
  /** 届いた書き込みの記録(何度送られたかを数えるため) */
  inserts: string[]
  deletes: string[]
  /** この行IDへの書き込みは「届く前に切れる」= 通信エラー */
  unreachable: Set<string>
}

function newServer(rows: Transaction[] = []): FakeServer {
  return { rows: [...rows], inserts: [], deletes: [], unreachable: new Set() }
}

/**
 * PostgREST(Supabase)の最小の模擬。
 * 主キー重複の応答は実測したものをそのまま返す:
 *   code "23505" / message …transactions_pkey / details "Key (id)=(…) already exists."
 */
function fakeSupabase(server: FakeServer): SupabaseClient {
  const netError = { message: 'TypeError: Failed to fetch', code: null, details: null, hint: null }
  const client = {
    from(table: string) {
      return {
        select: () => ({
          // 起動時の列の有無の確認 (txExtensions) / 変更履歴テーブルの確認
          limit: () => Promise.resolve({ data: [], error: null }),
          order: () => ({
            order: () =>
              Promise.resolve(
                table === 'transactions'
                  ? { data: [...server.rows], error: null }
                  : { data: [], error: null }
              ),
          }),
        }),
        insert: (row: Transaction) => {
          if (table !== 'transactions') return Promise.resolve({ data: [], error: null })
          server.inserts.push(row.id)
          if (server.unreachable.has(row.id)) return Promise.resolve({ error: netError })
          if (server.rows.some((r) => r.id === row.id)) {
            return Promise.resolve({
              error: {
                code: '23505',
                message: 'duplicate key value violates unique constraint "transactions_pkey"',
                details: `Key (id)=(${row.id}) already exists.`,
                hint: null,
              },
            })
          }
          server.rows.push({ ...row, created_at: row.created_at ?? '2026-09-02T10:00:02.000Z' })
          return Promise.resolve({ error: null })
        },
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        delete: () => ({
          eq: (_col: string, id: string) => {
            server.deletes.push(id)
            server.rows = server.rows.filter((r) => r.id !== id)
            return Promise.resolve({ error: null })
          },
        }),
      }
    },
  }
  return client as unknown as SupabaseClient
}

function expense(over: Partial<TransactionInput> = {}): TransactionInput {
  return {
    date: '2026-09-02',
    type: 'expense',
    amount: 1500,
    category: 'food',
    memo: '',
    store: '応答喪失スーパー',
    partner_amount: 700,
    partner_paid: 0,
    ...over,
  }
}

function insertOp(id: string, payload: TransactionInput): PendingOp {
  return { opId: `op-${id}`, kind: 'insert', id, payload, queuedAt: '2026-09-02T10:00:00.000Z' }
}

const GROUP = 'g-0001'
const SPLIT: PendingOp[] = [
  insertOp('r1', expense({ amount: 1500, partner_amount: 700, split_group: GROUP })),
  insertOp(
    'r2',
    expense({ amount: 1000, partner_amount: 500, category: 'daily', split_group: GROUP })
  ),
  insertOp(
    'r3',
    expense({ amount: 500, partner_amount: 250, category: 'transport', split_group: GROUP })
  ),
]

const DEPOSIT: Transaction = {
  id: 'deposit',
  date: '2026-09-01',
  type: 'partner_deposit',
  amount: 50000,
  category: null,
  memo: '事前の預かり',
  store: '',
  partner_amount: 0,
  partner_paid: 0,
  created_at: '2026-09-01T00:00:00.000Z',
}

/** 彼女の Discord に届いた文面 */
let sent: string[] = []

beforeEach(() => {
  localStorage.clear()
  // 隔離箱はモジュール内にキャッシュを持つので、localStorage と両方を空にする
  for (const e of loadQuarantine()) discardQuarantineEntry(e.id)
  sent = []
  localStorage.setItem('kakeibo.lowBalanceThreshold', '0') // 残高低下アラートを混ぜない
  localStorage.setItem(
    'kakeibo.discordWebhook',
    'https://discord.com/api/webhooks/000000000000000000/test'
  )
  resetDiscordWebhookForTest()
  vi.stubGlobal('fetch', (_url: string, init?: { body?: string }) => {
    sent.push(String(JSON.parse(init?.body ?? '{}').content ?? ''))
    return Promise.resolve({ ok: true, status: 204 } as Response)
  })
})

afterEach(() => {
  // 前のテストのフックを残すと、その 'online' 監視や効果が次のキューを掴んでしまう
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('応答だけ失われた再送 (23505)', () => {
  it('すでにサーバーに入っている行の送り直しは成功として扱い、分割を隔離しない', async () => {
    // 1件目は前回の送信で確定済み(応答だけが返らなかった)。端末はキューを保持している
    const server = newServer([{ id: 'r1', created_at: '2026-09-02T10:00:01.000Z', ...SPLIT[0].payload! }])
    saveQueue(SPLIT)

    // クライアントは App と同じく1つを使い回す(毎描画で作り直さない)
    const supabase = fakeSupabase(server)
    const { result } = renderHook(() => useTransactions(supabase))
    await waitFor(() => expect(result.current.pendingCount).toBe(0))

    // 3,000円の会計が3行そろってサーバーに残る
    expect(server.rows.map((r) => r.amount).sort((a, b) => a - b)).toEqual([500, 1000, 1500])
    // 隔離箱は空。すでに入っていた片割れを取り消してもいない
    expect(loadQuarantine()).toEqual([])
    expect(server.deletes).toEqual([])
    expect(result.current.errorGuide).toBeNull()
  })

  it('別の行の一意制約違反(トークン重複など)は今までどおり拒否として扱う', async () => {
    const server = newServer()
    const supabase = fakeSupabase(server)
    // 送ろうとしている行とは無関係な列で重複した場合
    const rejecting = {
      from: () => ({
        ...(supabase.from('transactions') as unknown as Record<string, unknown>),
        insert: () =>
          Promise.resolve({
            error: {
              code: '23505',
              message: 'duplicate key value violates unique constraint "partner_share_links_token_key"',
              details: 'Key (token)=(abc123) already exists.',
              hint: null,
            },
          }),
      }),
    } as unknown as SupabaseClient
    saveQueue([SPLIT[0]])

    const { result } = renderHook(() => useTransactions(rejecting))
    await waitFor(() => expect(loadQuarantine().length).toBe(1))
    expect(result.current.pendingCount).toBe(0)
    expect(server.rows).toEqual([])
  })
})

describe('送信が中断されたあとの残高通知', () => {
  it('成功した op を反映したスナップショットを次の flush にも引き継ぐ', async () => {
    const server = newServer([DEPOSIT])
    server.unreachable.add('r2') // 2件目は届かない = ここで flush が切れる
    saveQueue(SPLIT)

    const supabase = fakeSupabase(server)
    const { result } = renderHook(() => useTransactions(supabase))
    // 1件目だけが通り、キューには2件残る
    await waitFor(() => expect(result.current.pendingCount).toBe(2))
    expect(sent).toEqual(['🍽️ 応答喪失スーパー −¥700\n残高: ¥49,300(預かり中)'])

    // 圏外を抜けて残りを送る
    server.unreachable.clear()
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(result.current.pendingCount).toBe(0))

    // 50,000 − 700 − 500 − 250。中断をまたいでも彼女に届く残高は続きから
    expect(sent).toEqual([
      '🍽️ 応答喪失スーパー −¥700\n残高: ¥49,300(預かり中)',
      '🍽️ 応答喪失スーパー −¥500\n残高: ¥48,800(預かり中)',
      '🍽️ 応答喪失スーパー −¥250\n残高: ¥48,550(預かり中)',
    ])
  })
})
