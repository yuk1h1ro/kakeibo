// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HistoryTab from './HistoryTab'
import type { useTransactions } from '../hooks/useTransactions'
import { formatMonth, monthKey, todayISO } from '../lib/format'
import { shiftMonth } from '../lib/calendar'
import { HISTORY_VIEW_KEY, clearHistoryView } from '../lib/historyView'
import { LONG_PRESS_MS } from '../lib/rowGesture'
import type { Transaction } from '../lib/types'

// ============================================================
// 履歴タブの上部の作り直し(月の帯・一覧表示・期間のチップ・未同期の一覧)。
//
// ここで固定すること:
//   ・既定は「一覧」。その月の記録が日付の見出しで区切られて新しい順に並ぶ。
//     見出しの額はカレンダーのマスと同じ「自分の分」。選んだ見え方は端末に残る
//   ・月の帯の上で左右に払うと月が変わる(左 = 次の月、右 = 前の月)。
//     複数選択中・シート表示中・全期間の検索中は払っても変わらない
//   ・複数選択中に月を変えたら選択モードから抜ける。抜けないと、前の月で選んだ行が
//     **見えないまま選ばれ続け**、そのまま削除すると見えていない記録が消えていた(実測)
//   ・検索結果の見出しに期間のチップ(すべて / M月だけ / 直近3ヶ月)が出る。
//     期間が「すべて」の間は月の見出しを「全期間から検索中」に差し替える
//   ・まだ送れていない記録があるときだけ「⚠ 未同期 N件」が出て、押すと中身が見える
//
// jsdom には PointerEvent が無い(素の Event になり clientX が落ちる)ので、
// 帯を払う指は MouseEvent に pointerId / pointerType を足して自分で投げる。
// 実際にタッチで払えるか(touch-action: pan-y が効くか)は実機幅のブラウザで確かめている。
// ============================================================

afterEach(cleanup)
afterEach(() => clearHistoryView())

// jsdom は window.scrollTo を実装していない(シートを閉じるときの背面固定の解除で呼ばれる)
window.scrollTo = () => {}

const TODAY = todayISO()
const THIS_MONTH = monthKey(TODAY)
const LAST_MONTH = shiftMonth(THIS_MONTH, -1)

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
    created_at: `${TODAY}T01:00:00.000Z`,
    ...over,
  }
}

interface StoreExtras {
  pendingIds?: ReadonlySet<string>
  pendingDeleteCount?: number
  syncing?: boolean
  isOnline?: boolean
}

function makeStore(transactions: Transaction[], extras: StoreExtras = {}) {
  const removed: Transaction[][] = []
  const syncNow = vi.fn(async () => {})
  const store = {
    transactions,
    add: async () => {},
    updateMany: async () => {},
    removeMany: async (rows: Transaction[]) => {
      removed.push(rows)
    },
    undoableDeletes: null,
    undoDelete: async () => {},
    syncNow,
    lastSyncedAt: null,
    pendingIds: new Set<string>(),
    pendingDeleteCount: 0,
    syncing: false,
    isOnline: true,
    ...extras,
  } as unknown as ReturnType<typeof useTransactions>
  return { store, removed, syncNow }
}

function setup(
  transactions: Transaction[],
  extras: StoreExtras = {},
  storePrefill?: { nonce: number; store: string }
) {
  const made = makeStore(transactions, extras)
  const view = render(
    <HistoryTab
      store={made.store}
      onEdit={() => {}}
      onStartInput={() => {}}
      storePrefill={storePrefill}
    />
  )
  return { ...made, view, user: userEvent.setup() }
}

/** 月の見出しに出ている年月 */
const monthTitle = () =>
  document.querySelector('.hist-month-title')?.textContent?.replace('▼', '') ?? null

const band = () => document.querySelector('.hist-band') as HTMLElement

function pointer(type: string, x: number, y: number) {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  })
  Object.defineProperty(ev, 'pointerId', { value: 7 })
  Object.defineProperty(ev, 'pointerType', { value: 'touch' })
  return ev
}

