// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appendOps, loadQueue, saveQueue, type PendingOp } from './offlineQueue'

const op = (id: string): PendingOp => ({ opId: `op-${id}`, kind: 'delete', id, queuedAt: '2026-10-20T00:00:00.000Z' })

beforeEach(() => localStorage.clear())

describe('appendOps', () => {
  it('今あるキューの後ろに、渡した順番のまま積む(積む順番 = 送る順番)', () => {
    saveQueue([op('a')])
    expect(appendOps([op('b'), op('c')]).map((o) => o.id)).toEqual(['a', 'b', 'c'])
    expect(loadQueue().map((o) => o.id)).toEqual(['a', 'b', 'c'])
  })

  it('何件積んでも、保存は1回だけ(件数ぶんキュー全体を読み書きしない)', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    appendOps([op('a'), op('b'), op('c')])
    expect(setItem).toHaveBeenCalledTimes(1)
    setItem.mockRestore()
  })

  it('取り消しの印 (restore) も落とさずに残す', () => {
    appendOps([{ ...op('a'), kind: 'insert', restore: true }])
    expect(loadQueue()[0].restore).toBe(true)
  })
})
