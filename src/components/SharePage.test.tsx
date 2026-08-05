import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShareContent } from './SharePage'
import type { ShareCharge, ShareSnapshot } from '../lib/shareView'
import { chargeImpact } from '../lib/shareCharges'

// 共有ページは彼女しか見ないので、崩れても利用者は気付けない。
// 「符号」と「利用者個人の支出が出ていないこと」だけは描画して確かめる。
//
// ここは実際に符号が逆になっていた画面でもある。彼女が払った回が
// 「あなたの分として引かれたもの」にマイナスで並び、利用者側の画面
// (PartnerTab)とは逆の符号になっていた。lib のテストは1件も落ちなかった。

function snapshot(over: Partial<ShareSnapshot> = {}): ShareSnapshot {
  return {
    balance: 12000,
    deposits: [{ id: 'd1', date: '2026-08-01', amount: 30000 }],
    settlements: [],
    charges: [],
    comments: [],
    expiresAt: null,
    maxCommentLength: 300,
    ...over,
  }
}

function render(data: ShareSnapshot): string {
  return renderToStaticMarkup(
    <ShareContent data={data} token={'t'.repeat(48)} onAppendComment={() => {}} />
  )
}

function charge(over: Partial<ShareCharge> = {}): ShareCharge {
  return {
    id: 'c1',
    date: '2026-08-02',
    store: 'スーパー',
    amount: 1000,
    paid: 0,
    category: 'food',
    categoryLabel: '食費',
    ...over,
  }
}

/** 明細に並んだ金額を、符号つきの数値にして取り出す */
function shownAmounts(html: string): number[] {
  const out: number[] = []
  for (const m of html.matchAll(/class="share-row-amount[^"]*">([+-]?)¥([\d,]+)</g)) {
    out.push(Number(m[2].replace(/,/g, '')) * (m[1] === '-' ? -1 : 1))
  }
  return out
}

describe('共有ページの明細の符号', () => {
  it('利用者が払った回はマイナスで「引かれたもの」に出る', () => {
    const html = render(
      snapshot({
        charges: [
          {
            id: 'c1',
            date: '2026-08-02',
            store: 'スーパー',
            amount: 1000,
            paid: 0,
            category: 'food',
            categoryLabel: '食費',
          },
        ],
      })
    )
    expect(html).toContain('あなたの分として引かれたもの')
    expect(html).toContain('-¥1,000')
    expect(html).not.toContain('+¥1,000')
  })

  it('彼女が全額払い負担が0の回は、金額が「—」にならず残高が増えると分かる', () => {
    const html = render(
      snapshot({
        charges: [
          {
            id: 'c2',
            date: '2026-08-03',
            store: 'カフェ',
            amount: 0,
            paid: 3000,
            category: null,
            categoryLabel: null,
          },
        ],
      })
    )
    expect(html).toContain('あなたが払ってくれたお会計')
    expect(html).toContain('+¥3,000')
    expect(html).not.toContain('-¥3,000')
    expect(html).not.toContain('—')
  })

  it('彼女が多めに払った回は、差額だけプラスで出る(利用者側の画面と同じ符号)', () => {
    const html = render(
      snapshot({
        charges: [
          {
            id: 'c3',
            date: '2026-08-03',
            store: '居酒屋',
            amount: 1200,
            paid: 3000,
            category: 'eating_out',
            categoryLabel: '外食',
          },
        ],
      })
    )
    expect(html).toContain('+¥1,800')
    expect(html).toContain('あなたが ¥3,000 払い')
  })

  it('彼女が払った回は「引かれたもの」の節に混ざらない', () => {
    const html = render(
      snapshot({
        charges: [
          {
            id: 'c4',
            date: '2026-08-03',
            store: '居酒屋',
            amount: 1200,
            paid: 3000,
            category: null,
            categoryLabel: null,
          },
        ],
      })
    )
    const deducted = html.slice(
      html.indexOf('あなたの分として引かれたもの'),
      html.indexOf('あなたが払ってくれたお会計')
    )
    expect(deducted).toContain('まだありません')
  })

  it('預かり・返金・調整はこれまでどおり出る', () => {
    const html = render(
      snapshot({
        settlements: [
          { id: 's1', date: '2026-08-03', kind: 'partner_refund', amount: -20000, memo: '' },
        ],
      })
    )
    expect(html).toContain('あずかりました')
    expect(html).toContain('+¥30,000')
    expect(html).toContain('あなたに返しました')
    expect(html).toContain('-¥20,000')
  })

  it('支払い総額のような、彼女に関係しない金額は出ない', () => {
    const html = render(
      snapshot({
        charges: [
          {
            id: 'c5',
            date: '2026-08-03',
            store: 'スーパー',
            amount: 1000,
            paid: 0,
            category: 'food',
            categoryLabel: '食費',
          },
        ],
      })
    )
    // 5,800円の会計のうち彼女の負担が1,000円でも、総額はサーバーから届かない
    expect(html).not.toContain('5,800')
  })
})