/** 要素の上で横に払う(左 = 負)。帯のリスナーは素の addEventListener なので act で包む */
function swipeOn(target: Element, dx: number) {
  act(() => {
    target.dispatchEvent(pointer('pointerdown', 150, 100))
    target.dispatchEvent(pointer('pointerup', 150 + dx, 104))
  })
}

/** 一覧に並んでいる行の店名(上から順) */
const listedStores = () =>
  [...document.querySelectorAll('.hist-row .tx-title')].map((el) => el.textContent)

describe('一覧表示(既定)', () => {
  const rows = () => [
    tx({
      id: 'a',
      date: `${THIS_MONTH}-01`,
      store: '一日目',
      created_at: `${THIS_MONTH}-01T00:00:00.000Z`,
    }),
    tx({ id: 'b', date: TODAY, store: '今日の朝', created_at: `${TODAY}T06:00:00.000Z` }),
    tx({ id: 'c', date: TODAY, store: '今日の夜', created_at: `${TODAY}T12:00:00.000Z` }),
    // 先月の記録は今月の一覧に混ざらない
    tx({
      id: 'old',
      date: `${LAST_MONTH}-15`,
      store: '先月',
      created_at: `${LAST_MONTH}-15T01:00:00.000Z`,
    }),
  ]

  it('開いた時点で、その月の記録が新しい順に並ぶ(カレンダーで日を選ばなくても見える)', () => {
    setup(rows())
    // 今日が1日なら「一日目」も今日の記録だが、入れた時刻がいちばん古いので並びは同じ
    expect(listedStores()).toEqual(['今日の夜', '今日の朝', '一日目'])
    expect(screen.queryByText('先月')).toBeNull()
    // カレンダーは出ていない
    expect(document.querySelector('.cal-card')).toBeNull()
  })

  it('日付の見出しで区切り、見出しの額はカレンダーのマスと同じ「自分の分」', () => {
    setup([
      tx({ id: 'a', amount: 2000, partner_amount: 800 }),
      tx({ id: 'b', amount: 500, partner_amount: 0 }),
    ])
    const heads = [...document.querySelectorAll('.hist-day-head')]
    expect(heads).toHaveLength(1)
    // 2000-800 + 500 = 1,700
    expect(heads[0].querySelector('.hist-day-total')?.textContent).toBe('¥1,700')
    expect(heads[0].textContent).toContain('今日')
  })

  it('「カレンダー」に切り替えると従来の見え方になり、その選択は端末に残る', async () => {
    const { user } = setup(rows())
    await user.click(screen.getByRole('button', { name: 'カレンダー' }))

    expect(document.querySelector('.cal-card')).toBeTruthy()
    expect(localStorage.getItem(HISTORY_VIEW_KEY)).toBe('calendar')
    // 日付の見出しで区切った一覧ではなく、選んだ日の明細になる
    expect(document.querySelector('.hist-day-head')).toBeNull()
    expect(screen.getByText('日付をタップで明細・左右に払って月を移動')).toBeTruthy()

    // 開き直してもカレンダーのまま
    cleanup()
    setup(rows())
    expect(document.querySelector('.cal-card')).toBeTruthy()
  })

  it('一覧でも複数選択ができる(全部 = その月に並んでいる行すべて)', async () => {
    const { user } = setup(rows())
    await user.click(screen.getByRole('button', { name: '選択' }))
    await user.click(screen.getByRole('button', { name: '全部' }))
    expect(screen.getByText('3件を選択中')).toBeTruthy()
  })

  it('まだ送れていない記録には一覧でも「未同期」が付く', () => {
    setup(rows(), { pendingIds: new Set(['b']) })
    const row = screen.getByText('今日の朝').closest('.hist-row') as HTMLElement
    expect(row.textContent).toContain('未同期')
    const other = screen.getByText('今日の夜').closest('.hist-row') as HTMLElement
    expect(other.textContent).not.toContain('未同期')
  })

  it('記録が多い月は新しいほうから200件だけ描き、そう書く(検索結果と同じ上限)', () => {
    const many = Array.from({ length: 205 }, (_, i) =>
      tx({
        id: `m${i}`,
        store: `店${i}`,
        created_at: `${TODAY}T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`,
      })
    )
    setup(many)
    expect(document.querySelectorAll('.hist-row')).toHaveLength(200)
    expect(screen.getByText(/新しいほうから200件だけ表示しています/)).toBeTruthy()
    // 件数の見出しは月の全件
    expect(screen.getByText(/の記録 205件/)).toBeTruthy()
  })

  it('記録の無い月はそう言う', () => {
    setup([])
    expect(screen.getByText('この月の記録はありません')).toBeTruthy()
  })
})

