import { describe, expect, it } from 'vitest'
import type { Transaction } from './types'
import type { TransactionInput } from '../hooks/useTransactions'
import {
  MAX_ENTRIES,
  RETENTION_DAYS,
  type ChangeEntry,
  describeEntry,
  diffTransaction,
  pruneEntries,
  transactionSummary,
} from './changeLog'

const labelOf = (id: string | null) =>
  id === 'food' ? '食費' : id === 'daily' ? '日用品' : id === null ? '未分類' : id

function tx(p: Partial<Transaction> = {}): Transaction {
  return {
    id: 'id001',
    date: '2026-07-20',
    type: 'expense',
    amount: 1200,
    category: 'food',
    memo: 'おにぎり',
    store: 'セブンイレブン',
    partner_amount: 0,
    created_at: '2026-07-20T03:00:00.000Z',
    ...p,
  }
}

function input(p: Partial<TransactionInput> = {}): TransactionInput {
  return {
    date: '2026-07-20',
    type: 'expense',
    amount: 1200,
    category: 'food',
    memo: 'おにぎり',
    store: 'セブンイレブン',
    partner_amount: 0,
    ...p,
  }
}

describe('diffTransaction', () => {
  it('変わっていなければ差分なし', () => {
    expect(diffTransaction(tx(), input(), labelOf)).toEqual([])
  })

  it('何から何に変わったかが分かる', () => {
    const changes = diffTransaction(tx(), input({ amount: 1500 }), labelOf)
    expect(changes).toEqual([{ label: '金額', from: '¥1,200', to: '¥1,500' }])
  })

  it('カテゴリはIDではなく名前で残す', () => {
    const changes = diffTransaction(tx(), input({ category: 'daily' }), labelOf)
    expect(changes[0]).toEqual({ label: 'カテゴリ', from: '食費', to: '日用品' })
  })

  it('空欄になった項目は「(なし)」で分かるようにする', () => {
    const changes = diffTransaction(tx(), input({ memo: '' }), labelOf)
    expect(changes[0]).toEqual({ label: 'メモ', from: 'おにぎり', to: '(なし)' })
  })

  it('おごり・値引きは1行にまとめ、相手の名前まで残す', () => {
    const changes = diffTransaction(
      tx({ amount: 0, favor_amount: 3200, favor_kind: 'treat', favor_from: '田中' }),
      input({ amount: 0, favor_amount: 3200, favor_kind: 'treat', favor_from: '佐藤' }),
      labelOf
    )
    expect(changes).toEqual([
      { label: 'おごり・値引き', from: '田中さんのおごり ¥3,200', to: '佐藤さんのおごり ¥3,200' },
    ])
  })

  it('おごりを外したことも履歴に残る', () => {
    const changes = diffTransaction(
      tx({ favor_amount: 500, favor_kind: 'discount', favor_from: '' }),
      input({ favor_amount: 0, favor_kind: null, favor_from: '' }),
      labelOf
    )
    expect(changes).toEqual([{ label: 'おごり・値引き', from: '割引 ¥500', to: '(なし)' }])
  })

  it('おごりが無いまま更新しても、余計な差分を作らない', () => {
    expect(
      diffTransaction(tx(), input({ favor_amount: 0, favor_kind: null, favor_from: '' }), labelOf)
    ).toEqual([])
  })

  it('複数項目の変更をすべて拾う', () => {
    const changes = diffTransaction(
      tx(),
      input({ date: '2026-07-21', store: 'ローソン', partner_amount: 200 }),
      labelOf
    )
    expect(changes.map((c) => c.label)).toEqual(['日付', 'お店', '彼女の負担分'])
  })

  it('送っていない項目(キー無し)は差分にしない', () => {
    const before = tx({ satisfaction: 'good' })
    // satisfaction 列が無い環境ではキーごと落として送るため、変更扱いにしてはいけない
    expect(diffTransaction(before, input(), labelOf)).toEqual([])
  })

  it('気分の変更は日本語で残す', () => {
    const changes = diffTransaction(tx(), input({ satisfaction: 'regret' }), labelOf)
    expect(changes[0]).toEqual({ label: '気分', from: '未設定', to: '後悔' })
  })

  // 機能018: 預かり残高が動く操作。差分が空だと履歴ごと捨てられていた
  it('彼女が払った額の変更を残す(残高が動く操作)', () => {
    const changes = diffTransaction(tx(), input({ partner_paid: 1200 }), labelOf)
    expect(changes).toEqual([{ label: '彼女が払った額', from: '¥0', to: '¥1,200' }])
  })

  it('彼女が払った額を取り消したことも残す', () => {
    const before = tx({ partner_paid: 1200 })
    const changes = diffTransaction(before, input({ partner_paid: 0 }), labelOf)
    expect(changes).toEqual([{ label: '彼女が払った額', from: '¥1,200', to: '¥0' }])
  })

  // 機能088
  it('タグの追加・削除を残す', () => {
    expect(diffTransaction(tx(), input({ tags: ['デート'] }), labelOf)).toEqual([
      { label: 'タグ', from: '(なし)', to: '#デート' },
    ])
    expect(diffTransaction(tx({ tags: ['デート'] }), input({ tags: [] }), labelOf)).toEqual([
      { label: 'タグ', from: '#デート', to: '(なし)' },
    ])
  })

  it('タグは並び順が違うだけなら変更扱いにしない', () => {
    const before = tx({ tags: ['旅行', 'デート'] })
    expect(diffTransaction(before, input({ tags: ['デート', '旅行'] }), labelOf)).toEqual([])
  })

  // 機能096: 束ねID(UUID)そのままでは読めないので、言葉で残す
  it('分割の束ねは「分割の一部かどうか」が分かる言葉で残す', () => {
    const changes = diffTransaction(
      tx(),
      input({ split_group: 'a1b2c3d4-e5f6-7890-1234-567890abcdef' }),
      labelOf
    )
    expect(changes).toEqual([{ label: '分割', from: '分割なし', to: '分割の一部 (a1b2c3d4)' }])
    expect(
      diffTransaction(tx({ split_group: 'a1b2c3d4-x' }), input({ split_group: null }), labelOf)
    ).toEqual([{ label: '分割', from: '分割の一部 (a1b2c3d4)', to: '分割なし' }])
  })

  it('後から足した列を送っていない環境では差分にしない', () => {
    // partner_paid / tags / split_group 列が無い環境ではキーごと落として送るため、
    // 「送らなかった = 変わっていない」を差分にすると嘘の履歴が残る
    const before = tx({ partner_paid: 1200, tags: ['デート'], split_group: 'g1' })
    expect(diffTransaction(before, input(), labelOf)).toEqual([])
  })
})

