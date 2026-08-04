import { describe, expect, it } from 'vitest'
import type { PendingOp } from './offlineQueue'
import type { Guidance } from './errorGuidance'
import {
  SYNC_ATTEMPT_LIMIT,
  addEntry,
  bumpAttempt,
  entryTotal,
  forgetAttempts,
  opsToQuarantine,
  parseEntries,
  persistedSplitSiblings,
  quarantineGuidance,
  quarantinedOpSummary,
  reachedAttemptLimit,
  removeEntry,
  splitGroupOf,
  type QuarantineEntry,
} from './quarantine'

function op(p: Partial<PendingOp> & { opId: string }): PendingOp {
  return {
    kind: 'insert',
    id: `row-${p.opId}`,
    queuedAt: '2026-08-04T00:00:00.000Z',
    ...p,
  }
}

function payload(over: Record<string, unknown> = {}) {
  return {
    date: '2026-08-04',
    type: 'expense' as const,
    amount: 1000,
    category: 'food',
    memo: '',
    store: 'スーパー',
    partner_amount: 0,
    ...over,
  }
}

const label = (c: string | null) => (c === 'food' ? '食費' : 'その他')

describe('splitGroupOf', () => {
  it('分割の束IDを取り出す', () => {
    expect(splitGroupOf(op({ opId: 'a', payload: payload({ split_group: 'g1' }) }))).toBe('g1')
  })

  it('分割でない/空文字/payload 無しは null', () => {
    expect(splitGroupOf(op({ opId: 'a', payload: payload() }))).toBeNull()
    expect(splitGroupOf(op({ opId: 'a', payload: payload({ split_group: '' }) }))).toBeNull()
    expect(splitGroupOf(op({ opId: 'a', payload: payload({ split_group: null }) }))).toBeNull()
    expect(splitGroupOf(op({ opId: 'a', kind: 'delete' }))).toBeNull()
  })
})

describe('opsToQuarantine', () => {
  const a = op({ opId: 'a', payload: payload({ split_group: 'g1', amount: 1000 }) })
  const b = op({ opId: 'b', payload: payload({ split_group: 'g1', amount: 2000 }) })
  const other = op({ opId: 'c', payload: payload({ amount: 500 }) })

  it('分割でない op は自分だけ', () => {
    expect(opsToQuarantine([a, b, other], other)).toEqual([other])
  })

  it('分割は同じ束の op をまとめて隔離する(半分だけ保存させない)', () => {
    expect(opsToQuarantine([a, b, other], a).map((o) => o.opId)).toEqual(['a', 'b'])
  })

  it('別の束は巻き込まない', () => {
    const d = op({ opId: 'd', payload: payload({ split_group: 'g2' }) })
    expect(opsToQuarantine([a, b, d], d).map((o) => o.opId)).toEqual(['d'])
  })

  it('キューにもう無い op でも、自分だけは必ず含む', () => {
    expect(opsToQuarantine([], a).map((o) => o.opId)).toEqual(['a'])
    expect(opsToQuarantine([b], a).map((o) => o.opId)).toEqual(['a', 'b'])
  })
})

describe('persistedSplitSiblings', () => {
  const rows = [
    { id: 'r1', split_group: 'g1' },
    { id: 'r2', split_group: 'g1' },
    { id: 'r3', split_group: 'g2' },
    { id: 'r4' },
  ]

  it('すでにサーバーに入っている同じ会計の行を返す', () => {
    const quarantined = [op({ opId: 'a', id: 'r2', payload: payload({ split_group: 'g1' }) })]
    expect(persistedSplitSiblings(rows, 'g1', quarantined).map((r) => r.id)).toEqual(['r1'])
  })

  it('分割でなければ何も返さない(巻き添えで消さない)', () => {
    expect(persistedSplitSiblings(rows, null, [])).toEqual([])
  })

  it('束に該当する行が無ければ空', () => {
    expect(persistedSplitSiblings(rows, 'g9', [])).toEqual([])
  })
})

