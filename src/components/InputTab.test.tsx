import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import InputTab from './InputTab'
import type { useTransactions } from '../hooks/useTransactions'
import type { Transaction } from '../lib/types'

// ============================================================
// 入力タブ。いちばん最初に開く画面で、上に預かり残高が出ている。
//
// 残高の計算そのものは partnerBalance.ts が守っているので、ここで確かめるのは
// 「その結果を正しく画面に出しているか」— 絶対値で出しているか、向きを言葉で
// 伝えているか、アラートの出し分けができているか。
// あわせて「最近の記録から入力」の重複除去(この画面にしかないロジック)も見る。
// ============================================================

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    date: '2026-08-03',
    type: 'expense',
    amount: 1000,
    category: 'food',
    memo: '',
    store: 'スーパー',
    partner_amount: 0,
    created_at: '2026-08-03T01:00:00.000Z',
    ...over,
  }
}

function render(transactions: Transaction[]): string {
  const store = { transactions } as unknown as ReturnType<typeof useTransactions>
  return renderToStaticMarkup(<InputTab store={store} supabase={{} as SupabaseClient} />)
}

/** 「最近の記録から入力」に並んだチップの見出しを取り出す */
function recentLabels(html: string): string[] {
  const section = html.slice(html.indexOf('最近の記録から入力'))
  return [...section.matchAll(/class="recent-label">([^<]*)</g)].map((m) => m[1])
}

describe('入力タブの残高カード (機能011)', () => {
  it('預かっているときは「預かり中」と絶対値で出す', () => {
    const html = render([
      tx({ id: 'd', type: 'partner_deposit', amount: 30000, category: null, store: '' }),
      tx({ id: 'e', amount: 1000, partner_amount: 400 }),
    ])
    expect(html).toContain('彼女とのお金 ・ 預かり中')
    expect(html).toContain('¥29,600')
  })

  it('使い切っているときは「立て替え中(彼女への貸し)」と出し、マイナス記号は付けない', () => {
    const html = render([tx({ amount: 1000, partner_amount: 400 })])
    expect(html).toContain('立て替え中(彼女への貸し)')
    expect(html).toContain('>¥400<')
    expect(html).not.toContain('-¥400')
  })

  it('彼女が払った回も残高に反映される(彼女タブ・共有ページと同じ額になる)', () => {
    // 機能018。¥2,000 の会計を彼女が全額払い、彼女の負担は ¥800 → 残高は +¥1,200
    const html = render([tx({ amount: 2000, partner_amount: 800, partner_paid: 2000 })])
    expect(html).toContain('預かり中')
    expect(html).toContain('¥1,200')
  })

  it('残高が少なくなったら、入力タブでも次の預かりをうながす (機能010)', () => {
    const html = render([
      tx({ id: 'd', type: 'partner_deposit', amount: 1000, category: null, store: '' }),
      tx({ id: 'e', amount: 1000, partner_amount: 500 }),
    ])
    expect(html).toContain('次の預かりをお願いするタイミングです')
  })

  it('しきい値以上あるときはアラートを出さない', () => {
    const html = render([
      tx({ id: 'd', type: 'partner_deposit', amount: 30000, category: null, store: '' }),
    ])
    expect(html).not.toContain('次の預かりをお願いするタイミングです')
  })
})

describe('入力フォームの並び(上から下がそのまま操作の順番)', () => {
  const order = (html: string, needle: string): number => html.indexOf(needle)

  it('カテゴリ → お店 → 金額 → メモ → 日付 → 保存 の順に並ぶ', () => {
    const html = render([tx()])
    const form = html.slice(html.indexOf('支出を記録'))
    const steps = [
      'カテゴリ',
      'お店(任意)',
      '支払い金額(円)',
      'メモ(任意)',
      '彼女の分もまとめて払った',
      '日付',
      '記録する',
    ].map((s) => order(form, s))
    expect(steps).toEqual([...steps].sort((a, b) => a - b))
    expect(steps.every((i) => i >= 0)).toBe(true)
  })

  it('主線(カテゴリ〜日付)は畳まれていない — 「開く」操作が縦の流れに割り込まないこと', () => {
    const html = render([tx()])
    const form = html.slice(html.indexOf('支出を記録'))
    // 折りたたみは気分・タグ・分割の1枠だけ
    expect([...form.matchAll(/class="detail-toggle"/g)]).toHaveLength(1)
  })

  it('カテゴリ未選択のときは、お店の欄でカテゴリを先に選ぶよう促す', () => {
    const html = render([tx()])
    expect(html).toContain('カテゴリを選ぶと、そのカテゴリで使ったお店が並びます')
  })
})

describe('入力タブの「最近の記録から入力」', () => {
  it('同じ(カテゴリ・金額・お店・メモ)の記録は1つにまとめる', () => {
    const html = render([
      tx({ id: 'a', store: 'セブンイレブン', amount: 500 }),
      tx({ id: 'b', store: 'セブンイレブン', amount: 500 }),
      tx({ id: 'c', store: 'スーパー', amount: 1200 }),
    ])
    expect(recentLabels(html)).toEqual(['セブンイレブン', 'スーパー'])
  })

  it('金額が違えば別の候補として出す(打ち直しの手間を減らすため)', () => {
    const html = render([
      tx({ id: 'a', store: 'セブンイレブン', amount: 500 }),
      tx({ id: 'b', store: 'セブンイレブン', amount: 800 }),
    ])
    expect(recentLabels(html)).toHaveLength(2)
  })

  it('候補は5件まで(それ以上並べても選ぶのが遅くなるだけ)', () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      tx({ id: `a${i}`, store: `お店${i}`, amount: 100 + i })
    )
    expect(recentLabels(render(rows))).toHaveLength(5)
  })

  it('預かり・返金・調整は候補に出さない(入力フォームは支出専用のため)', () => {
    const html = render([
      tx({ id: 'd', type: 'partner_deposit', amount: 30000, category: null, store: '' }),
      tx({ id: 'r', type: 'partner_refund', amount: 5000, category: null, store: '' }),
      tx({ id: 'e', store: 'スーパー' }),
    ])
    expect(recentLabels(html)).toEqual(['スーパー'])
  })

  it('支出が1件も無いときは、節ごと出さない', () => {
    const html = render([
      tx({ id: 'd', type: 'partner_deposit', amount: 30000, category: null, store: '' }),
    ])
    expect(html).not.toContain('最近の記録から入力')
  })
})