describe('transactionSummary', () => {
  it('どの記録かが分かる(日付・お店・金額)', () => {
    expect(transactionSummary(tx(), labelOf)).toBe('7月20日(月) セブンイレブン ¥1,200')
  })

  it('お店が無ければカテゴリ名で示す', () => {
    expect(transactionSummary(tx({ store: '' }), labelOf)).toBe('7月20日(月) 食費 ¥1,200')
  })

  it('預かりはそう分かるようにする', () => {
    const dep = tx({ type: 'partner_deposit', amount: 30000, category: null, store: '' })
    expect(transactionSummary(dep, labelOf)).toBe('7月20日(月) 彼女から預かり ¥30,000')
  })
})

describe('pruneEntries(上限)', () => {
  function entry(id: string, daysAgo: number): ChangeEntry {
    const d = new Date(Date.UTC(2026, 7, 4) - daysAgo * 24 * 60 * 60 * 1000)
    return {
      id,
      transactionId: 't1',
      action: 'update',
      summary: '',
      changes: [],
      changedAt: d.toISOString(),
    }
  }

  const now = new Date(Date.UTC(2026, 7, 4))

  it('保存期間より古いものを捨てる', () => {
    const kept = pruneEntries([entry('new', 1), entry('old', RETENTION_DAYS + 1)], now)
    expect(kept.map((e) => e.id)).toEqual(['new'])
  })

  it('件数の上限を超えたら新しいものだけ残す', () => {
    const many = Array.from({ length: MAX_ENTRIES + 20 }, (_, i) => entry(`e${i}`, i % 30))
    expect(pruneEntries(many, now)).toHaveLength(MAX_ENTRIES)
  })

  it('新しい順に並ぶ', () => {
    const sorted = pruneEntries([entry('a', 5), entry('b', 1), entry('c', 3)], now)
    expect(sorted.map((e) => e.id)).toEqual(['b', 'c', 'a'])
  })

  it('壊れた日時の行は捨てる(表示を壊さない)', () => {
    const broken = { ...entry('x', 1), changedAt: 'こわれている' }
    expect(pruneEntries([broken, entry('ok', 1)], now).map((e) => e.id)).toEqual(['ok'])
  })
})

describe('describeEntry', () => {
  it('「何から何に」を並べる', () => {
    const e: ChangeEntry = {
      id: '1',
      transactionId: 't',
      action: 'update',
      summary: '',
      changes: [
        { label: '金額', from: '¥1,000', to: '¥1,200' },
        { label: 'カテゴリ', from: '食費', to: '外食' },
      ],
      changedAt: '2026-08-04T01:00:00.000Z',
    }
    expect(describeEntry(e)).toBe('金額 ¥1,000 → ¥1,200 / カテゴリ 食費 → 外食')
  })

  it('削除・復元は操作名だけで足りる', () => {
    const e: ChangeEntry = {
      id: '1',
      transactionId: 't',
      action: 'delete',
      summary: '',
      changes: [],
      changedAt: '2026-08-04T01:00:00.000Z',
    }
    expect(describeEntry(e)).toBe('削除')
  })
})
