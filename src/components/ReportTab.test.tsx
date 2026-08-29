// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ReportTab from './ReportTab'
import { monthKey, monthKeyOffset, todayISO } from '../lib/format'
import { totalOwn } from '../lib/report'
import { monthRange } from '../lib/report'
import type { Transaction } from '../lib/types'

// ============================================================
// レポートタブの見出しの数字。
//
// この画面は「自分の実質支出」= 支払い総額 − 彼女の負担分 だけを集計する。
// どの式を使うかは lib(report.ts)が持っているが、
// **どの式をどのカードに出すか** はこの画面にしか無い。
// 取り違えても純関数のテストは1件も落ちず、
// 「履歴の1行ずつを足しても月合計にならない」という形で初めて気づく。
//
// 集計期間は既定で「今月」なので、記録も今月の日付で作る。
// ============================================================

const TODAY = todayISO()
const THIS_MONTH = monthKey(TODAY)
const LAST_MONTH_DAY = `${monthKeyOffset(THIS_MONTH, -1)}-15`

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    date: TODAY,
    type: 'expense',
    amount: 1000,
    category: 'food',
    memo: '',
    store: 'スーパー',
    partner_amount: 0,
    created_at: `${TODAY}T01:00:00.000Z`,
    ...over,
  }
}

function render(transactions: Transaction[]): string {
  return renderToStaticMarkup(
    <ReportTab transactions={transactions} onSetSatisfaction={async () => {}} />
  )
}

/** 上段に並ぶ2枚のカード(支出 / 彼女の負担分)の金額 */
function statValues(html: string): string[] {
  return [...html.matchAll(/class="value">([^<]*)</g)].map((m) => m[1])
}

describe('レポートの支出合計', () => {
  it('彼女の負担分を引いた「自分の実質支出」で出す', () => {
    // ¥3,000 のうち彼女が ¥1,000 負担 → 自分の支出は ¥2,000。
    // 支払い総額をそのまま出すと、履歴の1行ずつと合計が食い違う
    const html = render([tx({ amount: 3000, partner_amount: 1000 })])
    expect(statValues(html)[0]).toBe('¥2,000')
  })

  it('彼女の負担分は別のカードに出す(支出から消さず、行き先を示す)', () => {
    const html = render([tx({ amount: 3000, partner_amount: 1000 })])
    expect(statValues(html)[1]).toBe('¥1,000')
    expect(html).toContain('彼女の負担分')
    // 「立替」は支払ったのが自分だと決めつけた言い方だった
    expect(html).not.toContain('彼女立替分')
  })

  it('誰が払ったかでは実質支出が変わらない (機能018)', () => {
    // 「誰が払ったか」は預かり残高の話。使ったのが誰かは動かない
    const mine = render([tx({ amount: 3000, partner_amount: 1000, partner_paid: 0 })])
    const hers = render([tx({ amount: 3000, partner_amount: 1000, partner_paid: 3000 })])
    expect(statValues(mine)[0]).toBe('¥2,000')
    expect(statValues(hers)[0]).toBe('¥2,000')
  })

  it('預かり・返金・調整は支出に混ざらない(残高の話であって支出ではない)', () => {
    const html = render([
      tx({ amount: 3000, partner_amount: 1000 }),
      tx({ id: 'd1', type: 'partner_deposit', amount: 30000, category: null, store: '' }),
      tx({ id: 'r1', type: 'partner_refund', amount: 5000, category: null, store: '' }),
      tx({ id: 'j1', type: 'partner_adjust', amount: -700, category: null, store: '' }),
    ])
    expect(statValues(html)[0]).toBe('¥2,000')
  })

  it('分割した会計は、内訳を足すと分ける前と同じ額になる (機能096)', () => {
    // 行が増えても合計が変わらないことが、分割を「行で持つ」ことの前提
    const whole = render([tx({ amount: 3000 })])
    const split = render([
      tx({ id: 's1', amount: 2000, split_group: 'g1' }),
      tx({ id: 's2', amount: 1000, category: 'daily', split_group: 'g1' }),
    ])
    expect(statValues(split)[0]).toBe(statValues(whole)[0])
  })
})