describe('月の帯を左右に払って月を送る', () => {
  it('右へ払うと前の月、左へ払うと次の月(レポートと同じ向き)', () => {
    setup([tx()])
    expect(monthTitle()).toBe(formatMonth(THIS_MONTH))

    swipeOn(band().querySelector('.hist-band-totals') as Element, 120)
    expect(monthTitle()).toBe(formatMonth(LAST_MONTH))

    swipeOn(band().querySelector('.hist-band-totals') as Element, -120)
    expect(monthTitle()).toBe(formatMonth(THIS_MONTH))
  })

  it('カレンダーの上で払っても月が変わる', async () => {
    const { user } = setup([tx()])
    await user.click(screen.getByRole('button', { name: 'カレンダー' }))
    swipeOn(document.querySelector('.cal-grid') as Element, 120)
    expect(monthTitle()).toBe(formatMonth(LAST_MONTH))
  })

  it('今月より先へは進まず、帯を跳ね返して「この先は無い」と見せる', () => {
    setup([tx()])
    swipeOn(band().querySelector('.hist-band-totals') as Element, -120)
    expect(monthTitle()).toBe(formatMonth(THIS_MONTH))
    expect(document.querySelector('.hist-band-inner')?.classList.contains('is-bouncing')).toBe(true)
  })

  it('送った向きから滑り込ませる(前の月 = 左から)', () => {
    setup([tx()])
    swipeOn(band(), 120)
    expect(document.querySelector('.hist-band-month')?.classList.contains('slide-prev')).toBe(true)
    expect(document.querySelector('.hist-list-card')?.classList.contains('slide-prev')).toBe(true)
  })

  it('明細の行の上で横に払っても月は変わらない(行の左右は削除・編集のもの)', () => {
    setup([tx()])
    const row = document.querySelector('.hist-row') as HTMLElement
    swipeOn(row, 120)
    expect(monthTitle()).toBe(formatMonth(THIS_MONTH))
  })

  it('縦に大きく動いた指では月は変わらない', () => {
    setup([tx()])
    act(() => {
      band().dispatchEvent(pointer('pointerdown', 150, 100))
      band().dispatchEvent(pointer('pointerup', 230, 200))
    })
    expect(monthTitle()).toBe(formatMonth(THIS_MONTH))
  })

  it('複数選択中は払っても月は変わらない(選んだ行が月ごと入れ替わらないように)', async () => {
    const { user } = setup([tx()])
    await user.click(screen.getByRole('button', { name: '選択' }))
    swipeOn(band(), 120)
    expect(monthTitle()).toBe(formatMonth(THIS_MONTH))
    expect(screen.getByText('0件を選択中')).toBeTruthy()
  })

  it('年月ピッカーを開いている間は払っても月は変わらない', async () => {
    const { user } = setup([tx()])
    await user.click(screen.getByRole('button', { name: /年.*月/, expanded: undefined }))
    expect(screen.getByRole('heading', { name: '年月を選ぶ' })).toBeTruthy()
    swipeOn(band(), 120)
    expect(monthTitle()).toBe(formatMonth(THIS_MONTH))
  })

  it('全期間で検索している間は、見出しを「全期間から検索中」にして矢印も払いも止める', async () => {
    const { user } = setup([tx()])
    await user.type(screen.getByLabelText('記録を検索'), 'スーパー')
    expect(await screen.findByText('全期間から検索中')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '前の月' })).toBeNull()
    expect(screen.queryByRole('button', { name: '次の月' })).toBeNull()

    swipeOn(band(), 120)
    // 期間を「この月だけ」に戻すと、送っていない元の月の見出しが出る
    await user.click(screen.getByRole('button', { name: `${Number(THIS_MONTH.slice(5))}月だけ` }))
    expect(monthTitle()).toBe(formatMonth(THIS_MONTH))
  })
})

