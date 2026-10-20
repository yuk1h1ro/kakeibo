import { describe, expect, it } from 'vitest'
import {
  addSplitPart,
  buildPartnerOpMessage,
  classifyDiscordStatus,
  discordFailureMessage,
  formatSplitNotification,
  notifyDate,
  splitGroupOfOp,
} from './discordNotify'

describe('classifyDiscordStatus', () => {
  it('401 / 403 / 404 は Webhook が無効になった側の失敗', () => {
    // チャンネルを削除・作り直すと、それまでの Webhook URL は 404 になる
    for (const status of [401, 403, 404]) {
      expect(classifyDiscordStatus(status)).toEqual({ kind: 'webhook', status })
    }
  })

  it('混雑や一時的な不調は Webhook のせいにしない', () => {
    // 429(送りすぎ)や 5xx は待てば直る。URL を入れ直させるのは筋違い
    expect(classifyDiscordStatus(429).kind).toBe('http')
    expect(classifyDiscordStatus(500).kind).toBe('http')
  })
})

describe('discordFailureMessage', () => {
  it('Webhook が無効なときは、URL の取り直し方を手順で書く', () => {
    const m = discordFailureMessage({ kind: 'webhook', status: 404 })
    expect(m).toContain('Webhook URL が古い')
    expect(m).toContain('チャンネル設定')
    expect(m).toContain('ウェブフック')
  })

  it('届いていないときは、通信の確認を促す(URL のせいにしない)', () => {
    const m = discordFailureMessage({ kind: 'network' })
    expect(m).toContain('通信')
    expect(m).not.toContain('Webhook URL が古い')
  })

  it('その他の失敗は、ステータスを添えて再試行を促す', () => {
    const m = discordFailureMessage({ kind: 'http', status: 429 })
    expect(m).toContain('429')
    expect(m).toContain('もう一度')
  })

  it('どの失敗でも、次にやることが必ず書いてある', () => {
    const all = [
      { kind: 'network' } as const,
      { kind: 'webhook', status: 404 } as const,
      { kind: 'http', status: 500 } as const,
    ]
    for (const f of all) {
      expect(discordFailureMessage(f)).toMatch(/ください/)
    }
  })
})

describe('分割の会計の通知(純粋関数)', () => {
  const part = (id: string, over: Record<string, unknown> = {}) => ({
    kind: 'insert' as const,
    id,
    payload: {
      type: 'expense' as const,
      amount: 1000,
      partner_amount: 300,
      partner_paid: 0,
      category: 'food',
      memo: '',
      store: 'お店',
      split_group: 'g1',
      ...over,
    },
  })

  it('束ねを持つ追加だけが内訳。修正・削除・束ね無しは対象外', () => {
    expect(splitGroupOfOp(part('a'))).toBe('g1')
    expect(splitGroupOfOp({ ...part('a'), kind: 'update' })).toBeNull()
    expect(splitGroupOfOp({ kind: 'delete', id: 'a' })).toBeNull()
    expect(splitGroupOfOp(part('a', { split_group: null }))).toBeNull()
    expect(splitGroupOfOp(part('a', { split_group: '' }))).toBeNull()
  })

  it('内訳ではない op を足しても、まとめている会計は変わらない', () => {
    const acc = addSplitPart(null, part('a'), 100)
    expect(addSplitPart(acc, { kind: 'delete', id: 'x' }, 50)).toBe(acc)
  })

  it('残高は最後に足した内訳のあとの値。負担の無い内訳も行IDは控える', () => {
    let acc = addSplitPart(null, part('a'), 700)
    acc = addSplitPart(acc, part('b', { partner_amount: 0 }), 700)
    expect(acc?.parts).toHaveLength(1)
    expect(acc?.ids).toEqual(['a', 'b'])
    expect(acc?.balance).toBe(700)
  })

  it('効く内訳が無ければ通知しない', () => {
    const acc = addSplitPart(null, part('a', { partner_amount: 0 }), 0)
    expect(formatSplitNotification(acc!)).toBeNull()
  })

  it('お店もメモも無いときは「分けた会計」と書く', () => {
    let acc = addSplitPart(null, part('a', { store: '' }), 0)
    acc = addSplitPart(acc, part('b', { store: '', category: 'daily' }), 0)
    expect(formatSplitNotification(acc!)?.split('\n')[0]).toBe('🍽️ 分けた会計 −¥600(2つに分けた会計)')
  })
})