describe('「彼女の負担分」カードの副題', () => {
  // 副題は残高への影響の説明なので、誰が払ったかで向きが変わる。
  // ここが固定文だと、彼女が払った回に嘘が出る
  it('自分が全額払った回は、負担分だけ預かり残高から引かれたと出す', () => {
    const html = render([tx({ amount: 3000, partner_amount: 1000 })])
    expect(html).toContain('預かり残高から ¥1,000 を差し引いています')
  })

  it('彼女が払った回は「差引」ではなく「増えています」と出す', () => {
    // 直した不具合そのもの。3,000円を彼女が払い、彼女の負担は1,000円 →
    // 残高は差し引かれるどころか 2,000円 増えている
    const html = render([tx({ amount: 3000, partner_amount: 1000, partner_paid: 3000 })])
    expect(html).toContain('彼女が多く払っており、預かり残高は ¥2,000 増えています')
    expect(html).not.toContain('差し引いています')
  })

  it('過不足なく分けて払った回は、影響なしと出す', () => {
    const html = render([tx({ amount: 3000, partner_amount: 1000, partner_paid: 1000 })])
    expect(html).toContain('預かり残高への影響はありません')
  })

  it('預かり・返金・調整は副題の計算に混ぜない(この期間の支出の話だから)', () => {
    const html = render([
      tx({ amount: 3000, partner_amount: 1000 }),
      tx({ id: 'd1', type: 'partner_deposit', amount: 30000, category: null, store: '' }),
      tx({ id: 'r1', type: 'partner_refund', amount: 5000, category: null, store: '' }),
    ])
    expect(html).toContain('預かり残高から ¥1,000 を差し引いています')
  })
})

describe('「自分の負担分」の注記', () => {
  it('彼女の負担がある期間は、何の金額なのかを1行で書く', () => {
    const html = render([tx({ amount: 3000, partner_amount: 1000 })])
    expect(html).toContain('彼女の負担分を除いた、あなたの負担だけの金額です')
  })

  it('彼女の負担が無い期間には出さない(読む意味の無い行を毎月増やさない)', () => {
    const html = render([tx({ amount: 3000 })])
    expect(html).not.toContain('あなたの負担だけの金額です')
  })
})

describe('レポートの前月比', () => {
  it('増えた月はマイナス評価の色、減った月はプラス評価の色で出す', () => {
    // 支出は「減ったほうが良い」ので、色の意味が金額の符号と逆になる。
    // ここを他のカードと揃えると、使いすぎた月に緑が出る
    const spentMore = render([
      tx({ id: 'a', amount: 3000 }),
      tx({ id: 'b', amount: 1000, date: LAST_MONTH_DAY }),
    ])
    expect(spentMore).toContain('前月比 +¥2,000')
    expect(spentMore).toContain('delta negative')

    const spentLess = render([
      tx({ id: 'a', amount: 1000 }),
      tx({ id: 'b', amount: 3000, date: LAST_MONTH_DAY }),
    ])
    expect(spentLess).toContain('前月比 -¥2,000')
    expect(spentLess).toContain('delta positive')
  })

  it('前月の記録も「自分の実質支出」で比べる(片方だけ総額だと差が嘘になる)', () => {
    const txs = [
      tx({ id: 'a', amount: 3000, partner_amount: 1000 }),
      tx({ id: 'b', amount: 3000, partner_amount: 1000, date: LAST_MONTH_DAY }),
    ]
    // 期待値も画面と同じ式から出す。総額(¥3,000)で比べていたら差は 0 にならない
    expect(totalOwn(txs, monthRange(monthKeyOffset(THIS_MONTH, -1)))).toBe(2000)
    const html = render(txs)
    expect(html).toContain('前月比 +¥0')
    // 差が無い月には色を付けない(良い・悪いのどちらでもない)
    expect(html).not.toContain('delta negative')
    expect(html).not.toContain('delta positive')
  })
})

describe('記録が1件も無い月', () => {
  it('¥0 の表を並べず、次にやることを書く', () => {
    const html = render([])
    expect(html).toContain('この期間の記録はありません')
    expect(html).not.toContain('前月比')
  })
})
