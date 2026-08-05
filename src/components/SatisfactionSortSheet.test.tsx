import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SatisfactionSortSheet from './SatisfactionSortSheet'
import { splitSiblings } from '../lib/splits'
import { ownAmount } from '../lib/types'
import type { Transaction } from '../lib/types'

// ============================================================
// 気分をまとめて付ける画面 (機能143)。
//
// カードに出す金額は「自分の実質支出」で、分割した会計 (機能096) では
// **内訳をまとめた合計** になる。1回の買い物に1つの気分を付ける画面なので、
// 代表1件の金額だけを出すと「¥3,000 の会計」が「¥1,000 の会計」に見え、
// どの買い物を仕分けているのか分からなくなる。
//
// この合計の出し方は lib ではなくこの画面が持っているので、
// 純関数のテストは1件も落ちない。描いた文字列から確かめる。
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

function render(
  targets: Transaction[],
  groupOf?: (t: Transaction) => Transaction[]
): string {
  return renderToStaticMarkup(
    <SatisfactionSortSheet
      targets={targets}
      onAssign={async () => {}}
      groupOf={groupOf}
      onClose={() => {}}
    />
  )
}

/** カードの真ん中に大きく出ている金額 */
function cardAmount(html: string): string {
  const m = /class="sort-amount">([^<]*)</.exec(html)
  return m === null ? '' : m[1]
}

describe('仕分けカードに出る金額', () => {
  it('自分の実質支出で出す(彼女の負担分は自分の買い物ではない)', () => {
    // 支払い総額 ¥1,000 のうち彼女が ¥400 負担 → 自分の負担は ¥600
    expect(cardAmount(render([tx({ amount: 1000, partner_amount: 400 })]))).toBe('¥600')
  })

  it('分割した会計は内訳をまとめた合計で出す(代表1件の金額ではない)', () => {
    // 機能096。¥3,000 の会計を食費 ¥2,000 / 日用品 ¥1,000 に分けたもの
    const parts = [
      tx({ id: 's1', amount: 2000, split_group: 'g1' }),
      tx({ id: 's2', amount: 1000, category: 'daily', split_group: 'g1' }),
    ]
    const html = render([parts[0]], (t) => splitSiblings(parts, t))
    expect(cardAmount(html)).toBe('¥3,000')
    expect(html).toContain('分割2件をまとめて付けます')
  })

  it('分割の合計も、彼女の負担分を引いた額で出す', () => {
    const parts = [
      tx({ id: 's1', amount: 2000, partner_amount: 800, split_group: 'g1' }),
      tx({ id: 's2', amount: 1000, partner_amount: 200, category: 'daily', split_group: 'g1' }),
    ]
    const html = render([parts[0]], (t) => splitSiblings(parts, t))
    // 期待値も画面と同じ式(ownAmount)から作る。式そのものは lib で守られている
    expect(cardAmount(html)).toBe('¥2,000')
    expect(parts.reduce((s, t) => s + ownAmount(t), 0)).toBe(2000)
  })

  it('分割でない記録には、分割の注記を出さない', () => {
    expect(render([tx()])).not.toContain('まとめて付けます')
  })
})

describe('仕分けの進み具合', () => {
  it('残りの件数を出す(あと何回押せば終わるか分かるように)', () => {
    expect(render([tx({ id: 'a' }), tx({ id: 'b' }), tx({ id: 'c' })])).toContain('残り 3件')
  })

  it('対象が1件も無いときは、仕分ける記録が無いことを伝える', () => {
    const html = render([])
    expect(html).toContain('仕分ける記録はありません')
    expect(html).not.toContain('残り')
  })

  it('右へ払うと満足・左へ払うと後悔、ボタンでも付けられることを書く', () => {
    // 指の動きに意味があることは、画面のどこかに書いていないと伝わらない
    const html = render([tx()])
    expect(html).toContain('右へ払うと「満足」、左へ払うと「後悔」')
    expect(html).toContain('満足')
    expect(html).toContain('普通')
    expect(html).toContain('後悔')
  })
})

describe('仕分けカードが示す「どの買い物か」', () => {
  it('お店・日付・カテゴリを出す(思い出せないと気分は付けられない)', () => {
    const html = render([tx({ store: 'スーパー', date: '2026-08-03' })])
    expect(html).toContain('スーパー')
    expect(html).toContain('8月3日')
    expect(html).toContain('食費')
  })

  it('お店もメモも無いときはカテゴリ名を見出しにする', () => {
    expect(render([tx({ store: '', memo: '' })])).toContain('食費')
  })
})
