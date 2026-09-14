// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

function setup(
  transactions: Transaction[],
  storePrefill?: { nonce: number; store: string },
  // 削除直後の「元に戻す」が出ている状態から始めたいとき用
  undoableDeletes: Transaction[] | null = null
) {
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
    undoableDeletes,
    undoDelete: async () => {},
    syncNow: async () => {},
    lastSyncedAt: null,
  } as unknown as ReturnType<typeof useTransactions>

  const view = (undoable: Transaction[] | null) => (
    <HistoryTab
      store={{ ...store, undoableDeletes: undoable } as ReturnType<typeof useTransactions>}
      onEdit={() => {}}
      onStartInput={() => {}}
      storePrefill={storePrefill}
    />
  )
  const { rerender } = render(view(undoableDeletes))
  return {
    user: userEvent.setup(),
    added,
    updated,
    removed,
    /** 画面はそのままに「削除直後(元に戻せる)」へ差し替える */
    setUndoable: (rows: Transaction[] | null) => rerender(view(rows)),
  }
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

// ============================================================
// 複数選択 → まとめてタグを付ける / 外す。
//
// レポートの「回ごと」からの一括タグ付けは、**すでに何かタグが付いている記録**
// にしか入れない(タグ別カードから掘って辿り着くため)。旅行モードを使い忘れて
// 帰ってきた旅行 — つまりタグが1つも無い35件 — に #旅行 を付けられる場所は
// ここしかないので、ここが塞がると機能そのものが使えない。
//
// 判断は lib/bulkTags.ts、画面は BulkTagSheet(レポートと共通)。
// ここで固定するのは **履歴の複数選択から呼んだときの結び付き**:
//   ・選んでいないときは押せない(カテゴリ・削除と同じ)
//   ・すでに付いている記録は飛ばす
//   ・上限(5個)で付けられなかった件数が画面に出る
//   ・外す操作が効く
// ============================================================
describe('複数選択からのまとめてタグ付け', () => {
  /** 一覧の行を選ぶ */
  async function pickAll(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: '選択' }))
    await user.click(screen.getByRole('button', { name: '全部' }))
  }

  const tagBtn = () => screen.getByRole('button', { name: 'タグ' }) as HTMLButtonElement

  it('1件も選んでいないときは押せない(カテゴリ・削除と同じ)', async () => {
    const { user } = setup([tx()])
    await user.click(screen.getByRole('button', { name: '選択' }))

    expect(tagBtn().disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'カテゴリ' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    await user.click(tagBtn())
    expect(document.querySelector('.modal-sheet')).toBeNull()

    // 1件選べば押せる
    await user.click(screen.getByRole('button', { name: /スーパー を選ぶ/ }))
    expect(tagBtn().disabled).toBe(false)
  })

  it('件数を見せて確認を取ってから、選んだ記録にだけ送る', async () => {
    const { user, updated } = setup([
      tx({ id: 't1', tags: [] }),
      tx({ id: 't2', store: 'コンビニ', tags: [] }),
    ])
    await pickAll(user)
    await user.click(tagBtn())
    await user.type(within(sheet()).getByLabelText('付けるタグ'), '2026北海道1周')
    await user.click(screen.getByRole('button', { name: '2件に #2026北海道1周 を付ける' }))

    // 押した瞬間には書き換わらない。確認を1段挟む
    expect(updated).toHaveLength(0)
    expect(screen.getByText('2件に #2026北海道1周 を付けます')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '付ける' }))
    expect(updated.map((u) => u.id)).toEqual(['t1', 't2'])
    // 記録が持っている事実は写す(手書きの payload に戻ると落ちる)
    expect(updated[0].input).toMatchObject({ partner_paid: 2000, tags: ['2026北海道1周'] })
    expect(screen.getByText(/2件に #2026北海道1周 を付けました/)).toBeTruthy()
  })

  it('すでに付いている記録は飛ばす(中身の無い変更履歴を残さない)', async () => {
    const { user, updated } = setup([
      tx({ id: 't1', tags: ['旅行'] }),
      tx({ id: 't2', store: 'コンビニ', tags: [] }),
    ])
    await pickAll(user)
    await user.click(tagBtn())
    await user.click(within(sheet()).getByRole('button', { name: '#旅行' }))
    await user.click(screen.getByRole('button', { name: '2件に #旅行 を付ける' }))

    expect(screen.getByText('1件に #旅行 を付けます(すでに付いている1件はそのまま)')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '付ける' }))
    expect(updated.map((u) => u.id)).toEqual(['t2'])
  })

  it('タグが5個ある記録は付けられない。その件数を画面に出す(黙って飛ばさない)', async () => {
    const { user, updated } = setup([
      tx({ id: 't1', tags: [] }),
      tx({ id: 't2', store: 'コンビニ', tags: ['a', 'b', 'c', 'd', 'e'] }),
    ])
    await pickAll(user)
    await user.click(tagBtn())
    await user.type(within(sheet()).getByLabelText('付けるタグ'), '旅行')
    await user.click(screen.getByRole('button', { name: '2件に #旅行 を付ける' }))

    expect(screen.getByText(/タグが5個ある1件は付けられません/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '付ける' }))
    expect(updated.map((u) => u.id)).toEqual(['t1'])
    expect(screen.getByText(/1件は付けられませんでした/)).toBeTruthy()
  })

  it('付け間違えたら、同じ入り口からまとめて外せる', async () => {
    const { user, updated } = setup([
      tx({ id: 't1', tags: ['旅行', '2026北海道1周'] }),
      tx({ id: 't2', store: 'コンビニ', tags: ['2026北海道1周'] }),
    ])
    await pickAll(user)
    await user.click(tagBtn())
    await user.click(within(sheet()).getByRole('button', { name: '#2026北海道1周(2)' }))

    expect(screen.getByText('2件に #2026北海道1周 を外します')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '外す' }))
    expect(updated.map((u) => u.id)).toEqual(['t1', 't2'])
    expect(updated[0].input.tags).toEqual(['旅行'])
    expect(updated[1].input.tags).toEqual([])
  })

  it('候補には、使われているタグと特別タグ(旅行・デート・出張)が出る', async () => {
    const { user } = setup([tx({ id: 't1', tags: ['2026和歌山'] })])
    await pickAll(user)
    await user.click(tagBtn())

    const options = within(sheet()).getByRole('group', { name: 'よく使うタグ' })
    expect(within(options).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '#2026和歌山',
      '#旅行',
      '#デート',
      '#出張',
    ])
  })

  it('タグを付けずに閉じたときは、選んだ記録をそのまま残す(選び直しの途中)', async () => {
    const { user } = setup([tx()])
    await pickAll(user)
    await user.click(tagBtn())
    await user.click(within(sheet()).getByRole('button', { name: '閉じる' }))

    expect(screen.getByText('1件を選択中')).toBeTruthy()
  })
})

