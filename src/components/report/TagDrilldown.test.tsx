// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Transaction } from '../../lib/types'
import { monthRange } from '../../lib/report'
import { setSpecialTags } from '../../lib/reportTagSettings'
import { resetDiscordWebhookForTest } from '../../lib/discordWebhook'
import { resetTripSendsForTest } from '../../lib/tripSummarySends'
import TagBreakdownCard from './TagBreakdownCard'

// ============================================================
// 共起タグのドリルダウン(#旅行 → #2026和歌山)と、その回に対する操作。
//
// 実際に描いて確かめるのは4つ:
//   ・行き先タグが **トップの一覧に出ない**(二重計上を目に見えて増やさない)
//   ・#旅行 を押すと内側に出て、押すとその旅行だけに絞れる
//   ・絞ったあとも「回ごと」が動く(行き先タグの無い過去の旅行も残る)
//   ・「この回にタグを付ける」は、件数を見せて確認を取ってから updateMany を呼ぶ
// ============================================================

let seq = 0
function tx(p: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: `id${seq}`,
    date: '2026-08-06',
    type: 'expense',
    amount: 10000,
    category: 'food',
    memo: '',
    store: '',
    partner_amount: 0,
    created_at: '2026-08-06T03:00:00.000Z',
    ...p,
  }
}

const AUG = monthRange('2026-08')

// 2026和歌山(8/6〜8/8)と、2025北海道(8/20)、タグなしが1件
const TXS: Transaction[] = [
  tx({ date: '2026-08-06', amount: 30000, store: '旅館', tags: ['旅行', '2026和歌山'] }),
  tx({ date: '2026-08-07', amount: 20000, store: '昼ごはん', tags: ['旅行', '2026和歌山'] }),
  tx({ date: '2026-08-08', amount: 5000, store: 'おみやげ', tags: ['旅行', '2026和歌山'] }),
  tx({ date: '2026-08-20', amount: 12000, store: '出張先', tags: ['旅行', '2025北海道'] }),
  tx({ date: '2026-08-25', amount: 800, store: 'スーパー' }),
]

const props = { range: AUG, periodLabel: '今月', onPickRange: () => {} }

afterEach(() => {
  cleanup()
  resetTripSendsForTest()
  try {
    localStorage.clear()
  } catch {
    // localStorage が無い環境でも後続は動く
  }
  setSpecialTags(['旅行', 'デート', '出張'])
  resetDiscordWebhookForTest()
  vi.unstubAllGlobals()
})

describe('トップのタグ一覧', () => {
  it('行き先タグは出さず、その理由を書く', () => {
    render(<TagBreakdownCard {...props} transactions={TXS} />)
    const chips = screen.getByRole('group', { name: '内訳を見るタグ' })
    expect(within(chips).getByRole('button', { name: '#旅行' })).toBeTruthy()
    expect(within(chips).queryByRole('button', { name: '#2026和歌山' })).toBeNull()
    expect(within(chips).queryByRole('button', { name: '#2025北海道' })).toBeNull()
    expect(within(chips).getByRole('button', { name: 'タグなし' })).toBeTruthy()
    expect(screen.getByText(/上の一覧には出していません/)).toBeTruthy()
  })

  it('行き先タグを外したので、合計は総額と一致する(二重計上が増えない)', () => {
    render(<TagBreakdownCard {...props} transactions={TXS} />)
    expect(screen.getByText(/総額\(¥67,800\)と一致します/)).toBeTruthy()
  })
})

