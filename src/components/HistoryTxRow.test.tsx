import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import HistoryTxRow from './HistoryTxRow'
import type { Transaction } from '../lib/types'

// ============================================================
// 履歴の1行。
//
// この行に出る金額は「自分の実質支出」で、預かり・返金・調整のときだけ
// 「残高への影響額」に切り替わる。どちらの式を使うかを間違えても
// lib のテストは1件も落ちない(式そのものは正しいままなので)。
// ここでは **表示された文字列** から、金額・符号・添え書きの有無を確かめる。
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

function render(t: Transaction, props: Partial<Parameters<typeof HistoryTxRow>[0]> = {}): string {
  return renderToStaticMarkup(
    <HistoryTxRow
      tx={t}
      selectMode={false}
      picked={false}
      onOpen={() => {}}
      onLongPress={() => {}}
      onSwipeDelete={() => {}}
      onTogglePick={() => {}}
      {...props}
    />
  )
}

/** 行の右端に出ている金額(符号つきの文字列)を取り出す */
function amountText(html: string): string {
  const m = /class="tx-amount[^"]*">([^<]*)</.exec(html)
  return m === null ? '' : m[1]
}

describe('履歴の行に出る金額と符号', () => {
  it('支出は「彼女の負担分を引いた自分の実質支出」をマイナスで出す', () => {
    // 支払い総額 ¥1,000 のうち彼女が ¥400 負担 → 自分の負担は ¥600。
    // ここで tx.amount をそのまま出すと、月合計と1行ずつの合計が食い違う
    expect(amountText(render(tx({ amount: 1000, partner_amount: 400 })))).toBe('-¥600')
  })

  it('彼女が全額払った支出でも、自分の実質支出はマイナスのまま(誰が払ったかで変わらない)', () => {
    // 機能018: 「誰が払ったか」は預かり残高の話で、実質支出(=誰がいくら消費したか)は動かない
    const html = render(tx({ amount: 1000, partner_amount: 400, partner_paid: 1000 }))
    expect(amountText(html)).toBe('-¥600')
  })

  it('預かりはプラスで出る', () => {
    const html = render(
      tx({ type: 'partner_deposit', amount: 30000, category: null, store: '', partner_amount: 0 })
    )
    expect(amountText(html)).toBe('+¥30,000')
    expect(html).toContain('彼女から預かり')
    expect(html).toContain('positive')
  })

  it('返金はマイナスで出る(¥0 の行に見えない)', () => {
    const html = render(
      tx({ type: 'partner_refund', amount: 20000, category: null, store: '', partner_amount: 0 })
    )
    expect(amountText(html)).toBe('-¥20,000')
    expect(html).toContain('彼女に返金')
  })

  it('調整は向きが見出しにも金額の符号にも出る', () => {
    const minus = render(
      tx({ type: 'partner_adjust', amount: -500, category: null, store: '', partner_amount: 0 })
    )
    expect(amountText(minus)).toBe('-¥500')
    expect(minus).toContain('調整(残高を減らした)')

    const plus = render(
      tx({ type: 'partner_adjust', amount: 500, category: null, store: '', partner_amount: 0 })
    )
    expect(amountText(plus)).toBe('+¥500')
    expect(plus).toContain('調整(残高を増やした)')
  })
})

describe('履歴の行の添え書き', () => {
  it('彼女の負担分があるときは「うち彼女分」を書く', () => {
    expect(render(tx({ partner_amount: 400 }))).toContain('うち彼女分 ¥400')
  })

  it('彼女の負担分が0のときは「うち彼女分」を書かない', () => {
    expect(render(tx({ partner_amount: 0 }))).not.toContain('うち彼女分')
  })

  it('彼女が払った回は、その事実を書く(書かないと実質支出との差が読めない)', () => {
    // 機能018。¥1,000 の会計を彼女が全額払い、彼女の負担は ¥400 だった回
    const html = render(tx({ amount: 1000, partner_amount: 400, partner_paid: 1000 }))
    expect(html).toContain('彼女が ¥1,000 支払い')
    expect(html).toContain('うち彼女分 ¥400')
  })

  it('自分が全額払った回に「彼女が支払い」は出ない', () => {
    expect(render(tx({ partner_paid: 0 }))).not.toContain('彼女が')
  })

  it('分割された会計は「分割 1/2」を添える(1件だけ見て無関係な記録に見えないように)', () => {
    // 機能096
    expect(render(tx(), { splitPos: { index: 1, count: 2 } })).toContain('分割 1/2')
  })

  it('分割でない記録に分割バッジは出ない', () => {
    expect(render(tx())).not.toContain('分割')
  })

  it('タグは末尾に # つきで出る', () => {
    // 機能088
    const html = render(tx({ tags: ['旅行2026', 'デート'] }))
    expect(html).toContain('#旅行2026')
    expect(html).toContain('#デート')
  })

  it('繰り返し入力が作った記録には「自動生成」と出る', () => {
    expect(render(tx({ source: 'recurring' }))).toContain('自動生成')
    expect(render(tx({ source: null }))).not.toContain('自動生成')
  })

  it('検索結果のように月をまたぐ一覧では日付を出す', () => {
    expect(render(tx(), { showDate: true })).toContain('8月3日')
    expect(render(tx(), { showDate: false })).not.toContain('8月3日')
  })

  it('お店もメモも無い支出は、カテゴリ名を見出しにする', () => {
    const html = render(tx({ store: '', memo: '' }))
    expect(html).toContain('食費')
  })

  it('お店とメモが両方あるときは、お店を見出しにしてメモを添える', () => {
    const html = render(tx({ store: 'スーパー', memo: '夕飯の買い出し' }))
    expect(html).toContain('スーパー')
    expect(html).toContain('夕飯の買い出し')
  })
})

describe('複数選択モードの行', () => {
  it('選択中はチェック欄になり、カテゴリのアイコンは出ない', () => {
    // 機能151。選択中に絵柄が残っていると、押せるものが2つあるように見える
    const html = render(tx(), { selectMode: true, picked: false })
    expect(html).toContain('hist-check')
    expect(html).not.toContain('cat-icon')
    expect(html).toContain('aria-pressed="false"')
  })

  it('選んだ行はチェックが入り、押された状態として読み上げられる', () => {
    const html = render(tx(), { selectMode: true, picked: true })
    expect(html).toContain('✓')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('スーパー を選ぶ')
  })

  it('選択していないときは aria-pressed を付けない(ボタンの意味が変わらないように)', () => {
    expect(render(tx())).not.toContain('aria-pressed')
  })
})
