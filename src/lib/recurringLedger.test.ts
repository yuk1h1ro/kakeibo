import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addMark,
  confirmMarks,
  forgetMarks,
  hasMark,
  parseMarks,
  reconcileMarks,
  type GeneratedMark,
} from './recurringLedger'
import type { TransactionInput } from '../hooks/useTransactions'

const input: TransactionInput = {
  date: '2026-03-27',
  type: 'expense',
  amount: 80000,
  category: 'other',
  memo: '',
  store: '',
  partner_amount: 0,
  source: 'recurring',
}

const mark = (over: Partial<GeneratedMark> = {}): GeneratedMark => ({
  ruleId: 'r1',
  date: '2026-03-27',
  txId: 'tx-1',
  input,
  confirmed: false,
  recoveries: 0,
  recordedAt: '2026-03-27T00:00:00.000Z',
  ...over,
})

const ctx = (over: Partial<Parameters<typeof reconcileMarks>[1]> = {}) => ({
  serverIds: new Set<string>(),
  queuedIds: new Set<string>(),
  quarantinedIds: new Set<string>(),
  today: '2026-03-28',
  ...over,
})

describe('addMark', () => {
  it('同じルール・同じ日の控えは二度足さない(重複生成の入口を塞ぐ)', () => {
    const list = addMark([], mark())
    expect(addMark(list, mark({ txId: 'tx-2' }))).toHaveLength(1)
  })

  it('同じ行IDの控えも二度足さない', () => {
    const list = addMark([], mark())
    expect(addMark(list, mark({ date: '2026-04-27' }))).toHaveLength(1)
  })

  it('別のルール・別の日は足す', () => {
    let list = addMark([], mark())
    list = addMark(list, mark({ ruleId: 'r2', txId: 'tx-2' }))
    list = addMark(list, mark({ date: '2026-04-27', txId: 'tx-3' }))
    expect(list).toHaveLength(3)
  })

  it('元の配列を書き換えない', () => {
    const list = [mark()]
    addMark(list, mark({ ruleId: 'r2', txId: 'tx-2' }))
    expect(list).toHaveLength(1)
  })
})

describe('hasMark', () => {
  it('ルールと日付の両方が一致したときだけ true', () => {
    const list = [mark()]
    expect(hasMark(list, 'r1', '2026-03-27')).toBe(true)
    expect(hasMark(list, 'r1', '2026-04-27')).toBe(false)
    expect(hasMark(list, 'r2', '2026-03-27')).toBe(false)
  })
})

describe('confirmMarks / forgetMarks', () => {
  it('届いた行だけに印を付ける', () => {
    const list = [mark(), mark({ txId: 'tx-2' })]
    const next = confirmMarks(list, ['tx-2'])
    expect(next.map((m) => m.confirmed)).toEqual([false, true])
  })

  it('忘れた控えは消える(復活の対象から外れる)', () => {
    const list = [mark(), mark({ txId: 'tx-2' })]
    expect(forgetMarks(list, ['tx-1']).map((m) => m.txId)).toEqual(['tx-2'])
  })

  it('知らない行IDを渡しても何も壊れない', () => {
    const list = [mark()]
    expect(confirmMarks(list, ['none'])).toHaveLength(1)
    expect(forgetMarks(list, ['none'])).toHaveLength(1)
  })
})

