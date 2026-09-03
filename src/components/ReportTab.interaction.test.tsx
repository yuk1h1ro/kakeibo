// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import ReportTab from './ReportTab'
import { todayISO } from '../lib/format'
import type { Transaction } from '../lib/types'

// ============================================================
// レポートのお店別の行から、その店の履歴へ飛ぶ導線。
//
// この画面が渡すのは **表示名ではなく集計のキー(= 店名そのもの)**。
// 表示名を渡すと「店名なし」の行だけキーと食い違い、
// 履歴側で '店名なし' という名前の店を探しに行って0件になる。
//
// 押せるのはお店別の行だけ(カテゴリ別・1件ごとは対象外)。
// ============================================================

afterEach(cleanup)

// jsdom は window.scrollTo を持たない(タグの「この期間で見る」などが呼ぶ)
window.scrollTo = () => {}

const TODAY = todayISO()

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: `t${Math.random().toString(36).slice(2)}`,
    date: TODAY,
    type: 'expense',
    amount: 1000,
    category: 'food',
    memo: '',
    store: 'オカモトセルフ',
    partner_amount: 0,
    created_at: `${TODAY}T01:00:00.000Z`,
    ...over,
  }
}

const ROWS: Transaction[] = [
  tx({ id: 'a', store: 'オカモトセルフ', amount: 5000 }),
  tx({ id: 'b', store: 'オカモトセルフ', amount: 4000 }),
  tx({ id: 'c', store: 'セブンイレブン', amount: 800 }),
  // 店名を入れずに記録した支出。集計では「店名なし」に束ねられる
  tx({ id: 'd', store: '', amount: 300 }),
]

function setup(rows: Transaction[] = ROWS) {
  const picked: string[] = []
  render(
    <ReportTab
      transactions={rows}
      onSetSatisfaction={async () => {}}
      onPickStore={(store) => picked.push(store)}
    />
  )
  return { picked, user: userEvent.setup() }
}

/** 支出上位ランキングのカード */
function rankCard(): HTMLElement {
  const head = screen.getByRole('heading', { name: '支出上位ランキング' })
  return head.closest('.card') as HTMLElement
}

/** お店別支出(棒グラフ)のカード */
function storeCard(): HTMLElement {
  const head = screen.getByRole('heading', { name: 'お店別支出' })
  return head.closest('.card') as HTMLElement
}

describe('お店別支出の棒グラフから履歴へ', () => {
  it('お店の行を押すと、その店名を渡す', () => {
    const { picked } = setup()
    fireEvent.click(within(storeCard()).getByRole('button', { name: 'オカモトセルフ の履歴を見る' }))
    expect(picked).toEqual(['オカモトセルフ'])
  })

  it('「店名なし」の行は押せない(絞り込む先が無い)', () => {
    setup()
    // 集計(棒グラフ)には出るが、押せる行にはしない
    expect(within(storeCard()).getByText('店名なし')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '店名なし の履歴を見る' })).toBeNull()
  })

  it('期間の違いを先に伝える(レポートは選択期間・履歴は全期間)', () => {
    setup()
    expect(screen.getByText(/お店を押すと、そのお店の履歴だけを見られます/)).toBeTruthy()
  })

  it('カテゴリ別の棒グラフは押せないまま(今回の対象はお店だけ)', () => {
    setup()
    expect(screen.queryByRole('button', { name: '食費 の履歴を見る' })).toBeNull()
  })
})

describe('支出上位ランキング(お店別)から履歴へ', () => {
  it('お店別に切り替えた行を押すと、その店名を渡す', async () => {
    const { picked, user } = setup()
    await user.click(screen.getByRole('button', { name: 'お店別' }))
    const row = within(rankCard()).getByRole('button', { name: 'オカモトセルフ の履歴を見る' })
    await user.click(row)
    expect(picked).toEqual(['オカモトセルフ'])
  })

  it('カテゴリ別・1件ごとの行は押せない', async () => {
    const { user } = setup()
    // 既定のカテゴリ別
    expect(rankCard().querySelectorAll('.rank-row-btn')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: '1件ごと' }))
    expect(rankCard().querySelectorAll('.rank-row-btn')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'お店別' }))
    expect(rankCard().querySelectorAll('.rank-row-btn').length).toBeGreaterThan(0)
  })

  it('「店名なし」の行は押せないまま(順位には出る)', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'お店別' }))
    const noStore = [...rankCard().querySelectorAll('.rank-row')].find((el) =>
      (el.textContent ?? '').includes('店名なし')
    )
    expect(noStore).toBeTruthy()
    expect(noStore!.querySelector('.rank-row-btn')).toBeNull()
  })

  it('受け取り手を渡さなければ、行はこれまでどおり押せない', async () => {
    render(<ReportTab transactions={ROWS} onSetSatisfaction={async () => {}} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'お店別' }))
    expect(rankCard().querySelectorAll('.rank-row-btn')).toHaveLength(0)
  })
})

describe('レポートの集計と、飛んだ先の絞り込みのキー', () => {
  it('渡すのは表示名ではなく集計のキー(店名そのもの)', async () => {
    // 「店名なし」は表示名とキーが違う唯一の行。ここで表示名を渡していると、
    // 履歴側は '店名なし' という店を探して0件になる
    const { picked, user } = setup([tx({ id: 'x', store: ' オカモトセルフ ', amount: 900 })])
    await user.click(screen.getByRole('button', { name: 'お店別' }))
    await user.click(within(rankCard()).getByRole('button', { name: 'オカモトセルフ の履歴を見る' }))
    // 前後の空白は集計側で落ちている(履歴側も同じキーで突き合わせる)
    expect(picked).toEqual(['オカモトセルフ'])
  })
})
