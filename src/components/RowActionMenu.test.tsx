import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import RowActionMenu from './RowActionMenu'
import type { Transaction } from '../lib/types'

// ============================================================
// 長押しメニュー (機能149)。
//
// ここには実際に起きた不具合が1件ぶら下がっている:
//   **預かりの行を複製すると、存在しない預かりが増えて残高が倍になっていた。**
//   彼女にも「+¥30,000 預かりました」と嘘の通知が飛ぶ。
//   複製そのもの (duplicateInput) は正しく、「支出のときだけ複製を出す」という
//   分岐がこの画面に無かったことが原因だった。
//   → 「複製の入口が種別で出し分けられているか」を必ず描画して確かめる。
// ============================================================

const DUPLICATE = '同じ内容で今日の日付に複製する'
const STORE_FILTER = 'このお店の履歴だけ見る'

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

function render(t: Transaction): string {
  return renderToStaticMarkup(
    <RowActionMenu
      tx={t}
      onDuplicate={() => {}}
      onEdit={() => {}}
      onDelete={() => {}}
      // 本番(HistoryTab)は常に渡す。渡さないときの見え方は下の節で確かめる
      onFilterStore={() => {}}
      onClose={() => {}}
    />
  )
}

const ledger = (type: Transaction['type'], amount: number) =>
  tx({ type, amount, category: null, store: '', partner_amount: 0 })

describe('長押しメニューの複製の出し分け', () => {
  it('支出には複製を出す(「この前と同じものをまた買った」ため)', () => {
    expect(render(tx())).toContain(DUPLICATE)
  })

  it('預かりには複製を出さない(複製すると存在しない預かりが生まれ、残高が倍になる)', () => {
    expect(render(ledger('partner_deposit', 30000))).not.toContain(DUPLICATE)
  })

  it('返金にも複製を出さない(返していないお金を返したことにできてしまう)', () => {
    expect(render(ledger('partner_refund', 5000))).not.toContain(DUPLICATE)
  })

  it('調整にも複製を出さない(ズレを直した記録を増やすと残高が二重に動く)', () => {
    expect(render(ledger('partner_adjust', -300))).not.toContain(DUPLICATE)
  })

  it('編集と削除は種別によらず出す(複製だけを外している)', () => {
    for (const html of [render(tx()), render(ledger('partner_deposit', 30000))]) {
      expect(html).toContain('編集する')
      expect(html).toContain('削除する')
    }
  })
})

describe('長押しメニューからお店で絞り込む導線', () => {
  it('店名のある支出には出す', () => {
    expect(render(tx({ store: 'オカモトセルフ' }))).toContain(STORE_FILTER)
  })

  it('店名が空の記録には出さない(絞り込む先が無いので、押しても何も起きない項目になる)', () => {
    expect(render(tx({ store: '' }))).not.toContain(STORE_FILTER)
    // 空白だけの店名も「店名なし」と同じ扱い(レポートの束ね方と揃える)
    expect(render(tx({ store: '   ' }))).not.toContain(STORE_FILTER)
    // 預かり・返金・調整は店名を持たない
    expect(render(ledger('partner_deposit', 30000))).not.toContain(STORE_FILTER)
    expect(render(ledger('partner_refund', 5000))).not.toContain(STORE_FILTER)
  })

  it('受け取り手が渡されていなければ出さない', () => {
    const html = renderToStaticMarkup(
      <RowActionMenu
        tx={tx()}
        onDuplicate={() => {}}
        onEdit={() => {}}
        onDelete={() => {}}
        onClose={() => {}}
      />
    )
    expect(html).not.toContain(STORE_FILTER)
  })

  it('既存3項目の並びは変えない(複製・編集・削除の順のまま、間に挟む)', () => {
    const html = render(tx({ store: 'オカモトセルフ' }))
    expect(html.indexOf(DUPLICATE)).toBeLessThan(html.indexOf(STORE_FILTER))
    expect(html.indexOf(STORE_FILTER)).toBeLessThan(html.indexOf('編集する'))
    expect(html.indexOf('編集する')).toBeLessThan(html.indexOf('削除する'))
  })
})

describe('長押しメニューが示す「どの記録か」', () => {
  it('支出は自分の実質支出で出す(彼女の負担分を除いた額)', () => {
    const html = render(tx({ amount: 1000, partner_amount: 400 }))
    expect(html).toContain('スーパー')
    expect(html).toContain('¥600')
  })

  it('預かり・返金・調整は専用の見出しと残高への影響額で出す(¥0 の行に見えないように)', () => {
    expect(render(ledger('partner_deposit', 30000))).toContain('彼女から預かり')
    expect(render(ledger('partner_deposit', 30000))).toContain('¥30,000')

    const adjust = render(ledger('partner_adjust', -300))
    expect(adjust).toContain('調整(残高を減らした)')
    // 向きは見出しが伝えるので、金額は絶対値
    expect(adjust).toContain('¥300')
  })

  it('日付も出す(長押しした行を取り違えないため)', () => {
    expect(render(tx({ date: '2026-08-03' }))).toContain('8月3日')
  })
})
