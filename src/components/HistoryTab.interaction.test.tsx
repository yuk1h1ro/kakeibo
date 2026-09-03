// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HistoryTab from './HistoryTab'
import type { TransactionInput, useTransactions } from '../hooks/useTransactions'
import { LONG_PRESS_MS } from '../lib/rowGesture'
import { monthKey, todayISO } from '../lib/format'
import { shiftMonth } from '../lib/calendar'
import type { Transaction } from '../lib/types'

// ============================================================
// 履歴タブを実際に操作して、**押した結果サーバーへ送られる内容** を確かめる。
//
// ここには実際に起きた不具合が2件ぶら下がっている:
//   ・複数選択からの一括カテゴリ変更で payload を手書きしており、
//     partner_paid が抜けて彼女に嘘の差分通知が飛んでいた
//   ・預かり行を複製すると二重計上されていた(複製の入口が支出以外にも出ていた)
//
// どちらも lib の純粋関数(withCategory / duplicateInput)は正しく、
// **画面からの呼び方だけ** が違っていたので、lib のテストは1件も落ちなかった。
// だから「送られた内容」そのものを受け取って確かめる。
// ============================================================

afterEach(cleanup)

// jsdom は window.scrollTo を実装していない。背面固定 (bodyScrollLock) が
// シートを閉じるときに呼ぶだけなので、何もしない関数を置いておく
window.scrollTo = () => {}

const TODAY = todayISO()

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    date: TODAY,
    type: 'expense',
    amount: 2000,
    category: 'food',
    memo: '',
    store: 'スーパー',
    partner_amount: 800,
    // この4つが「その記録が持っている事実」。手書きの payload はここを落とす
    partner_paid: 2000,
    tags: ['旅行2026'],
    split_group: 'g1',
    source: 'recurring',
    created_at: `${TODAY}T01:00:00.000Z`,
    ...over,
  }
}

function setup(transactions: Transaction[], storePrefill?: { nonce: number; store: string }) {
  const added: TransactionInput[] = []
  const updated: { id: string; input: TransactionInput }[] = []
  const removed: Transaction[][] = []
  const store = {
    transactions,
    add: async (input: TransactionInput) => {
      added.push(input)
    },
    updateMany: async (rows: { id: string; input: TransactionInput }[]) => {
      updated.push(...rows)
    },
    removeMany: async (rows: Transaction[]) => {
      removed.push(rows)
    },
    undoableDeletes: null,
    undoDelete: async () => {},
    syncNow: async () => {},
    lastSyncedAt: null,
  } as unknown as ReturnType<typeof useTransactions>

  render(
    <HistoryTab
      store={store}
      onEdit={() => {}}
      onStartInput={() => {}}
      storePrefill={storePrefill}
    />
  )
  return { user: userEvent.setup(), added, updated, removed }
}

/** いま開いているシート(カテゴリの選択肢が履歴の絞り込みと同名なので範囲を絞る) */
function sheet(): HTMLElement {
  return document.querySelector('.modal-sheet') as HTMLElement
}

/** 一覧に出ている明細の行(カレンダーのセルではないほう) */
function txRow(name: RegExp): HTMLElement {
  return screen.getByRole('button', { name }).closest('.hist-row') as HTMLElement
}