// ============================================================
// 日付を指定して絞り込む → そのまま選んでタグを付ける。
//
// 本来の用途:「旅行モードを使い忘れた3日間の旅行に、あとから #旅行 を付ける」。
// 期間が すべて/この月/直近3ヶ月/この年 の4択だった頃は、旅行1回を選ぶのに
// 日ごとにカレンダーを叩き直す必要があった。ここで固定するのは
// **日付範囲で絞ってから、複数選択 → 全部 → タグ が最後まで通ること**。
// ============================================================
describe('日付を指定した絞り込み (期間「指定」)', () => {
  const LAST = shiftMonth(monthKey(TODAY), -1)
  const trip = (day: string, id: string) =>
    tx({ id, date: `${LAST}-${day}`, store: `旅行${day}`, tags: [], created_at: `${LAST}-${day}T01:00:00.000Z` })
  const rows = () => [
    trip('10', 'd1'),
    trip('11', 'd2'),
    trip('12', 'd3'),
    // 旅行の前後。日付でちょうど切り落とせることを見る
    tx({ id: 'before', date: `${LAST}-09`, store: '出発前', tags: [] }),
    tx({ id: 'after', date: `${LAST}-13`, store: '帰宅後', tags: [] }),
  ]

  const filterState = () =>
    (document.querySelector('.hist-filter-state') as HTMLElement).textContent

  /** 絞り込みを開いて「指定」を選び、開始・終了を入れる */
  async function pickRange(
    user: ReturnType<typeof userEvent.setup>,
    from: string,
    to: string
  ) {
    await user.click(screen.getByRole('button', { name: /絞り込み・並べ替え/ }))
    await user.click(screen.getByRole('button', { name: '指定' }))
    if (from !== '') fireEvent.change(screen.getByLabelText('絞り込みの開始日'), { target: { value: from } })
    if (to !== '') fireEvent.change(screen.getByLabelText('絞り込みの終了日'), { target: { value: to } })
  }

  it('入力は入力タブと同じ日付ピッカー(<input type="date">)', async () => {
    const { user } = setup(rows())
    await user.click(screen.getByRole('button', { name: /絞り込み・並べ替え/ }))
    // 「指定」を選ぶまでは日付の欄は出さない(4択だけの見た目を変えない)
    expect(screen.queryByLabelText('絞り込みの開始日')).toBeNull()
    await user.click(screen.getByRole('button', { name: '指定' }))
    expect((screen.getByLabelText('絞り込みの開始日') as HTMLInputElement).type).toBe('date')
    expect((screen.getByLabelText('絞り込みの終了日') as HTMLInputElement).type).toBe('date')
    // 日付を入れるまでは何も絞らない(押した途端に一覧へ切り替わらない)
    expect(screen.queryByText(/検索結果/)).toBeNull()
  })

  it('3日間を指定すると、その3日だけの一覧になる(両端を含む)', async () => {
    const { user } = setup(rows())
    await pickRange(user, `${LAST}-10`, `${LAST}-12`)

    expect(screen.getByText('検索結果 3件')).toBeTruthy()
    const shown = [...document.querySelectorAll('.hist-row')].map((el) => el.textContent ?? '')
    expect(shown).toHaveLength(3)
    expect(shown.some((t) => t.includes('出発前'))).toBe(false)
    expect(shown.some((t) => t.includes('帰宅後'))).toBe(false)
  })

  it('絞り込んでいる範囲が画面に出て、解除できる', async () => {
    const { user } = setup(rows())
    await pickRange(user, `${LAST}-10`, `${LAST}-12`)

    const [y, m] = LAST.split('-')
    expect(filterState()).toBe(`${y}/${Number(m)}/10〜${Number(m)}/12`)
    await user.click(screen.getByRole('button', { name: '絞り込みを解除' }))
    expect(screen.queryByText(/検索結果/)).toBeNull()
    expect(filterState()).toBe('')
  })

  it('開始 > 終了 のときは、入れ替えて絞ることを画面に出す(黙って0件にしない)', async () => {
    const { user } = setup(rows())
    await pickRange(user, `${LAST}-12`, `${LAST}-10`)

    const [y, m] = LAST.split('-')
    const range = `${y}/${Number(m)}/10〜${Number(m)}/12`
    expect(screen.getByText(`開始と終了が逆です。${range} として絞り込みます`)).toBeTruthy()
    expect(screen.getByText('検索結果 3件')).toBeTruthy()
  })

  it('片方だけでも効く(その日以降)', async () => {
    const { user } = setup(rows())
    await pickRange(user, `${LAST}-12`, '')

    // 12日と13日の2件
    expect(screen.getByText('検索結果 2件')).toBeTruthy()
    const [y, m] = LAST.split('-')
    expect(filterState()).toBe(`${y}/${Number(m)}/12以降`)
  })

  it('日付で絞っている間は、月送りの見出しを範囲の表示に差し替える', async () => {
    const { user } = setup(rows())
    // 絞る前はいつもどおりの月送り
    expect(screen.getByRole('button', { name: '前の月' })).toBeTruthy()

    await pickRange(user, `${LAST}-10`, `${LAST}-12`)
    // 範囲は月に依らないので、押しても何も起きない ← → は出さない
    expect(screen.queryByRole('button', { name: '前の月' })).toBeNull()
    expect(screen.queryByRole('button', { name: '次の月' })).toBeNull()
    const [y, m] = LAST.split('-')
    expect(screen.getByText(`${y}/${Number(m)}/10〜${Number(m)}/12 で絞り込み中`)).toBeTruthy()

    // 解除すれば元の月送りに戻る(月そのものは動かしていない)
    await user.click(screen.getByRole('button', { name: '絞り込みを解除' }))
    expect(screen.getByRole('button', { name: '前の月' })).toBeTruthy()
  })

  it('日付で絞る → 選択 → 全部 → タグ が通る(本来の用途)', async () => {
    const { user, updated } = setup(rows())
    await pickRange(user, `${LAST}-10`, `${LAST}-12`)
    await user.click(screen.getByRole('button', { name: '選択' }))
    await user.click(screen.getByRole('button', { name: '全部' }))

    expect(screen.getByText('3件を選択中')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'タグ' }))
    await user.type(within(sheet()).getByLabelText('付けるタグ'), '2026北海道')
    await user.click(screen.getByRole('button', { name: '3件に #2026北海道 を付ける' }))
    await user.click(screen.getByRole('button', { name: '付ける' }))

    // 範囲の外(出発前・帰宅後)は巻き込まない
    expect(updated.map((u) => u.id).sort()).toEqual(['d1', 'd2', 'd3'])
    expect(updated[0].input).toMatchObject({ tags: ['2026北海道'] })
  })
})