describe('複数選択中に月を変えたら選択モードから抜ける', () => {
  // 先月に2件、今月に1件
  const rows = () => [
    tx({ id: 'p1', date: `${LAST_MONTH}-10`, store: '先月A' }),
    tx({ id: 'p2', date: `${LAST_MONTH}-11`, store: '先月B' }),
    tx({ id: 'n1', store: '今月' }),
  ]

  it('← で月を変えると選択は解かれ、前の月で選んだ行がまとめて消せる状態で残らない', async () => {
    const { user, removed } = setup(rows())
    await user.click(screen.getByRole('button', { name: '前の月' }))
    await user.click(screen.getByRole('button', { name: '選択' }))
    await user.click(screen.getByRole('button', { name: '全部' }))
    expect(screen.getByText('2件を選択中')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '次の月' }))

    // 選択のバーは消え、今月の一覧に戻っている
    expect(screen.queryByText(/件を選択中/)).toBeNull()
    expect(document.querySelector('.hist-select-bar')).toBeNull()
    expect(listedStores()).toEqual(['今月'])
    expect(removed).toHaveLength(0)
  })

  it('年月ピッカーから月を変えても抜ける', async () => {
    const { user } = setup(rows())
    await user.click(screen.getByRole('button', { name: '選択' }))
    expect(screen.getByText('0件を選択中')).toBeTruthy()
    await user.click(document.querySelector('.hist-month-title') as HTMLElement)
    // 年が違えば年を送ってから選ぶ
    if (LAST_MONTH.slice(0, 4) !== THIS_MONTH.slice(0, 4)) {
      await user.click(screen.getByRole('button', { name: '前の年' }))
    }
    const picker = document.querySelector('.modal-sheet') as HTMLElement
    await user.click(within(picker).getByRole('button', { name: formatMonth(LAST_MONTH) }))
    expect(monthTitle()).toBe(formatMonth(LAST_MONTH))
    expect(screen.queryByText(/件を選択中/)).toBeNull()
  })

  it('一覧｜カレンダーを切り替えても抜ける(並んでいる行が入れ替わるため)', async () => {
    const { user } = setup(rows())
    await user.click(screen.getByRole('button', { name: '選択' }))
    await user.click(screen.getByRole('button', { name: '全部' }))
    await user.click(screen.getByRole('button', { name: 'カレンダー' }))
    expect(screen.queryByText(/件を選択中/)).toBeNull()
  })
})