describe('複数選択からの一括カテゴリ変更 (機能151)', () => {
  it('カテゴリ以外は1つも書き換えずに送る(手書きの payload に戻ると落ちる)', async () => {
    const { user, updated } = setup([tx()])
    await user.click(screen.getByRole('button', { name: '選択' }))
    await user.click(screen.getByRole('button', { name: /スーパー を選ぶ/ }))
    await user.click(screen.getByRole('button', { name: 'カテゴリ' }))
    await user.click(within(sheet()).getByRole('button', { name: '日用品' }))

    expect(updated).toHaveLength(1)
    expect(updated[0].id).toBe('t1')
    expect(updated[0].input).toMatchObject({
      category: 'daily',
      amount: 2000,
      partner_amount: 800,
      // 彼女が払った額が落ちると、彼女へ「差分 −¥2,000」の嘘の通知が飛ぶ
      partner_paid: 2000,
      tags: ['旅行2026'],
      split_group: 'g1',
      source: 'recurring',
    })
  })

  it('すでにそのカテゴリの記録には、無意味な更新を投げない', async () => {
    const { user, updated } = setup([tx({ category: 'daily' })])
    await user.click(screen.getByRole('button', { name: '選択' }))
    await user.click(screen.getByRole('button', { name: /スーパー を選ぶ/ }))
    await user.click(screen.getByRole('button', { name: 'カテゴリ' }))
    await user.click(within(sheet()).getByRole('button', { name: '日用品' }))

    expect(updated).toHaveLength(0)
  })

  it('預かりの記録は件数に数えない(カテゴリを持たないため)', async () => {
    const { user } = setup([
      tx(),
      tx({ id: 't2', type: 'partner_deposit', amount: 30000, category: null, store: '' }),
    ])
    await user.click(screen.getByRole('button', { name: '選択' }))
    await user.click(screen.getByRole('button', { name: '全部' }))
    await user.click(screen.getByRole('button', { name: 'カテゴリ' }))

    expect(screen.getByRole('heading', { name: '1件のカテゴリを変える' })).toBeTruthy()
  })

  it('選んだ行だけを送る(選んでいない記録は巻き込まない)', async () => {
    const { user, updated } = setup([
      tx(),
      tx({ id: 't2', store: 'ドラッグストア', partner_amount: 0, partner_paid: 0 }),
    ])
    await user.click(screen.getByRole('button', { name: '選択' }))
    await user.click(screen.getByRole('button', { name: /ドラッグストア を選ぶ/ }))
    await user.click(screen.getByRole('button', { name: 'カテゴリ' }))
    await user.click(within(sheet()).getByRole('button', { name: '日用品' }))

    expect(updated.map((u) => u.id)).toEqual(['t2'])
  })
})

describe('長押しからの複製 (機能149)', () => {
  /** 行を長押しして、その場のメニューを開く */
  async function longPress(row: HTMLElement) {
    vi.useFakeTimers()
    try {
      fireEvent.pointerDown(row, { pointerId: 1, clientX: 10, clientY: 10, button: 0 })
      await act(async () => {
        vi.advanceTimersByTime(LONG_PRESS_MS + 10)
      })
    } finally {
      vi.useRealTimers()
    }
  }

  it('支出の複製は、その記録が持っている事実をそのまま今日の日付で積む', async () => {
    const { added } = setup([tx({ date: TODAY })])
    await longPress(txRow(/スーパー/))
    fireEvent.click(screen.getByRole('button', { name: /複製/ }))

    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({
      date: TODAY,
      amount: 2000,
      category: 'food',
      partner_amount: 800,
      // 誰が払ったか・タグは引き継ぐ(同じ買い物をもう一度した、が想定)
      partner_paid: 2000,
      tags: ['旅行2026'],
    })
    // 分割の束ねは引き継がない(複製は別の会計。元の内訳に紛れ込ませない)
    expect('split_group' in added[0]).toBe(false)
    // 手で複製した記録は手入力扱い。気分も引き継がない
    expect('source' in added[0]).toBe(false)
    expect('satisfaction' in added[0]).toBe(false)
  })

  it('預かりの行には複製の入口が出ない(複製すると預かり残高が二重に増える)', async () => {
    const { added } = setup([
      tx({ id: 'd1', type: 'partner_deposit', amount: 30000, category: null, store: '' }),
    ])
    await longPress(txRow(/彼女から預かり/))

    expect(screen.getByRole('heading', { name: 'この記録の操作' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /複製/ })).toBeNull()
    expect(added).toHaveLength(0)
  })

  it('返金・調整の行にも複製の入口は出ない(返していないお金を返したことにできる)', async () => {
    setup([tx({ id: 'r1', type: 'partner_refund', amount: 5000, category: null, store: '' })])
    await longPress(txRow(/彼女に返金/))
    expect(screen.queryByRole('button', { name: /複製/ })).toBeNull()
  })
})

describe('履歴の一覧に出る合計', () => {
  it('その日の合計は「自分の実質支出」で出す(彼女の負担分を含めない)', async () => {
    // ¥2,000 のうち彼女が ¥800 負担 → 自分の負担は ¥1,200。
    // ここで amount をそのまま足すと、明細の1行ずつと合計が食い違う
    setup([tx({ amount: 2000, partner_amount: 800 })])
    const head = document.querySelector('.hist-result-total') as HTMLElement
    expect(head.textContent).toContain('¥1,200')
  })

  it('預かりは支出の合計に混ざらない(残高の話であって支出ではない)', async () => {
    setup([
      tx({ amount: 2000, partner_amount: 800 }),
      tx({ id: 'd1', type: 'partner_deposit', amount: 30000, category: null, store: '' }),
    ])
    const head = document.querySelector('.hist-result-total') as HTMLElement
    expect(head.textContent).toContain('¥1,200')
  })
})