describe('1段だけ掘る', () => {
  it('#旅行 を押すと、一緒に付いているタグが内側に出る', async () => {
    const user = userEvent.setup()
    render(<TagBreakdownCard {...props} transactions={TXS} />)
    await user.click(screen.getByRole('button', { name: '#旅行' }))

    const co = screen.getByRole('group', { name: '旅行と一緒に付いているタグ' })
    expect(within(co).getByRole('button', { name: /#2026和歌山/ })).toBeTruthy()
    expect(within(co).getByRole('button', { name: /#2025北海道/ })).toBeTruthy()
  })

  it('内側のタグを押すと、その旅行だけに絞れる', async () => {
    const user = userEvent.setup()
    render(<TagBreakdownCard {...props} transactions={TXS} />)
    await user.click(screen.getByRole('button', { name: '#旅行' }))
    await user.click(screen.getByRole('button', { name: /#2026和歌山/ }))

    expect(screen.getByText('#旅行 › #2026和歌山の内訳(今月)')).toBeTruthy()
    // 回ごとは1回だけ(北海道の回は混ざらない)
    expect(screen.getByText('8月6日(木) 〜 8月8日(土)')).toBeTruthy()
    expect(screen.queryByText('8月20日(木)')).toBeNull()
    // 掘れるのは1段だけ。内側を選んだらそれ以上の共起タグは出さない
    expect(screen.queryByRole('group', { name: /と一緒に付いているタグ/ })).toBeNull()
  })

  it('1段だけ掘ったところから、親の全体に戻れる', async () => {
    const user = userEvent.setup()
    render(<TagBreakdownCard {...props} transactions={TXS} />)
    await user.click(screen.getByRole('button', { name: '#旅行' }))
    await user.click(screen.getByRole('button', { name: /#2026和歌山/ }))
    await user.click(screen.getByRole('button', { name: '← #旅行 全体に戻る' }))

    expect(screen.getByText('#旅行の内訳(今月)')).toBeTruthy()
    // 回ごとは 旅行 全体の2回に戻る
    expect(screen.getByText('8月20日(木)')).toBeTruthy()
  })

  it('行き先タグを付けていない旅行も、これまでどおり「回ごと」で見られる', async () => {
    const user = userEvent.setup()
    const noPlace = [
      tx({ date: '2026-08-01', amount: 9000, tags: ['旅行'] }),
      tx({ date: '2026-08-02', amount: 4000, tags: ['旅行'] }),
    ]
    render(<TagBreakdownCard {...props} transactions={noPlace} />)
    await user.click(screen.getByRole('button', { name: '#旅行' }))

    expect(screen.queryByRole('group', { name: /と一緒に付いているタグ/ })).toBeNull()
    expect(screen.getByText('8月1日(土) 〜 8月2日(日)')).toBeTruthy()
  })
})

describe('この回にまとめてタグを付ける', () => {
  it('件数を見せて確認を取ってから、1件ずつの更新として渡す', async () => {
    const user = userEvent.setup()
    const onBulkUpdate = vi.fn()
    const noPlace = [
      tx({ date: '2026-08-01', amount: 9000, tags: ['旅行'] }),
      tx({ date: '2026-08-02', amount: 4000, tags: ['旅行'] }),
      // 別の回。まとめて付ける対象に入ってはいけない
      tx({ date: '2026-08-20', amount: 1000, tags: ['旅行'] }),
    ]
    render(
      <TagBreakdownCard {...props} transactions={noPlace} onBulkUpdate={onBulkUpdate} />
    )
    await user.click(screen.getByRole('button', { name: '#旅行' }))
    await user.click(screen.getAllByRole('button', { name: 'この回にタグを付ける' })[1])

    await user.type(screen.getByLabelText('付けるタグ'), '2026和歌山')
    await user.click(screen.getByRole('button', { name: '2件に #2026和歌山 を付ける' }))
    // 押した瞬間には書き換わらない。確認を1段挟む
    expect(onBulkUpdate).not.toHaveBeenCalled()
    expect(screen.getByText('2件に #2026和歌山 を付けます')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '付ける' }))
    expect(onBulkUpdate).toHaveBeenCalledTimes(1)
    const updates = onBulkUpdate.mock.calls[0][0]
    expect(updates).toHaveLength(2)
    expect(updates[0].input.tags).toEqual(['旅行', '2026和歌山'])
    expect(screen.getByText(/2件に #2026和歌山 を付けました/)).toBeTruthy()
  })

  it('タグが5個ある記録は飛ばし、その件数を必ず伝える', async () => {
    const user = userEvent.setup()
    const onBulkUpdate = vi.fn()
    const full = [
      tx({ date: '2026-08-01', tags: ['旅行'] }),
      tx({ date: '2026-08-02', tags: ['旅行', 'a', 'b', 'c', 'd'] }),
    ]
    render(<TagBreakdownCard {...props} transactions={full} onBulkUpdate={onBulkUpdate} />)
    await user.click(screen.getByRole('button', { name: '#旅行' }))
    await user.click(screen.getByRole('button', { name: 'この回にタグを付ける' }))
    await user.type(screen.getByLabelText('付けるタグ'), '2026和歌山')
    await user.click(screen.getByRole('button', { name: '2件に #2026和歌山 を付ける' }))

    expect(screen.getByText(/タグが5個ある1件は付けられません/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '付ける' }))
    expect(onBulkUpdate.mock.calls[0][0]).toHaveLength(1)
    expect(screen.getByText(/1件は付けられませんでした/)).toBeTruthy()
  })

  it('付け間違えたら、同じ入り口からまとめて外せる', async () => {
    const user = userEvent.setup()
    const onBulkUpdate = vi.fn()
    render(<TagBreakdownCard {...props} transactions={TXS} onBulkUpdate={onBulkUpdate} />)
    await user.click(screen.getByRole('button', { name: '#旅行' }))
    await user.click(screen.getAllByRole('button', { name: 'この回にタグを付ける' })[1])

    await user.click(screen.getByRole('button', { name: '#2026和歌山(3)' }))
    expect(screen.getByText('3件に #2026和歌山 を外します')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '外す' }))

    const updates = onBulkUpdate.mock.calls[0][0]
    expect(updates).toHaveLength(3)
    expect(updates[0].input.tags).toEqual(['旅行'])
  })

  it('書き込む手段が渡されていなければ、その導線は出さない', async () => {
    const user = userEvent.setup()
    render(<TagBreakdownCard {...props} transactions={TXS} />)
    await user.click(screen.getByRole('button', { name: '#旅行' }))
    expect(screen.queryByRole('button', { name: 'この回にタグを付ける' })).toBeNull()
  })
})

describe('この回を彼女に送る', () => {
  it('Discord を設定していないときは導線を出さない', async () => {
    const user = userEvent.setup()
    render(<TagBreakdownCard {...props} transactions={TXS} />)
    await user.click(screen.getByRole('button', { name: '#旅行' }))
    expect(screen.queryByRole('button', { name: 'この回を彼女に送る' })).toBeNull()
  })

  it('設定済みなら、押す前に通数と1通目の実物が出る', async () => {
    localStorage.setItem('kakeibo.discordWebhook', 'https://discord.com/api/webhooks/1/abc')
    resetDiscordWebhookForTest()
    const user = userEvent.setup()
    const txs = [
      tx({ date: '2026-08-06', amount: 30000, store: '旅館', partner_amount: 12000, tags: ['旅行', '2026和歌山'] }),
      // 自分だけの支出。彼女には1件も出さない
      tx({ date: '2026-08-07', amount: 500, store: 'コンビニ', tags: ['旅行', '2026和歌山'] }),
    ]
    render(<TagBreakdownCard {...props} transactions={txs} />)
    await user.click(screen.getByRole('button', { name: '#旅行' }))
    await user.click(screen.getByRole('button', { name: /#2026和歌山/ }))
    await user.click(screen.getByRole('button', { name: 'この回を彼女に送る' }))

    expect(screen.getByText(/1通目に届くもの/)).toBeTruthy()
    const preview = document.querySelector('.backlog-preview')?.textContent ?? ''
    expect(preview).toContain('🧳 #2026和歌山 のまとめ')
    expect(preview).toContain('旅館 ¥12,000')
    // 彼女の負担が無い記録は1件も出さない
    expect(preview).not.toContain('コンビニ')
    expect(screen.getByRole('button', { name: 'Discord に送る(1件・1通)' })).toBeTruthy()
  })

  it('送ると Discord に飛び、二度目は「送り直し」と分かる形になる', async () => {
    localStorage.setItem('kakeibo.discordWebhook', 'https://discord.com/api/webhooks/1/abc')
    resetDiscordWebhookForTest()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)

    const user = userEvent.setup()
    const txs = [
      tx({ date: '2026-08-06', amount: 30000, store: '旅館', partner_amount: 12000, tags: ['旅行', '2026和歌山'] }),
    ]
    const { unmount } = render(<TagBreakdownCard {...props} transactions={txs} />)
    await user.click(screen.getByRole('button', { name: '#旅行' }))
    await user.click(screen.getByRole('button', { name: /#2026和歌山/ }))
    await user.click(screen.getByRole('button', { name: 'この回を彼女に送る' }))
    await user.click(screen.getByRole('button', { name: /Discord に送る/ }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.content).toContain('あなたの負担の合計: ¥12,000')
    expect(body.content).not.toContain('送り直し')
    expect(screen.getByText(/1件を1通に分けて送りました/)).toBeTruthy()

    // もう一度開く = 送信済みと分かり、送り直しの印が付く
    unmount()
    render(<TagBreakdownCard {...props} transactions={txs} />)
    await user.click(screen.getByRole('button', { name: '#旅行' }))
    await user.click(screen.getByRole('button', { name: /#2026和歌山/ }))
    await user.click(screen.getByRole('button', { name: 'この回を彼女に送る' }))
    expect(screen.getByText(/に送信済みです/)).toBeTruthy()
    expect(document.querySelector('.backlog-preview')?.textContent).toContain('(送り直し)')
  })
})
