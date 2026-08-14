import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Transaction } from '../../lib/types'
import { monthRange } from '../../lib/report'
import FavorCard from './FavorCard'

// ============================================================
// おごり・値引きの振り返り。
//
// このカードの主役は金額ではなく **人**。
// 「誰に・何回・いくらぶん・最後はいつ」が出ていることと、
// ここの額が支出の合計ではないと読めることを、実際に描いて確かめる。
// ============================================================

let seq = 0
function tx(p: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: `id${seq}`,
    date: '2026-08-10',
    type: 'expense',
    amount: 1000,
    category: 'food',
    memo: '',
    store: '',
    partner_amount: 0,
    created_at: '2026-08-10T03:00:00.000Z',
    ...p,
  }
}

const treated = (p: Partial<Transaction> = {}): Transaction =>
  tx({ amount: 0, favor_amount: 3200, favor_kind: 'treat', favor_from: '田中', ...p })

const AUG = monthRange('2026-08')

const render = (txs: Transaction[]): string =>
  renderToStaticMarkup(<FavorCard transactions={txs} range={AUG} periodLabel="今月" />)

describe('FavorCard', () => {
  it('おごり・値引きが1件も無ければ、カードごと出さない', () => {
    expect(render([tx({ amount: 1000 })])).toBe('')
  })

  it('誰に・何回・いくらぶん・最後はいつ、を出す', () => {
    const html = render([
      treated({ date: '2026-08-03', favor_amount: 1000 }),
      treated({ date: '2026-08-20', favor_amount: 2000 }),
    ])
    expect(html).toContain('田中さん')
    expect(html).toContain('¥3,000')
    expect(html).toContain('2回')
    expect(html).toContain('8月20日')
  })

  it('人ごとに分けて出す(合計だけにしない)', () => {
    const html = render([
      treated({ favor_amount: 3000, favor_from: '田中' }),
      treated({ favor_amount: 1200, favor_from: '佐藤' }),
    ])
    expect(html).toContain('田中さん')
    expect(html).toContain('佐藤さん')
  })

  it('値引きだけの月でも、おごりが無いことを言葉で出す(空欄にしない)', () => {
    const html = render([tx({ amount: 2500, favor_amount: 500, favor_kind: 'discount' })])
    expect(html).toContain('ご馳走になった記録はありません')
    expect(html).toContain('¥500')
  })

  it('ここの額が支出ではないことを必ず書く(上の合計と足せてしまわないように)', () => {
    expect(render([treated()])).toContain('支出の合計には入っていません')
  })

  it('期間の外のおごりは数えない', () => {
    expect(render([treated({ date: '2026-07-31' })])).toBe('')
  })
})