// ============================================================
// 画面下に浮かぶバー(複数選択 / 元に戻す)のぶん、一覧の下に余白を空ける。
//
// 利用者からの報告:「まとめてタグをつける際に、画面下部のポップアップに、
// 元々の画面の下の部分が隠れてしまって、選択できない」。
// バーは position: fixed なので一覧の上に重なる。余白が無いと最後の数行が
// バーの下に入り、**見えているのにタップできない**(その行を選べない)。
// 余白は .hist-root-barred が持つ(高さはバーの実測値 --hist-bar-h)。
//
// ここで固定するのは「バーが出ている間だけ、そのクラスが付くこと」。
// **これは再発の検出器であって、重なっていないことの確認ではない。**
// jsdom には配置計算が無く getBoundingClientRect はすべて 0 を返すので、
// 行がバーに隠れるかどうかはここでは分からない。実際の重なりは実機幅
// (iPhone 13 相当 390x844)のブラウザで、最後の行の中心座標を
// document.elementFromPoint に引いて **バーではなくその行が返ること**、
// および実際にタップしてチェックが入ることで確かめる必要がある。
//
// クラスを付ける条件を実測値(バーの高さ > 0)ではなく「バーが出ているか」に
// しているのは、この検出器を成り立たせるため。実測を条件に混ぜると、
// 配置の無い jsdom では常に 0 になり「バーが出ているのに余白が付かない」
// という肝心の不具合を、ここで捕まえられなくなる。
// ============================================================
describe('下に浮かぶバーのぶんの余白 (機能151/159)', () => {
  const root = () => document.querySelector('.hist-root') as HTMLElement
  const barred = () => root().classList.contains('hist-root-barred')
  const bar = () => document.querySelector('.hist-bottom-bar')

  it('複数選択に入ると、一覧の下にバーぶんの余白が付く(付かないと最後の行がバーに隠れて選べない)', async () => {
    const { user } = setup([tx()])
    await user.click(screen.getByRole('button', { name: '選択' }))

    expect(bar()).toBeTruthy()
    expect(barred()).toBe(true)
  })

  it('選択をやめると余白は外れる(バーが消えたあとまで一覧の下を空けたままにしない)', async () => {
    const { user } = setup([tx()])
    await user.click(screen.getByRole('button', { name: '選択' }))
    await user.click(screen.getByRole('button', { name: 'やめる' }))

    expect(bar()).toBeNull()
    expect(barred()).toBe(false)
  })

  it('削除直後の「元に戻す」が出ている間も余白が付く(同じ場所に浮かぶので、同じように隠す)', () => {
    setup([tx()], undefined, [tx({ id: 'gone' })])

    expect(screen.getByText('1件を削除しました')).toBeTruthy()
    expect(bar()).toBeTruthy()
    expect(barred()).toBe(true)
  })

  it('バーが出ていないときは付かない(いつも空けると、一覧の下が理由なく空く)', () => {
    setup([tx()])

    expect(bar()).toBeNull()
    expect(barred()).toBe(false)
  })

  // ------------------------------------------------------------
  // 余白の「高さ」のほう。ここだけは配置が要るので、バーの高さだけ jsdom に教える。
  //
  // 2種類のバーは同じ場所に浮かび、**片方からもう片方へ直接入れ替わる**
  // (削除直後の「元に戻す」が出ている間に、もう一度「選択」へ入る/やめる)。
  // どちらも「バーが出ている」なので、出ているかどうかの真偽では入れ替わりが見えない。
  // 真偽で測り直しを決めていたときはここで測り直しが走らず、前のバーを見ていた
  // ResizeObserver も画面から外れた要素を掴んだまま残って、以後いくらバーが伸びても
  // 実測が更新されなかった。実機幅(390x844)では、バーが 174px に伸びた場面で
  // 最後のカードがバーの下に 44px 潜った(=元の「隠れて押せない」に戻りかけた)。
  // ------------------------------------------------------------
  describe('バーが入れ替わったときの高さ', () => {
    // 高さだけは配置が要るので jsdom に教える(2段の複数選択=118px / 1段の元に戻す=66px)
    const HEIGHTS: [string, number][] = [
      ['hist-select-bar', 118],
      ['hist-undo-bar', 66],
    ]
    const barVar = () => root().style.getPropertyValue('--hist-bar-h')

    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: HTMLElement
      ) {
        const hit = HEIGHTS.find(([c]) => this.classList.contains(c))
        const height = hit === undefined ? 0 : hit[1]
        return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: height, width: 0, height } as DOMRect
      })
    })
    afterEach(() => vi.restoreAllMocks())

    it('バーの高さは実測して渡す(決め打ちに戻すと、伸びたぶんだけ行が隠れる)', async () => {
      const { user } = setup([tx()])
      await user.click(screen.getByRole('button', { name: '選択' }))

      expect(barVar()).toBe('118px')
    })

    it('「元に戻す」が出ている間に複数選択へ入ったら、2段ぶんに測り直す(足りないと行が隠れる向き)', async () => {
      const { user } = setup([tx()], undefined, [tx({ id: 'gone' })])
      expect(barVar()).toBe('66px')

      await user.click(screen.getByRole('button', { name: '選択' }))

      expect(barVar()).toBe('118px')
    })

    it('複数選択をやめて「元に戻す」だけが残ったら、1段ぶんに測り直す(余白が余ったままにならない)', async () => {
      const { user, setUndoable } = setup([tx()])
      await user.click(screen.getByRole('button', { name: '選択' }))
      expect(barVar()).toBe('118px')
      // 選択中に削除して、消したぶんが元に戻せる状態になった(バーはまだ複数選択のまま)
      setUndoable([tx({ id: 'gone' })])
      expect(barVar()).toBe('118px')

      await user.click(screen.getByRole('button', { name: 'やめる' }))

      expect(screen.getByText('1件を削除しました')).toBeTruthy()
      expect(barVar()).toBe('66px')
    })
  })
})