describe('addEntry / removeEntry', () => {
  const entry = (id: string): QuarantineEntry => ({
    id,
    quarantinedAt: '2026-08-04T00:00:00.000Z',
    reason: 'rejected',
    detail: null,
    ops: [op({ opId: id, payload: payload() })],
  })

  it('新しいものが先頭に積まれる', () => {
    const list = addEntry(addEntry([], entry('a')), entry('b'))
    expect(list.map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('件数の上限は無い(勝手に古いものを捨てない)', () => {
    let list: QuarantineEntry[] = []
    for (let i = 0; i < 50; i++) list = addEntry(list, entry(`e${i}`))
    expect(list).toHaveLength(50)
  })

  it('同じIDは重ならない', () => {
    const list = addEntry(addEntry([], entry('a')), entry('a'))
    expect(list).toHaveLength(1)
  })

  it('指定したものだけ外れる', () => {
    const list = addEntry(addEntry([], entry('a')), entry('b'))
    expect(removeEntry(list, 'b').map((e) => e.id)).toEqual(['a'])
    expect(removeEntry(list, 'zzz')).toHaveLength(2)
  })
})

describe('parseEntries', () => {
  it('壊れた値は空になる(致命的にしない)', () => {
    expect(parseEntries(null)).toEqual([])
    expect(parseEntries('{}')).toEqual([])
    expect(parseEntries([1, 'x', null])).toEqual([])
  })

  it('op が1件も無い箱は落とす', () => {
    expect(parseEntries([{ id: 'a', ops: [] }])).toEqual([])
    expect(parseEntries([{ id: 'a', ops: [{ nope: true }] }])).toEqual([])
  })

  it('欠けている項目は既定に寄せて読む(古い形でも失わない)', () => {
    const [e] = parseEntries([{ id: 'a', ops: [{ opId: 'o1', id: 'r1', kind: 'insert' }] }])
    expect(e.id).toBe('a')
    expect(e.reason).toBe('rejected')
    expect(e.detail).toBeNull()
    expect(e.ops).toHaveLength(1)
  })
})

describe('quarantinedOpSummary', () => {
  it('支出はお店 → メモ → カテゴリ名の順で見出しにする', () => {
    expect(quarantinedOpSummary(op({ opId: 'a', payload: payload() }), label).title).toBe('スーパー')
    expect(
      quarantinedOpSummary(op({ opId: 'a', payload: payload({ store: '', memo: 'ランチ' }) }), label)
        .title
    ).toBe('ランチ')
    expect(
      quarantinedOpSummary(op({ opId: 'a', payload: payload({ store: '', memo: '' }) }), label).title
    ).toBe('食費')
  })

  it('預かり・返金・調整は専用の見出しにする', () => {
    const t = (type: string) =>
      quarantinedOpSummary(op({ opId: 'a', payload: payload({ type }) }), label).title
    expect(t('partner_deposit')).toBe('彼女から預かり')
    expect(t('partner_refund')).toBe('彼女に返金')
    expect(t('partner_adjust')).toBe('残高の調整')
  })

  it('削除は中身を持たないので金額を出さない', () => {
    const s = quarantinedOpSummary(op({ opId: 'a', kind: 'delete' }), label)
    expect(s.action).toBe('削除')
    expect(s.amount).toBeNull()
  })

  it('操作の種類が日本語で分かる', () => {
    expect(quarantinedOpSummary(op({ opId: 'a', payload: payload() }), label).action).toBe('追加')
    expect(
      quarantinedOpSummary(op({ opId: 'a', kind: 'update', payload: payload() }), label).action
    ).toBe('修正')
  })
})

describe('entryTotal', () => {
  it('隔離した金額の合計が分かる(いくら送れていないかが要点)', () => {
    const entry: QuarantineEntry = {
      id: 'a',
      quarantinedAt: '',
      reason: 'rejected',
      detail: null,
      ops: [
        op({ opId: '1', payload: payload({ amount: 1000 }) }),
        op({ opId: '2', payload: payload({ amount: 2000 }) }),
        op({ opId: '3', kind: 'delete' }),
      ],
    }
    expect(entryTotal(entry)).toBe(3000)
  })
})

describe('断られた回数', () => {
  it('数え上げと忘却', () => {
    let counts = bumpAttempt({}, 'op1')
    expect(counts.op1).toBe(1)
    counts = bumpAttempt(counts, 'op1')
    counts = bumpAttempt(counts, 'op2')
    expect(counts).toEqual({ op1: 2, op2: 1 })
    expect(forgetAttempts(counts, ['op1'])).toEqual({ op2: 1 })
    expect(forgetAttempts(counts, ['なにもない'])).toEqual(counts)
  })

  it('元の表を書き換えない(純粋関数)', () => {
    const base = { op1: 1 }
    bumpAttempt(base, 'op1')
    forgetAttempts(base, ['op1'])
    expect(base).toEqual({ op1: 1 })
  })

  it('限度に達した回だけ true(境界)', () => {
    expect(reachedAttemptLimit(SYNC_ATTEMPT_LIMIT - 1)).toBe(false)
    expect(reachedAttemptLimit(SYNC_ATTEMPT_LIMIT)).toBe(true)
    expect(reachedAttemptLimit(SYNC_ATTEMPT_LIMIT + 1)).toBe(true)
    expect(reachedAttemptLimit(0)).toBe(false)
  })
})

describe('quarantineGuidance', () => {
  const base: Guidance = {
    kind: 'unknown',
    summary: 'サーバーに拒否されました。',
    actions: ['入力内容を確かめてください。'],
    detail: '23514',
  }

  it('記録が消えていないことと、確認する場所を必ず先に書く', () => {
    const g = quarantineGuidance(base, 3)
    expect(g.kind).toBe('rejected')
    expect(g.summary).toContain('3件')
    expect(g.summary).toContain('消えていません')
    expect(g.actions[0]).toContain('同期できなかった記録')
  })

  it('元の案内(原因と次の行動・原文)を捨てない', () => {
    const g = quarantineGuidance(base, 1)
    expect(g.actions).toContain('入力内容を確かめてください。')
    expect(g.detail).toBe('23514')
  })
})