describe('共有ページの残高と明細の整合', () => {
  it('明細の金額を全部足すと、上に出ている「のこり」と一致する', () => {
    // 1件でも符号を取り違えると、彼女の画面では
    // 「並んでいる金額を足しても、上の残高にならない」という形で必ず現れる。
    // 実際に起きた不具合(彼女が払った回の符号が逆)はこの足し算を壊していた
    const charges = [
      charge({ id: 'c1', amount: 1000, paid: 0 }),
      charge({ id: 'c2', amount: 800, paid: 2000, store: '居酒屋' }),
    ]
    const deposits = [{ id: 'd1', date: '2026-08-01', amount: 30000 }]
    const settlements = [
      { id: 's1', date: '2026-08-05', kind: 'partner_refund' as const, amount: -20000, memo: '' },
    ]
    const balance =
      deposits[0].amount +
      charges.reduce((s, c) => s + chargeImpact(c), 0) +
      settlements[0].amount
    const html = render(snapshot({ balance, charges, deposits, settlements }))

    expect(shownAmounts(html)).toHaveLength(4)
    expect(shownAmounts(html).reduce((a, b) => a + b, 0)).toBe(balance)
  })

  it('ちょうど相殺した回は「—」ではなく ¥0 と書く(動いたのか読めるように)', () => {
    // 彼女が自分の負担分ぴったりを払った回。のこりは動かない
    const html = render(snapshot({ charges: [charge({ amount: 1200, paid: 1200 })] }))
    expect(html).toContain('>¥0<')
    expect(html).toContain('ちょうどなので、のこりは動きません')
  })
})

describe('共有ページの「のこり」の言い方 (機能011)', () => {
  it('あずかっている間は「あずけているお金ののこり」', () => {
    const html = render(snapshot({ balance: 12000 }))
    expect(html).toContain('あずけているお金ののこり')
    expect(html).toContain('¥12,000')
  })

  it('使い切っているときは「たてかえてもらっている分」と、符号を付けない絶対値で出す', () => {
    // 主語が彼女側になるので、利用者側の「立て替え中(彼女への貸し)」とは別の言い回しになる
    const html = render(snapshot({ balance: -3000 }))
    expect(html).toContain('たてかえてもらっている分')
    expect(html).toContain('>¥3,000<')
    expect(html).not.toContain('-¥3,000<')
    expect(html).toContain('negative')
  })

  it('ちょうど精算できているときは「かしかりなし」', () => {
    expect(render(snapshot({ balance: 0 }))).toContain('かしかりなし')
  })
})

describe('共有ページの節の出し分け', () => {
  it('彼女が払った回が1件も無いときは、その節ごと出さない', () => {
    const html = render(snapshot({ charges: [charge({ paid: 0 })] }))
    expect(html).not.toContain('あなたが払ってくれたお会計')
  })

  it('返金・調整が1件も無いときは、その節ごと出さない(古いサーバーでも崩れない)', () => {
    expect(render(snapshot({ settlements: [] }))).not.toContain('返したお金・直したところ')
  })

  it('調整は向きが見出しで分かり、理由もそのまま出る', () => {
    const html = render(
      snapshot({
        settlements: [
          {
            id: 's1',
            date: '2026-08-05',
            kind: 'partner_adjust',
            amount: -700,
            memo: '7/3 の割り勘の計算違いを直しました',
          },
        ],
      })
    )
    expect(html).toContain('のこりを減らす直し')
    expect(html).toContain('-¥700')
    expect(html).toContain('7/3 の割り勘の計算違いを直しました')

    const plus = render(
      snapshot({
        settlements: [
          { id: 's2', date: '2026-08-05', kind: 'partner_adjust', amount: 700, memo: '' },
        ],
      })
    )
    expect(plus).toContain('のこりを増やす直し')
    expect(plus).toContain('+¥700')
  })

  it('あずかりが1件も無いときは、節は残したまま「まだありません」と書く', () => {
    const html = render(snapshot({ deposits: [] }))
    expect(html).toContain('あなたがあずけたお金')
    expect(html).toContain('まだありません')
  })
})

describe('共有ページのコメント (機能185)', () => {
  it('コメントは、それが付いた記録の下だけに出る', () => {
    const html = render(
      snapshot({
        charges: [
          charge({ id: 'c1', store: 'スーパー' }),
          charge({ id: 'c2', store: 'ドラッグストア' }),
        ],
        comments: [
          {
            id: 'm1',
            transactionId: 'c1',
            author: 'partner',
            body: 'これ何のこと?',
            createdAt: '2026-08-03T05:00:00.000Z',
          },
        ],
      })
    )
    const first = html.slice(html.indexOf('スーパー'), html.indexOf('ドラッグストア'))
    expect(first).toContain('これ何のこと?')
    expect(html.slice(html.indexOf('ドラッグストア'))).not.toContain('これ何のこと?')
  })

  it('あずけたお金の行にもコメントを付けられる', () => {
    const html = render(
      snapshot({
        comments: [
          {
            id: 'm2',
            transactionId: 'd1',
            author: 'owner',
            body: '受け取りました',
            createdAt: '2026-08-01T05:00:00.000Z',
          },
        ],
      })
    )
    expect(html.slice(html.indexOf('あずかりました'))).toContain('受け取りました')
  })
})