describe('検索結果の期間のチップ', () => {
  const rows = () => [
    tx({ id: 'now', store: 'ライフ', amount: 1000, partner_amount: 0 }),
    tx({ id: 'last', date: `${LAST_MONTH}-15`, store: 'ライフ', amount: 300, partner_amount: 0 }),
    tx({
      id: 'old',
      date: `${shiftMonth(THIS_MONTH, -5)}-15`,
      store: 'ライフ',
      amount: 50,
      partner_amount: 0,
    }),
  ]
  const head = () => (document.querySelector('.hist-result-head') as HTMLElement).textContent

  it('レポートのお店別から来たときは全期間のまま開き、チップ1回でその月だけにできる', async () => {
    const { user } = setup(rows(), {}, { nonce: 1, store: 'ライフ' })
    expect(head()).toContain('検索結果 3件')
    expect(head()).toContain('¥1,350')
    expect(screen.getByText('全期間から検索中')).toBeTruthy()
    const all = screen.getByRole('button', { name: 'すべて' })
    expect(all.getAttribute('aria-pressed')).toBe('true')

    await user.click(screen.getByRole('button', { name: `${Number(THIS_MONTH.slice(5))}月だけ` }))
    expect(head()).toContain('検索結果 1件')
    expect(head()).toContain('¥1,000')
    // 見出しは月送りに戻る(この月を基準に絞っているので、← → で動かせる)
    expect(monthTitle()).toBe(formatMonth(THIS_MONTH))
    expect(screen.queryByText('全期間から検索中')).toBeNull()
  })

  it('直近3ヶ月', async () => {
    const { user } = setup(rows(), {}, { nonce: 1, store: 'ライフ' })
    await user.click(screen.getByRole('button', { name: '直近3ヶ月' }))
    expect(head()).toContain('検索結果 2件')
  })

  it('期間を「この月」にしたまま帯を払うと、検索結果も前の月に動く', async () => {
    const { user } = setup(rows(), {}, { nonce: 1, store: 'ライフ' })
    await user.click(screen.getByRole('button', { name: `${Number(THIS_MONTH.slice(5))}月だけ` }))
    swipeOn(band(), 120)
    expect(monthTitle()).toBe(formatMonth(LAST_MONTH))
    expect(head()).toContain('検索結果 1件')
    expect(head()).toContain('¥300')
  })

  it('検索していないときはチップを出さない', () => {
    setup(rows())
    expect(screen.queryByRole('group', { name: '探す期間' })).toBeNull()
  })
})