// ============================================================
// 「どの記録の話か」「いつの記録か」を書く
//
// 以前は削除が「🗑 記録が削除されました(差分 +¥1,811)」だけで、彼女には
// どの記録が消えたのか分からなかった。日付も無いので、昨日以前の記録も
// 今日のことのように読めた。削除の取り消しは新しい支出と同じ形で届き、
// 「消して、また使った」に見えていた。
// ============================================================
describe('通知に記録の名前と日付を書く', () => {
  const TODAY = '2026-10-20'
  const life = {
    id: 'life',
    type: 'expense' as const,
    amount: 3621,
    partner_amount: 1811,
    partner_paid: 0,
    category: 'food',
    memo: '',
    store: 'ライフ',
    date: '2026-10-12',
  }
  const deposit = { id: 'd', type: 'partner_deposit' as const, amount: 50000, partner_amount: 0 }

  it('今日の記録には日付を付けない。それ以外は「10月12日」', () => {
    expect(notifyDate(TODAY, TODAY)).toBe('')
    expect(notifyDate('2026-10-12', TODAY)).toBe('10月12日')
    expect(notifyDate('2026-01-05', TODAY)).toBe('1月5日')
    expect(notifyDate(undefined, TODAY)).toBe('')
  })

  it('支出は、今日以外なら頭に日付を付ける', () => {
    const op = { kind: 'insert' as const, id: 'life', payload: life }
    const msg = buildPartnerOpMessage(op, [deposit], [deposit, life], TODAY)
    expect(msg?.split('\n')[0]).toBe('🍽️ 10月12日 ライフ −¥1,811')

    const todays = { ...life, date: TODAY }
    const todayMsg = buildPartnerOpMessage({ ...op, payload: todays }, [deposit], [deposit, todays], TODAY)
    expect(todayMsg?.split('\n')[0]).toBe('🍽️ ライフ −¥1,811')
  })

  it('削除は、どの記録が消えたかを書く', () => {
    const op = { kind: 'delete' as const, id: 'life' }
    const msg = buildPartnerOpMessage(op, [deposit, life], [deposit], TODAY)
    expect(msg).toBe('🗑 記録が削除されました: 10月12日 ライフ(差分 +¥1,811)\n残高: ¥50,000(預かり中)')
  })

  it('修正は、直したあとの名前で書く', () => {
    const op = { kind: 'update' as const, id: 'life', payload: { ...life, store: 'ライフ駅前店', partner_amount: 1000 } }
    const msg = buildPartnerOpMessage(op, [deposit, life], [deposit, { ...life, partner_amount: 1000 }], TODAY)
    expect(msg?.split('\n')[0]).toBe('✏️ 記録が修正されました: 10月12日 ライフ駅前店(差分 +¥811)')
  })

  it('削除の取り消しは「元に戻しました」と書く(新しい支出に見せない)', () => {
    const op = { kind: 'insert' as const, id: 'life', payload: life, restore: true }
    const msg = buildPartnerOpMessage(op, [deposit], [deposit, life], TODAY)
    expect(msg).toBe('↩️ 削除した記録を元に戻しました: 10月12日 ライフ(差分 −¥1,811)\n残高: ¥48,189(預かり中)')
    expect(msg).not.toContain('🍽️')
  })

  it('預かり・返金・調整は、今日以外なら末尾に「(9月30日の記録)」', () => {
    const op = { kind: 'insert' as const, id: 'd2', payload: { ...deposit, category: null, memo: '', date: '2026-09-30' } }
    const msg = buildPartnerOpMessage(op, [], [op.payload], TODAY)
    expect(msg?.split('\n')[0]).toBe('💰 預かりを受け取りました +¥50,000(9月30日の記録)')
  })

  it('取り消しの内訳は分割の会計にまとめない(まとめると新しい会計に見える)', () => {
    const op = { kind: 'insert' as const, id: 'p1', payload: { ...life, split_group: 'g1' }, restore: true }
    expect(splitGroupOfOp(op)).toBeNull()
  })

  it('分割の会計にも、今日以外なら日付を付ける', () => {
    const part = (id: string, category: string) => ({
      kind: 'insert' as const,
      id,
      payload: { ...life, id, category, split_group: 'g1', partner_amount: 300 },
    })
    let acc = addSplitPart(null, part('a', 'food'), 0, TODAY)
    acc = addSplitPart(acc, part('b', 'daily'), 0, TODAY)
    expect(formatSplitNotification(acc!)?.split('\n')[0]).toBe('🍽️ 10月12日 ライフ −¥600(2つに分けた会計)')
  })
})
