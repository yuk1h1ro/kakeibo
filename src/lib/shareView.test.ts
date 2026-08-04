import { describe, expect, it } from 'vitest'
import { parseShareSnapshot } from './shareView'

// ============================================================
// 共有ページ(彼女が見る画面)が受け取る内容の整形。
//
// ここでいちばん確かめたいのは **古いサーバーでも壊れないこと**。
// migration-partner-ledger.sql を実行していない環境では、RPC が
// settlements も paid も返さない。そのときに画面が落ちたり、
// 「あなたが払いました」が誤って出たりしてはいけない。
// ============================================================

const OLD_SERVER = {
  ok: true,
  balance: 26500,
  deposits: [{ id: 'd1', date: '2026-08-01', amount: 30000 }],
  charges: [
    {
      id: 'c1',
      date: '2026-08-02',
      store: '居酒屋',
      amount: 1500,
      category: 'eating_out',
      category_label: '外食',
    },
  ],
  comments: [],
  expires_at: null,
  max_comment_length: 300,
}

describe('parseShareSnapshot', () => {
  it('リンクが無効なときは null(理由は区別しない)', () => {
    expect(parseShareSnapshot({ ok: false })).toBeNull()
    expect(parseShareSnapshot(null)).toBeNull()
    expect(parseShareSnapshot('なにか')).toBeNull()
  })

  it('マイグレーション未実行のサーバーの返り値でも壊れない', () => {
    const s = parseShareSnapshot(OLD_SERVER)
    expect(s).not.toBeNull()
    expect(s?.balance).toBe(26500)
    expect(s?.deposits).toHaveLength(1)
    expect(s?.charges).toHaveLength(1)
    // 新しいキーは無いので、空 / 0 に落ちる = 画面に節ごと出ない
    expect(s?.settlements).toEqual([])
    expect(s?.charges[0].paid).toBe(0)
  })

  it('返金・調整を受け取れる (機能012)', () => {
    const s = parseShareSnapshot({
      ...OLD_SERVER,
      settlements: [
        { id: 's1', date: '2026-08-03', kind: 'partner_refund', amount: -5000, memo: '余り' },
        { id: 's2', date: '2026-08-04', kind: 'partner_adjust', amount: 300, memo: '計算違い' },
      ],
    })
    expect(s?.settlements).toEqual([
      { id: 's1', date: '2026-08-03', kind: 'partner_refund', amount: -5000, memo: '余り' },
      { id: 's2', date: '2026-08-04', kind: 'partner_adjust', amount: 300, memo: '計算違い' },
    ])
  })

  it('知らない kind は返金として読む(未知の値で画面を壊さない)', () => {
    const s = parseShareSnapshot({
      ...OLD_SERVER,
      settlements: [{ id: 's1', date: '2026-08-03', kind: 'なにか', amount: -1, memo: '' }],
    })
    expect(s?.settlements[0].kind).toBe('partner_refund')
  })

  it('彼女が払った額を受け取れる (機能018)', () => {
    const s = parseShareSnapshot({
      ...OLD_SERVER,
      charges: [{ ...OLD_SERVER.charges[0], amount: 1000, paid: 3000 }],
    })
    expect(s?.charges[0].paid).toBe(3000)
    expect(s?.charges[0].amount).toBe(1000)
  })

  it('支払い総額は受け取らない(そもそも返り値に無い)', () => {
    // 共有ページの型に「支払い総額」の置き場所が無いことを、ここで固定しておく
    const s = parseShareSnapshot({
      ...OLD_SERVER,
      charges: [{ ...OLD_SERVER.charges[0], total: 9999 }],
    })
    expect(JSON.stringify(s?.charges[0])).not.toContain('9999')
  })
})