describe('未同期の記録', () => {
  const rows = () => [
    tx({ id: 'sent', store: '送れた店' }),
    tx({ id: 'wait', store: '圏外で入れた店', amount: 1500, partner_amount: 0 }),
  ]

  it('送れていない記録が無ければ何も出さない', () => {
    setup(rows())
    expect(document.querySelector('.hist-unsynced-chip')).toBeNull()
  })

  it('残っているときは件数を出し、押すと中身(日付・内容・金額)と削除の件数が見える', async () => {
    const { user } = setup(rows(), { pendingIds: new Set(['wait']), pendingDeleteCount: 1 })
    await user.click(screen.getByRole('button', { name: /⚠ 未同期 2件/ }))

    const sheet = screen.getByRole('dialog', { name: 'まだ送れていない記録' })
    const items = within(sheet).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0].textContent).toContain('圏外で入れた店')
    expect(items[0].textContent).toContain('-¥1,500')
    expect(within(sheet).queryByText('送れた店')).toBeNull()
    expect(within(sheet).getByText(/削除 1件/)).toBeTruthy()
  })

  it('「いま送る」で保留分を送る', async () => {
    const { user, syncNow } = setup(rows(), { pendingIds: new Set(['wait']) })
    await user.click(screen.getByRole('button', { name: /⚠ 未同期 1件/ }))
    await user.click(screen.getByRole('button', { name: 'いま送る' }))
    expect(syncNow).toHaveBeenCalledTimes(1)
  })

  it('オフラインの間は「いま送る」を押せない(押しても失敗するだけ)', async () => {
    const { user } = setup(rows(), { pendingIds: new Set(['wait']), isOnline: false })
    await user.click(screen.getByRole('button', { name: /⚠ 未同期 1件/ }))
    const btn = screen.getByRole('button', {
      name: 'オフラインのため送れません',
    }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('送っている最中に積まれた分は出さない(入れるたびに帯が一瞬伸び縮みしないように)', () => {
    setup(rows(), { pendingIds: new Set(['wait']), syncing: true })
    expect(document.querySelector('.hist-unsynced-chip')).toBeNull()
  })
})

describe('更新と変更履歴(最上段の1行を畳んだ先)', () => {
  it('検索欄の右のボタンからシートを開き、いま更新できる', async () => {
    const { user, syncNow } = setup([tx()])
    // 最上段の「変更履歴」「⟳」の行はもう無い
    expect(document.querySelector('.hist-sync-line')).toBeNull()
    await user.click(screen.getByRole('button', { name: /更新と変更履歴/ }))
    const sheet = screen.getByRole('dialog', { name: '更新と変更履歴' })
    await user.click(within(sheet).getByRole('button', { name: /いま更新する/ }))
    expect(syncNow).toHaveBeenCalledTimes(1)
  })

  it('未同期の記録があれば、シートからその一覧へ行ける', async () => {
    const { user } = setup([tx()], { pendingIds: new Set(['t1']) })
    await user.click(screen.getByRole('button', { name: /更新と変更履歴/ }))
    await user.click(screen.getByRole('button', { name: /未同期の記録 1件を見る/ }))
    expect(screen.getByRole('dialog', { name: 'まだ送れていない記録' })).toBeTruthy()
  })
})

describe('絞り込みの入口', () => {
  it('何も絞っていないときは「何で絞っているか」の行を出さない(場所を取らない)', () => {
    setup([tx()])
    expect(document.querySelector('.hist-filter-state-line')).toBeNull()
  })

  it('絞っている間は入口の色が変わり、何で絞っているかが1行で出る', async () => {
    setup([tx()], {}, { nonce: 1, store: 'スーパー' })
    const btn = screen.getByRole('button', { name: '絞り込み・並べ替え' })
    expect(btn.classList.contains('is-on')).toBe(true)
    expect(document.querySelector('.hist-filter-state')?.textContent).toBe('お店:スーパー / すべて')
    fireEvent.click(btn)
    expect(screen.getByRole('button', { name: '絞り込みを解除' })).toBeTruthy()
  })
})

// ============================================================
// 長押しでメニューを開いた指を離したとき。
//
// 指を離すとブラウザはその場所へ click を送る。メニューのシートが指の位置まで
// 届いていないと、その click は背景(押すと閉じる)に落ちて **開いた瞬間に閉じる**。
// 一覧表示で行が画面の上半分に並ぶようになって表に出た(実機幅のブラウザで、
// 上のほうの行を長押ししても何も開かないように見えた)。
// jsdom は click を合成しないので、ここでは「長押しが成立した指の touchend だけ
// 既定の動作を止めている」ことを確かめる(止めれば click は送られない)。
// ============================================================
describe('長押しのあと指を離したとき', () => {
  function touchEnd(el: Element): Event {
    const ev = new Event('touchend', { bubbles: true, cancelable: true })
    act(() => {
      el.dispatchEvent(ev)
    })
    return ev
  }

  it('長押しが成立した指の touchend は止める(背景への click でメニューが閉じないように)', async () => {
    setup([tx()])
    const row = document.querySelector('.hist-row') as HTMLElement
    vi.useFakeTimers()
    try {
      fireEvent.pointerDown(row, { pointerId: 1, clientX: 10, clientY: 10, button: 0 })
      await act(async () => {
        vi.advanceTimersByTime(LONG_PRESS_MS + 10)
      })
    } finally {
      vi.useRealTimers()
    }
    expect(screen.getByRole('heading', { name: 'この記録の操作' })).toBeTruthy()
    fireEvent.pointerUp(row, { pointerId: 1 })
    expect(touchEnd(row).defaultPrevented).toBe(true)
    expect(screen.getByRole('heading', { name: 'この記録の操作' })).toBeTruthy()
  })

  it('ふつうのタップの touchend は止めない(タップで編集が開くのを妨げない)', () => {
    setup([tx()])
    const row = document.querySelector('.hist-row') as HTMLElement
    fireEvent.pointerDown(row, { pointerId: 1, clientX: 10, clientY: 10, button: 0 })
    fireEvent.pointerUp(row, { pointerId: 1 })
    expect(touchEnd(row).defaultPrevented).toBe(false)
  })
})