// ============================================================
// お店で絞り込む導線(長押しメニュー / レポートのお店別から)。
//
// 気をつけるところは2つ:
//   ・押した結果、本当に一覧がその店だけになること
//     (sameFilter に stores を足し忘れると「押しても何も起きない」で終わる)
//   ・**いま何で絞っているかが画面に出ていること**。
//     レポートから飛んだときは期間が全期間になるので、
//     レポートの行に出ていた件数とは変わる。黙って数字が変わるのがいちばん困る
// ============================================================
describe('お店で絞り込む導線', () => {
  const OLD_DAY = `${shiftMonth(monthKey(TODAY), -3)}-15`

  /** 行を長押しして、その場のメニューを開く */
  async function longPress(row: HTMLElement) {
    vi.useFakeTimers()
    try {
      fireEvent.pointerDown(row, { pointerId: 1, clientX: 10, clientY: 10, button: 0 })
      await act(async () => {
        vi.advanceTimersByTime(LONG_PRESS_MS + 10)
      })
    } finally {
      vi.useRealTimers()
    }
  }

  const rows = () => [
    tx({ id: 'a', store: 'オカモトセルフ', date: TODAY }),
    tx({ id: 'b', store: 'セブンイレブン', date: TODAY }),
    // 3ヶ月前の同じ店。期間は「すべて」なので、これも一緒に出てこないといけない
    tx({ id: 'c', store: 'オカモトセルフ', date: OLD_DAY, created_at: `${OLD_DAY}T01:00:00.000Z` }),
  ]

  /** 絞り込みバーに出ている「いま何で絞っているか」の説明文 */
  const filterState = () =>
    (document.querySelector('.hist-filter-state') as HTMLElement).textContent

  it('長押し →「このお店の履歴だけ見る」で、その店だけの一覧になる', async () => {
    setup(rows())
    // 絞る前はカレンダー + その日の明細(検索結果ではない)
    expect(screen.queryByText(/検索結果/)).toBeNull()

    await longPress(txRow(/オカモトセルフ/))
    fireEvent.click(screen.getByRole('button', { name: /このお店の履歴だけ見る/ }))

    // 期間は「すべて」なので、3ヶ月前の1件も一緒に出る
    expect(screen.getByText('検索結果 2件')).toBeTruthy()
    const shown = [...document.querySelectorAll('.hist-row')].map((el) => el.textContent ?? '')
    expect(shown).toHaveLength(2)
    expect(shown.every((t) => t.includes('オカモトセルフ'))).toBe(true)
    expect(shown.some((t) => t.includes('セブンイレブン'))).toBe(false)
  })

  it('絞り込んでいるお店が画面に出る(黙って件数が変わったように見せない)', async () => {
    setup(rows())
    await longPress(txRow(/オカモトセルフ/))
    fireEvent.click(screen.getByRole('button', { name: /このお店の履歴だけ見る/ }))

    expect(filterState()).toBe('お店:オカモトセルフ / すべて')
  })

  it('店名を持たない記録の長押しには、その項目が出ない', async () => {
    setup([tx({ id: 'd1', type: 'partner_deposit', amount: 30000, category: null, store: '' })])
    await longPress(txRow(/彼女から預かり/))
    expect(screen.queryByRole('button', { name: /このお店の履歴だけ見る/ })).toBeNull()
  })

  it('レポートから渡された店名は、開いた時点で効いている', () => {
    setup(rows(), { nonce: 1, store: 'オカモトセルフ' })
    expect(screen.getByText('検索結果 2件')).toBeTruthy()
    expect(filterState()).toBe('お店:オカモトセルフ / すべて')
  })

  it('絞り込みは解除できる(カレンダーの見え方に戻る)', async () => {
    const { user } = setup(rows(), { nonce: 1, store: 'オカモトセルフ' })
    await user.click(screen.getByRole('button', { name: /絞り込み・並べ替え/ }))
    // 開いた中に、外せるお店のチップが出ている
    expect(screen.getByRole('button', { name: 'オカモトセルフ ✕' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '絞り込みを解除' }))

    expect(screen.queryByText(/検索結果/)).toBeNull()
    expect(filterState()).toBe('')
  })
})