describe('reconcileMarks', () => {
  it('サーバーに在れば confirmed になり、積み直さない', () => {
    const r = reconcileMarks([mark()], ctx({ serverIds: new Set(['tx-1']) }))
    expect(r.lost).toEqual([])
    expect(r.marks[0].confirmed).toBe(true)
  })

  it('どこにも無ければ積み直す(印だけ進んで取引が無い状態)', () => {
    const r = reconcileMarks([mark()], ctx())
    expect(r.lost.map((m) => m.txId)).toEqual(['tx-1'])
    // 行IDは変えない — 二重に入っても主キーが弾けるようにするため
    expect(r.lost[0].txId).toBe('tx-1')
    expect(r.lost[0].input).toEqual(input)
    expect(r.marks[0].recoveries).toBe(1)
  })

  it('一度届いた行が消えていたら、利用者が消したとみなして二度と作らない', () => {
    const r = reconcileMarks([mark({ confirmed: true })], ctx())
    expect(r.lost).toEqual([])
    // 控えごと忘れる = 次回以降も回復の対象にならない
    expect(r.marks).toEqual([])
  })

  it('送信待ちのキューに在るものは待つ(まだ届いていないだけ)', () => {
    const r = reconcileMarks([mark()], ctx({ queuedIds: new Set(['tx-1']) }))
    expect(r.lost).toEqual([])
    expect(r.marks[0].recoveries).toBe(0)
  })

  it('隔離箱に在るものには手を出さない(利用者が再送/破棄を決めるまで)', () => {
    const r = reconcileMarks([mark()], ctx({ quarantinedIds: new Set(['tx-1']) }))
    expect(r.lost).toEqual([])
    expect(r.marks).toHaveLength(1)
  })

  it('上限まで積み直したら諦める(起動のたびに同じ失敗を繰り返さない)', () => {
    const r1 = reconcileMarks([mark({ recoveries: 2 })], ctx({ maxRecoveries: 3 }))
    expect(r1.lost).toHaveLength(1)
    const r2 = reconcileMarks(r1.marks, ctx({ maxRecoveries: 3 }))
    expect(r2.lost).toEqual([])
    expect(r2.marks).toHaveLength(1)
  })

  it('役目を終えた古い控えは捨てる(確認済み)', () => {
    const old = mark({ date: '2025-01-01', confirmed: true })
    const r = reconcileMarks([old], ctx({ serverIds: new Set(['tx-1']), keepDays: 120 }))
    expect(r.marks).toEqual([])
  })

  it('諦めた控えも古くなれば捨てる', () => {
    const old = mark({ date: '2025-01-01', recoveries: 3 })
    expect(reconcileMarks([old], ctx({ keepDays: 120 })).marks).toEqual([])
    // 期限内ならまだ持っておく
    const recent = mark({ date: '2026-03-01', recoveries: 3 })
    expect(reconcileMarks([recent], ctx({ keepDays: 120 })).marks).toHaveLength(1)
  })

  it('古くても届いていない控えは捨てずに積み直す(長く開いていなかった端末)', () => {
    const old = mark({ date: '2025-01-01' })
    const r = reconcileMarks([old], ctx({ keepDays: 120 }))
    expect(r.lost).toHaveLength(1)
    expect(r.marks).toHaveLength(1)
  })

  it('境界: 捨てる日数のちょうど境目では捨てない', () => {
    // today = 2026-03-28 / keepDays = 30 → 2026-02-26 が境目
    const onEdge = mark({ date: '2026-02-26', confirmed: true })
    const r = reconcileMarks([onEdge], ctx({ serverIds: new Set(['tx-1']), keepDays: 30 }))
    expect(r.marks).toHaveLength(1)
    const older = mark({ date: '2026-02-25', confirmed: true })
    expect(
      reconcileMarks([older], ctx({ serverIds: new Set(['tx-1']), keepDays: 30 })).marks
    ).toEqual([])
  })

  it('複数の控えをそれぞれの状況で仕分ける', () => {
    const list = [
      mark({ txId: 'a', date: '2026-01-27' }), // どこにも無い → 積み直す
      mark({ txId: 'b', date: '2026-02-27', confirmed: true }), // 消された → 忘れる
      mark({ txId: 'c', date: '2026-03-27' }), // サーバーに在る → confirmed
      mark({ txId: 'd', date: '2026-03-28' }), // キュー待ち → そのまま
    ]
    const r = reconcileMarks(
      list,
      ctx({ serverIds: new Set(['c']), queuedIds: new Set(['d']) })
    )
    expect(r.lost.map((m) => m.txId)).toEqual(['a'])
    expect(r.marks.map((m) => m.txId)).toEqual(['a', 'c', 'd'])
    expect(r.marks.find((m) => m.txId === 'c')?.confirmed).toBe(true)
  })

  it('控えが空なら何も起きない(ふだんの起動)', () => {
    expect(reconcileMarks([], ctx())).toEqual({ marks: [], lost: [] })
  })
})

describe('parseMarks', () => {
  it('配列でなければ空', () => {
    expect(parseMarks(null)).toEqual([])
    expect(parseMarks({ a: 1 })).toEqual([])
    expect(parseMarks('[]')).toEqual([])
  })

  it('壊れた要素は落とし、読める要素だけ残す', () => {
    const raw = [
      null,
      { ruleId: 'r1' },
      { ruleId: 'r1', date: '2026-03-27', txId: 'tx-1' }, // input が無い = 積み直せない
      { ruleId: 'r1', date: '2026-03-27', txId: 'tx-1', input },
    ]
    const out = parseMarks(raw)
    expect(out).toHaveLength(1)
    expect(out[0].txId).toBe('tx-1')
  })

  it('欠けた項目は安全側の既定値に寄せる', () => {
    const out = parseMarks([{ ruleId: 'r1', date: '2026-03-27', txId: 'tx-1', input }])
    // confirmed が読めないときは false = 「届いたことを確かめていない」に倒す
    // (true に倒すと、積み損ねた記録を回復できなくなる)
    expect(out[0].confirmed).toBe(false)
    expect(out[0].recoveries).toBe(0)
  })

  it('confirmed が true の控えはそのまま読む(消した記録を復活させないため)', () => {
    const out = parseMarks([
      { ruleId: 'r1', date: '2026-03-27', txId: 'tx-1', input, confirmed: true, recoveries: 2 },
    ])
    expect(out[0].confirmed).toBe(true)
    expect(out[0].recoveries).toBe(2)
  })
})

