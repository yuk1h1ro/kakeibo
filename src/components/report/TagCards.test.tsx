import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Transaction } from '../../lib/types'
import { monthRange } from '../../lib/report'
import EverydayCard from './EverydayCard'
import TagBreakdownCard from './TagBreakdownCard'

// この2枚のカードは「旅行を除いた普段の支出はいくらか」を答えるためにある。
// 金額が両方とも出ていること、記録が無いときに空のグラフだけにならないことを
// 実際に描画して確かめる。

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

const AUG = monthRange('2026-08')

describe('EverydayCard', () => {
  it('普段と特別のどちらも金額で出る(割合だけにしない)', () => {
    const html = renderToStaticMarkup(
      <EverydayCard
        transactions={[
          tx({ amount: 3000 }),
          tx({ amount: 42000, tags: ['旅行'] }),
        ]}
        range={AUG}
        periodLabel="今月"
      />
    )
    expect(html).toContain('¥3,000') // 普段
    expect(html).toContain('¥42,000') // 特別
    expect(html).toContain('#旅行')
  })

  it('既定の3つが選ばれた状態で始まる', () => {
    const html = renderToStaticMarkup(
      <EverydayCard transactions={[]} range={AUG} periodLabel="今月" />
    )
    expect(html).toContain('特別なタグを選ぶ(いま3個)')
  })

  it('選んだタグの記録がまだ無いときは、次に何をすればいいかを書く', () => {
    const html = renderToStaticMarkup(
      <EverydayCard transactions={[tx({ amount: 3000 })]} range={AUG} periodLabel="今月" />
    )
    expect(html).toContain('「旅行」「デート」「出張」の付いた記録がありません')
    expect(html).toContain('タグを付けると')
    // 普段の金額は出す(記録はあるので、総額として意味がある)
    expect(html).toContain('¥3,000')
  })
})

describe('TagBreakdownCard', () => {
  const props = { range: AUG, periodLabel: '今月', onPickRange: () => {} }

  it('タグ別の金額と、合計が総額と一致しない理由が出る', () => {
    const html = renderToStaticMarkup(
      <TagBreakdownCard
        {...props}
        transactions={[
          tx({ amount: 42000, tags: ['旅行'] }),
          tx({ amount: 6000, tags: ['旅行', 'デート'] }),
          tx({ amount: 2000 }),
        ]}
      />
    )
    expect(html).toContain('#旅行')
    expect(html).toContain('¥48,000')
    expect(html).toContain('タグなし')
    expect(html).toContain('多くなっています')
  })

  it('タグの付いた記録が無いときは空のグラフではなく説明を出す', () => {
    const html = renderToStaticMarkup(
      <TagBreakdownCard {...props} transactions={[tx({ amount: 2000 })]} />
    )
    expect(html).toContain('タグの付いた記録がありません')
    expect(html).toContain('カテゴリをまたいだ支出')
    expect(html).not.toContain('<svg')
  })
})
