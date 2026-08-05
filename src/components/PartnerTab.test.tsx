import { describe, expect, it, vi } from 'vitest'
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
//   4. 残高を動かす操作の入口が1か所しかないこと (機能012)
//      — 預かりと返金・調整が別々のカードに分かれていた頃は、
//        同じことをする場所が画面に2つあった
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

describe('残高を動かす記録カード (機能012)', () => {
  it('預かり・返金・調整を1枚のカードで切り替える(別の入口は作らない)', () => {
    const html = render([])
    expect(html).toContain('記録する種類')
    for (const label of ['預かる', '返す', '調整']) {
      expect(html).toContain(`>${label}</button>`)
    }
    // シートを開くためだけのボタンは廃止した
    expect(html).not.toContain('精算を記録する')
    expect(html).not.toContain('返金・受け取り・調整')
  })

  it('既定は「預かる」— いちばん使う操作なので選び直さずに打ち始められる', () => {
    const html = render([])
    expect(html).toContain('aria-pressed="true">預かる')
    expect(html).toContain('<h2>預かりを記録</h2>')
    expect(html).toContain('預かり金額(円)')
  })

  it('調整の理由が共有ページにも出ることを、記録する場所に書いておく', () => {
    // 「なぜ残高が動いたのか」を彼女からも追えるのがこの記録の値打ち。
    // 書いた内容が相手にも見えることを、書く前に伝える
    expect(render([])).toContain('共有リンクの画面にも表示されます')
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

describe('Discord通知カード', () => {
  it('どの端末で設定しても他の端末に反映されることを、設定する場所に書く', () => {
    // 「PCでは設定したが、スマホではしていない」ためにスマホからの記録だけが
    // 通知されない、という事故が実際に起きた。設定の場でそれが分かること
    const html = render([])
    expect(html).toContain('ログインしている端末すべてで共有されます')
    expect(html).toContain('解除も同じように伝わります')
  })

  it('Webhook 未設定のときは、履歴のまとめ送信の導線を出さない', () => {
    // 送り先が無いのに押させない。押しても何も起きないボタンは、
    // 「壊れている」と読まれて設定そのものを疑わせる
    const html = render([
      tx({ id: 'd', type: 'partner_deposit', amount: 30000, category: null, store: '' }),
    ])
    expect(html).not.toContain('これまでの履歴をまとめて送る')
  })

  it('同期できているかどうかが分かるまでは、未実行の注意を出さない', () => {
    // 起動直後は確かめ終わっていない。ここで注意を出すと毎回ちらつく
    const html = render([])
    expect(html).not.toContain('migration-discord-webhook.sql')
  })
})

// マイグレーション未実行の環境。txExtensions はモジュール内に判定を持つので、
// 他のテストに漏らさないよう登録簿ごと作り直して最後に置いている
// (react-dom/server も同じ登録簿から取らないと hooks が動かない)
describe('マイグレーション未実行の環境 (機能012)', () => {
  it('種類の切り替えを出さず、従来どおり預かりだけが使える', async () => {
    vi.resetModules()
    const { markTxFeatureUnavailable } = await import('../lib/txExtensions')
    markTxFeatureUnavailable('settlement')
    const [{ renderToStaticMarkup: renderFresh }, { default: FreshPartnerTab }] = await Promise.all([
      import('react-dom/server'),
      import('./PartnerTab'),
    ])
    const store = { transactions: [], add: async () => {} } as unknown as ReturnType<
      typeof useTransactions
    >
    const html = renderFresh(
      <FreshPartnerTab store={store} supabase={{} as SupabaseClient} onEdit={() => {}} />
    )
    expect(html).toContain('<h2>預かりを記録</h2>')
    expect(html).toContain('預かり金額(円)')
    // 保存できない種別を選べてしまうと、記録がサーバーに弾かれる
    expect(html).not.toContain('記録する種類')
    expect(html).not.toContain('>返す</button>')
    expect(html).not.toContain('>調整</button>')
  })
})
