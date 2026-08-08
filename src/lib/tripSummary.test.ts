import { describe, expect, it } from 'vitest'
import type { Transaction } from './types'
import {
  buildTripMessages,
  buildTripSummary,
  tripCurrentBalance,
  tripEntryLine,
  tripHeadline,
} from './tripSummary'
import { DISCORD_MESSAGE_LIMIT } from './partnerBacklog'

// ============================================================
// 旅行1回ぶんのまとめ(Discord に送る中身)。
//
// ここで守っているのは4つ:
//   ・**彼女に関係する分だけ**。共有ページ・既存の通知・履歴のまとめ送信と
//     まったく同じ条件 (partner_amount > 0 または partner_paid > 0)
//   ・残高の数字は partnerBalance.ts を通したものだけ
//   ・2,000文字を絶対に超えない(超えると Discord に丸ごと拒否される)
//   ・二度目は「送り直し」と分かる形で届く
// ============================================================

let seq = 0
function tx(p: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: `id${String(seq).padStart(3, '0')}`,
    date: '2026-08-06',
    type: 'expense',
    amount: 3000,
    category: 'food',
    memo: '',
    store: '',
    partner_amount: 0,
    created_at: `2026-08-06T0${(seq % 9) + 1}:00:00.000Z`,
    tags: ['旅行', '2026和歌山'],
    ...p,
  }
}

const RANGE = { start: '2026-08-06', end: '2026-08-08' }
const label = (id: string | null) => (id === null ? '未分類' : id === 'food' ? '食費' : id)
const opts = { tags: ['旅行', '2026和歌山'], range: RANGE, labelOf: label }

describe('buildTripSummary', () => {
  it('彼女の負担がある支出と、彼女が払った回だけを入れる', () => {
    const txs = [
      tx({ store: '旅館', amount: 20000, partner_amount: 8000 }),
      // 彼女の負担0・彼女も払っていない = 自分だけの支出。1件も出さない
      tx({ store: 'コンビニ', amount: 500 }),
      // 彼女が全額払った回(負担0でも彼女には関係がある)
      tx({ store: '駅弁', amount: 2400, partner_amount: 0, partner_paid: 2400 }),
    ]
    const s = buildTripSummary(txs, opts)
    expect(s.entries.map((e) => e.title)).toEqual(['旅館', '駅弁'])
    expect(s.skippedCount).toBe(1)
    expect(s.shareTotal).toBe(8000)
  })

  it('タグが両方付いた記録だけを集める(別の旅行が混ざらない)', () => {
    const txs = [
      tx({ store: '和歌山', partner_amount: 1000 }),
      tx({ store: '北海道', partner_amount: 9999, tags: ['旅行', '2025北海道'] }),
      tx({ store: '普段', partner_amount: 500, tags: [] }),
    ]
    expect(buildTripSummary(txs, opts).entries.map((e) => e.title)).toEqual(['和歌山'])
  })

  it('期間外の記録は入らない', () => {
    const txs = [
      tx({ date: '2026-08-05', store: '前日', partner_amount: 100 }),
      tx({ date: '2026-08-07', store: '中日', partner_amount: 200 }),
      tx({ date: '2026-08-09', store: '翌日', partner_amount: 300 }),
    ]
    expect(buildTripSummary(txs, opts).entries.map((e) => e.title)).toEqual(['中日'])
  })

  it('残高への影響は partnerImpact の合計と一致する', () => {
    const txs = [
      tx({ partner_amount: 3000 }), // 自分が払った → −3000
      tx({ amount: 10000, partner_amount: 2000, partner_paid: 10000 }), // 彼女が払った → +8000
    ]
    const s = buildTripSummary(txs, opts)
    expect(s.balanceImpact).toBe(5000)
    expect(s.shareTotal).toBe(5000)
  })

  it('カテゴリ内訳は彼女の負担額で多い順に並ぶ', () => {
    const txs = [
      tx({ category: 'stay', partner_amount: 8000 }),
      tx({ category: 'food', partner_amount: 3000 }),
      tx({ category: 'food', partner_amount: 2000 }),
    ]
    expect(buildTripSummary(txs, opts).categories).toEqual([
      { label: 'stay', total: 8000, count: 1 },
      { label: '食費', total: 5000, count: 2 },
    ])
  })

  it('彼女に関係する記録が1件も無ければ空になる', () => {
    const s = buildTripSummary([tx({ store: '自分用' })], opts)
    expect(s.entries).toEqual([])
    expect(s.categories).toEqual([])
    expect(s.shareTotal).toBe(0)
    expect(s.skippedCount).toBe(1)
  })

  it('日付の順に並ぶ(同じ日は記録した順)', () => {
    const txs = [
      tx({ date: '2026-08-08', store: 'C', partner_amount: 1 }),
      tx({ date: '2026-08-06', store: 'A', partner_amount: 1, created_at: '2026-08-06T01:00:00Z' }),
      tx({ date: '2026-08-06', store: 'B', partner_amount: 1, created_at: '2026-08-06T05:00:00Z' }),
    ]
    expect(buildTripSummary(txs, opts).entries.map((e) => e.title)).toEqual(['A', 'B', 'C'])
  })

  it('預かり・返金・調整は入らない(旅行の支出のまとめなので)', () => {
    const txs = [
      tx({ type: 'partner_deposit', amount: 30000, partner_amount: 0 }),
      tx({ store: '旅館', partner_amount: 100 }),
    ]
    expect(buildTripSummary(txs, opts).entries.map((e) => e.title)).toEqual(['旅館'])
  })
})

