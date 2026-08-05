import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import PartnerTab from './PartnerTab'
import type { useTransactions } from '../hooks/useTransactions'
import { partnerBalance } from '../lib/partnerBalance'
import type { Transaction } from '../lib/types'

// ============================================================
// 彼女タブ。このアプリの存在理由(預かり残高が常に正しいこと)が
// いちばん先に目に入る画面。
//
// 守りたいのは3つ:
//   1. 金額は必ず絶対値で、向きは言葉(預かり中 / 立て替え中)で伝わること
//      — 符号だけだと「預かりが減った」のか「貸しが増えた」のか読めない
//   2. 動きの履歴の1行ずつの符号が、上の残高と足し算で一致すること
//      — 共有ページでは実際にここが逆になっていた(SharePage.test.tsx 参照)
//   3. 残高に関係しない支出が「動きの履歴」に混ざらないこと
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

/** 画面が読むのは store.transactions だけ(残りは操作したときにしか触らない) */
function render(transactions: Transaction[]): string {
  const store = { transactions, add: async () => {} } as unknown as ReturnType<
    typeof useTransactions
  >
  return renderToStaticMarkup(
    <PartnerTab store={store} supabase={{} as SupabaseClient} onEdit={() => {}} />
  )
}

/** 「動きの履歴」に並んだ行の金額を、符号つきの数値にして取り出す */
function movementAmounts(html: string): number[] {
  const out: number[] = []
  for (const m of html.matchAll(/class="tx-amount[^"]*">([+-])¥([\d,]+)</g)) {
    out.push(Number(m[2].replace(/,/g, '')) * (m[1] === '+' ? 1 : -1))
  }
  return out
}

describe('彼女タブの残高の見出し', () => {
  it('預かっているときは「預かり中」と絶対値で出す', () => {
    const html = render([
      tx({ id: 'd', type: 'partner_deposit', amount: 30000, category: null, store: '' }),
      tx({ id: 'e', amount: 1000, partner_amount: 400 }),
    ])
    expect(html).toContain('預かり中')
    expect(html).toContain('¥29,600')
    expect(html).not.toContain('立て替え中')
  })

  it('使い切っているときは「立て替え中(彼女への貸し)」と、マイナスを付けない絶対値で出す', () => {
    const html = render([tx({ amount: 1000, partner_amount: 400 })])
    expect(html).toContain('立て替え中(彼女への貸し)')
    // 「−¥400」のような符号つきの見出しにしない(機能011)
    expect(html).toContain('>¥400<')
    expect(html).toContain('negative')
  })

  it('ちょうど精算できているときは「貸し借りなし」', () => {
    const html = render([
      tx({ id: 'd', type: 'partner_deposit', amount: 400, category: null, store: '' }),
      tx({ id: 'e', amount: 1000, partner_amount: 400 }),
    ])
    expect(html).toContain('貸し借りなし')
  })
})

describe('彼女タブの残高低下アラート (機能010)', () => {
  it('既定のしきい値(¥1,000)を下回ると次の預かりをうながす', () => {
    const html = render([
      tx({ id: 'd', type: 'partner_deposit', amount: 1000, category: null, store: '' }),
      tx({ id: 'e', amount: 1000, partner_amount: 500 }),
    ])
    expect(html).toContain('次の預かりをお願いするタイミングです')
    expect(html).toContain('残りが ¥1,000 を下回りました')
  })

  it('使い切っているときは「下回りました」ではなく「使い切っています」と書く', () => {
    const html = render([tx({ amount: 1000, partner_amount: 400 })])
    expect(html).toContain('預かりを使い切っています')
    expect(html).not.toContain('を下回りました')
  })

  it('しきい値以上あるときはアラートを出さない', () => {
    const html = render([
      tx({ id: 'd', type: 'partner_deposit', amount: 30000, category: null, store: '' }),
    ])
    expect(html).not.toContain('次の預かりをお願いするタイミングです')
  })
})

describe('彼女タブの「動きの履歴」', () => {
  it('残高が動いた行だけを出す(自分だけの支出は出さない)', () => {
    const html = render([
      tx({ id: 'a', store: '自分だけのコーヒー', amount: 500, partner_amount: 0 }),
      tx({ id: 'b', store: '一緒の夕飯', amount: 3000, partner_amount: 1500 }),
    ])
    expect(html).toContain('一緒の夕飯')
    expect(html).not.toContain('自分だけのコーヒー')
    expect(movementAmounts(html)).toEqual([-1500])
  })

  it('1行ずつの符号を足すと、上に出ている残高と必ず一致する', () => {
    // 1件でも符号を逆にすると、残高と明細の足し算が合わなくなる。
    // 共有ページでは実際にこれが起きていた(彼女が払った回の符号が逆だった)
    const rows = [
      tx({ id: 'd', type: 'partner_deposit', amount: 30000, category: null, store: '' }),
      tx({ id: 'e1', amount: 3000, partner_amount: 1500 }),
      tx({ id: 'e2', amount: 2000, partner_amount: 800, partner_paid: 2000 }),
      tx({ id: 'r', type: 'partner_refund', amount: 5000, category: null, store: '' }),
      tx({ id: 'j', type: 'partner_adjust', amount: -300, category: null, store: '' }),
    ]
    const html = render(rows)
    const shown = movementAmounts(html)
    expect(shown).toHaveLength(5)
    expect(shown.reduce((a, b) => a + b, 0)).toBe(partnerBalance(rows))
  })

  it('彼女が多めに払った回はプラスで出て、内訳も添える', () => {
    // 機能018。¥2,000 の会計を彼女が全額払い、彼女の負担は ¥800 だった回。
    // 残高は +¥1,200 動く
    const html = render([tx({ amount: 2000, partner_amount: 800, partner_paid: 2000 })])
    expect(movementAmounts(html)).toEqual([1200])
    expect(html).toContain('彼女が ¥2,000 払い、負担は ¥800')
  })

  it('預かりと返金は逆の符号で並ぶ', () => {
    const html = render([
      tx({ id: 'd', type: 'partner_deposit', amount: 30000, category: null, store: '' }),
      tx({ id: 'r', type: 'partner_refund', amount: 5000, category: null, store: '' }),
    ])
    expect(movementAmounts(html)).toEqual([30000, -5000])
    expect(html).toContain('彼女から預かり')
    expect(html).toContain('彼女に返金')
  })

  it('1件も無いときは空だと伝える', () => {
    const html = render([tx({ partner_amount: 0 })])
    expect(html).toContain('記録がありません')
  })
})