// ============================================================
// 控えの実体(localStorage)。ここが壊れると回復も重複防止も効かないので、
// 純粋関数だけでなく実物の出し入れも確かめる。
// node には localStorage が無いので最小の代役を差し込んでから読み込む。
// ============================================================

function installStorage(options: { failWrites?: boolean } = {}): Map<string, string> {
  const map = new Map<string, string>()
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (options.failWrites) throw new Error('QuotaExceededError')
      map.set(k, v)
    },
    removeItem: (k: string) => {
      map.delete(k)
    },
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  })
  return map
}

/** モジュール内のキャッシュを持ち越さないよう、毎回読み込み直す */
async function freshModule() {
  vi.resetModules()
  return await import('./recurringLedger')
}

const seed = { ruleId: 'r1', date: '2026-03-27', txId: 'tx-1', input }

describe('控えの保存と突き合わせ', () => {
  beforeEach(() => {
    installStorage()
  })

  it('残した控えは端末を開き直しても残る', async () => {
    const first = await freshModule()
    expect(first.recordGeneratedMark(seed)).toBe(true)
    const second = await freshModule()
    expect(second.hasGeneratedMark('r1', '2026-03-27')).toBe(true)
    expect(second.loadMarks()[0].confirmed).toBe(false)
  })

  it('保存できなければ false(生成側が「控えを残せなかった」と分かる)', async () => {
    installStorage({ failWrites: true })
    const l = await freshModule()
    expect(l.recordGeneratedMark(seed)).toBe(false)
    expect(l.hasGeneratedMark('r1', '2026-03-27')).toBe(false)
  })

  it('積み損ねた控えを積み直し、届いたと分かれば二度目は出さない', async () => {
    const l = await freshModule()
    l.recordGeneratedMark(seed)
    const ctx = {
      serverIds: new Set<string>(),
      queuedIds: new Set<string>(),
      quarantinedIds: new Set<string>(),
      today: '2026-03-28',
    }
    expect(l.reconcileGeneratedMarks(ctx).map((m) => m.txId)).toEqual(['tx-1'])
    // 送信に成功した = サーバーが受け付けた
    l.confirmGeneratedMarks(['tx-1'])
    expect(l.reconcileGeneratedMarks({ ...ctx, serverIds: new Set(['tx-1']) })).toEqual([])
  })

  it('利用者が消したあとは、一覧から消えていても積み直さない', async () => {
    const l = await freshModule()
    l.recordGeneratedMark(seed)
    l.confirmGeneratedMarks(['tx-1'])
    const ctx = {
      serverIds: new Set<string>(), // 消したのでサーバーにも無い
      queuedIds: new Set<string>(),
      quarantinedIds: new Set<string>(),
      today: '2026-03-28',
    }
    expect(l.reconcileGeneratedMarks(ctx)).toEqual([])
    // 控えごと消えているので、次の起動でも復活しない
    expect(l.loadMarks()).toEqual([])
    expect(l.reconcileGeneratedMarks(ctx)).toEqual([])
  })

  it('届いたことを確かめる前に消されても、忘れてあれば積み直さない', async () => {
    const l = await freshModule()
    l.recordGeneratedMark(seed)
    // 同期を待たずに利用者が削除した(この経路で forgetGeneratedMarks が呼ばれる)
    l.forgetGeneratedMarks(['tx-1'])
    expect(
      l.reconcileGeneratedMarks({
        serverIds: new Set<string>(),
        queuedIds: new Set<string>(),
        quarantinedIds: new Set<string>(),
        today: '2026-03-28',
      })
    ).toEqual([])
  })

  it('控えが空なら突き合わせは何もしない', async () => {
    const l = await freshModule()
    expect(
      l.reconcileGeneratedMarks({
        serverIds: new Set<string>(),
        queuedIds: new Set<string>(),
        quarantinedIds: new Set<string>(),
        today: '2026-03-28',
      })
    ).toEqual([])
  })

  it('書き戻せないときは積み直さない(回数を数えられないまま積み続けない)', async () => {
    const l = await freshModule()
    l.recordGeneratedMark(seed)
    installStorage({ failWrites: true })
    expect(
      l.reconcileGeneratedMarks({
        serverIds: new Set<string>(),
        queuedIds: new Set<string>(),
        quarantinedIds: new Set<string>(),
        today: '2026-03-28',
      })
    ).toEqual([])
  })
})
