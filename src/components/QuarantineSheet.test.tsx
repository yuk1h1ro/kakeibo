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

describe('隔離された記録の中身の読み取り', () => {
  it('隔離された束が複数あるときは、束ごとに分けて出す(混ざらない)', () => {
    const html = render([
      entry({ id: 'e1' }),
      entry({
        id: 'e2',
        reason: 'repeated',
        detail: 'timeout',
        ops: [
          {
            opId: 'o9',
            kind: 'insert',
            id: 'r9',
            queuedAt: '2026-08-04T11:00:00.000Z',
            payload: {
              date: '2026-08-04',
              type: 'partner_deposit',
              amount: 30000,
              category: null,
              memo: '',
              store: '',
              partner_amount: 0,
            },
          },
        ],
      }),
    ])
    // それぞれの束が、自分の件数と合計を持っている
    expect(html).toContain('2件')
    expect(html).toContain('1件')
    expect(html).toContain('¥3,000')
    expect(html).toContain('¥30,000')
    expect(html).toContain('彼女から預かり')
    // 再送・破棄の道は束ごとに1組ずつある
    expect(html.match(/もう一度送る/g)).toHaveLength(2)
  })

  it('何をしようとした記録かが分かる(追加・修正・削除)', () => {
    const html = render([
      entry({
        ops: [
          {
            opId: 'u1',
            kind: 'update',
            id: 'r1',
            queuedAt: '2026-08-04T10:00:00.000Z',
            payload: {
              date: '2026-08-04',
              type: 'expense',
              amount: 500,
              category: 'food',
              memo: '',
              store: 'カフェ',
              partner_amount: 0,
            },
          },
          { opId: 'd1', kind: 'delete', id: 'r2', queuedAt: '2026-08-04T10:00:00.000Z' },
        ],
      }),
    ])
    expect(html).toContain('修正')
    expect(html).toContain('削除')
    // 削除は中身が残っていないので、金額は「—」と正直に書く
    expect(html).toContain('この記録の削除')
    expect(html).toContain('—')
  })

  it('預かりの記録も、支出と同じように何が入っているか読める', () => {
    const html = render([
      entry({
        ops: [
          {
            opId: 'p1',
            kind: 'insert',
            id: 'r1',
            queuedAt: '2026-08-04T10:00:00.000Z',
            payload: {
              date: '2026-08-04',
              type: 'partner_refund',
              amount: 5000,
              category: null,
              memo: '現金で返した',
              store: '',
              partner_amount: 0,
            },
          },
        ],
      }),
    ])
    expect(html).toContain('彼女に返金')
    expect(html).toContain('¥5,000')
  })
})