describe('本文', () => {
  it('明細は日付・内容・彼女の負担額の順', () => {
    expect(
      tripEntryLine({
        id: 'x',
        date: '2026-08-06',
        title: '旅館',
        share: 8000,
        paid: 0,
        impact: -8000,
        category: null,
      })
    ).toBe('8月6日(木) 旅館 ¥8,000')
  })

  it('彼女が払った回は、いくら出したかを添える', () => {
    expect(
      tripEntryLine({
        id: 'x',
        date: '2026-08-06',
        title: '駅弁',
        share: 1200,
        paid: 2400,
        impact: 1200,
        category: null,
      })
    ).toContain('あなたが ¥2,400 払いました')
  })

  it('期間・件数・負担の合計・明細・カテゴリ内訳・残高がすべて入る', () => {
    const txs = [
      tx({ store: '旅館', category: 'stay', amount: 20000, partner_amount: 8000 }),
      tx({ date: '2026-08-07', store: '昼ごはん', amount: 3000, partner_amount: 1500 }),
    ]
    const summary = buildTripSummary(txs, opts)
    const messages = buildTripMessages({ summary, currentBalance: 12000 })
    expect(messages).toHaveLength(1)
    const text = messages[0].text

    expect(text).toContain('🧳 #2026和歌山 のまとめ')
    expect(text).toContain('2026年8月6日(木) 〜 2026年8月8日(土)(3日間)')
    expect(text).toContain('タグ: #旅行 #2026和歌山')
    expect(text).toContain('あなたに関係する記録: 2件')
    expect(text).toContain('あなたの負担の合計: ¥9,500')
    expect(text).toContain('8月6日(木) 旅館 ¥8,000')
    expect(text).toContain('8月7日(金) 昼ごはん ¥1,500')
    expect(text).toContain('カテゴリ内訳(あなたの負担)')
    expect(text).toContain('stay ¥8,000(1件)')
    expect(text).toContain('あずかっているお金から ¥9,500 を使いました')
    expect(text).toContain('いまの残高: ¥12,000(預かり中)')
    // 出していないものを、出していないと書く
    expect(text).toContain('私だけの支出')
  })

  it('彼女が多く払った旅行は、増えた向きで書く', () => {
    const txs = [tx({ amount: 10000, partner_amount: 2000, partner_paid: 10000 })]
    const summary = buildTripSummary(txs, opts)
    const text = buildTripMessages({ summary, currentBalance: 8000 })[0].text
    expect(text).toContain('あずかっているお金は ¥8,000 増えました')
  })

  it('1件も無ければ1通も作らない(意味の無い通知を送らない)', () => {
    const summary = buildTripSummary([tx({ store: '自分用' })], opts)
    expect(buildTripMessages({ summary, currentBalance: 0 })).toEqual([])
  })

  it('金額は目隠しの対象外(伏字にしない)', () => {
    const summary = buildTripSummary([tx({ partner_amount: 8000 })], opts)
    const text = buildTripMessages({ summary, currentBalance: 0 })[0].text
    expect(text).toContain('¥8,000')
    expect(text).not.toContain('•')
  })
})

describe('2,000文字での分割', () => {
  const many = Array.from({ length: 120 }, (_, i) =>
    tx({
      date: '2026-08-07',
      store: `おみやげ${i}`,
      amount: 2000,
      partner_amount: 1000,
    })
  )

  it('どの通も上限を超えない', () => {
    const summary = buildTripSummary(many, opts)
    const messages = buildTripMessages({ summary, currentBalance: 0 })
    expect(messages.length).toBeGreaterThan(1)
    for (const m of messages) expect(m.text.length).toBeLessThanOrEqual(DISCORD_MESSAGE_LIMIT)
  })

  it('分けたときは通し番号が付き、明細が1件も落ちない', () => {
    const summary = buildTripSummary(many, opts)
    const messages = buildTripMessages({ summary, currentBalance: 0 })
    expect(messages[0].text).toContain(`(1/${messages.length})`)
    const all = messages.map((m) => m.text).join('\n')
    for (const e of summary.entries) expect(all).toContain(e.title)
  })

  it('異常に長い見出しでも上限を超えない(切り捨てずに全部送る)', () => {
    const summary = buildTripSummary(
      [tx({ store: 'あ'.repeat(500), partner_amount: 100 })],
      opts
    )
    const messages = buildTripMessages({ summary, currentBalance: 0, limit: 200 })
    for (const m of messages) expect(m.text.length).toBeLessThanOrEqual(200)
  })
})

describe('送り直し', () => {
  it('2回目は見出しに「送り直し」が付く(2回ぶんと読み違えないように)', () => {
    const summary = buildTripSummary([tx({ partner_amount: 100 })], opts)
    const first = buildTripMessages({ summary, currentBalance: 0 })[0].text
    const again = buildTripMessages({ summary, currentBalance: 0, resend: true })[0].text
    expect(first).not.toContain('送り直し')
    expect(again).toContain('🧳 #2026和歌山 のまとめ(送り直し)')
  })

  it('見出しに出すのはいちばん内側のタグ(行き先)', () => {
    const summary = buildTripSummary([tx({ partner_amount: 100 })], opts)
    expect(tripHeadline(summary, 1, 1, false)).toBe('🧳 #2026和歌山 のまとめ')
    expect(tripHeadline({ ...summary, tags: ['旅行'] }, 1, 1, false)).toBe('🧳 #旅行 のまとめ')
  })
})

describe('tripCurrentBalance', () => {
  it('いまの残高は partnerBalance と同じ数字', () => {
    const txs = [
      tx({ type: 'partner_deposit', amount: 30000, partner_amount: 0 }),
      tx({ partner_amount: 8000 }),
    ]
    expect(tripCurrentBalance(txs)).toBe(22000)
  })
})
