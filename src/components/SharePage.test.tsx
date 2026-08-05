import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ShareContent } from './SharePage'
import type { ShareSnapshot } from '../lib/shareView'

// 共有ページは彼女しか見ないので、崩れても利用者は気付けない。
// 「符号」と「利用者個人の支出が出ていないこと」だけは描画して確かめる。

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
