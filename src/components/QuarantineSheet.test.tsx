import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import QuarantineSheet from './QuarantineSheet'
import type { QuarantineEntry } from '../lib/quarantine'

// この画面は「記録が消えていないこと」を利用者に伝えるためだけにある。
// 中身(何が・いくら・なぜ)が出ているかを描画して確かめる。

function entry(over: Partial<QuarantineEntry> = {}): QuarantineEntry {
  return {
    id: 'e1',
    quarantinedAt: '2026-08-04T10:00:00.000Z',
    reason: 'rejected',
    detail: 'new row violates check constraint "transactions_check"',
    ops: [
      {
        opId: 'o1',
        kind: 'insert',
        id: 'r1',
        queuedAt: '2026-08-04T10:00:00.000Z',
        payload: {
          date: '2026-08-04',
          type: 'expense',
          amount: 2000,
          category: 'food',
          memo: '',
          store: 'スーパー',
          partner_amount: 500,
          split_group: 'g1',
        },
      },
      {
        opId: 'o2',
        kind: 'insert',
        id: 'r2',
        queuedAt: '2026-08-04T10:00:00.000Z',
        payload: {
          date: '2026-08-04',
          type: 'expense',
          amount: 1000,
          category: 'daily',
          memo: '洗剤',
          store: '',
          partner_amount: 0,
          split_group: 'g1',
        },
      },
    ],
    ...over,
  }
}

function render(entries: QuarantineEntry[]): string {
  return renderToStaticMarkup(
    <QuarantineSheet entries={entries} onRetry={() => {}} onDiscard={() => {}} onClose={() => {}} />
  )
}

describe('同期できなかった記録の画面', () => {
  it('消えていないことと、何が入っているかが読める', () => {
    const html = render([entry()])
    expect(html).toContain('この端末の中に残しています')
    expect(html).toContain('2件')
    // 分割した会計は、合計が元の会計と一致する(3,000円が2,000円にならない)
    expect(html).toContain('¥3,000')
    expect(html).toContain('スーパー')
    expect(html).toContain('洗剤')
  })

  it('なぜ隔離されたのかとサーバーの原文を隠さない', () => {
    const html = render([entry()])
    expect(html).toContain('サーバーがこの内容を受け付けませんでした')
    expect(html).toContain('transactions_check')
  })

  it('何度も断られて隔離したときは、その理由を書く', () => {
    const html = render([entry({ reason: 'repeated' })])
    expect(html).toContain('後ろの記録を止めないように取り置きました')
  })

  it('再送と破棄の両方に道がある', () => {
    const html = render([entry()])
    expect(html).toContain('もう一度送る')
    expect(html).toContain('破棄する')
  })

  it('1件も無いときは「同期できています」と伝える', () => {
    const html = render([])
    expect(html).toContain('いまはありません')
    expect(html).not.toContain('破棄する')
  })
})
