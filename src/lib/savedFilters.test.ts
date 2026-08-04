import { describe, expect, it } from 'vitest'
import { DEFAULT_FILTER, type HistoryFilter } from './historyFilter'
import {
  MAX_SAVED_FILTERS,
  addSavedFilter,
  canSaveFilter,
  findMatchingFilter,
  parseSavedFilters,
  removeSavedFilter,
  type SavedFilter,
} from './savedFilters'

function saved(name: string, filter: Partial<HistoryFilter> = {}): SavedFilter {
  return {
    id: name,
    name,
    filter: { ...DEFAULT_FILTER, ...filter },
    createdAt: '2026-08-04T00:00:00.000Z',
  }
}

describe('addSavedFilter', () => {
  it('追加できる', () => {
    const list = addSavedFilter([], saved('今月の外食', { categories: ['eating_out'] }))
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('今月の外食')
  })

  it('同じ名前は上書きする(選べない重複を作らない)', () => {
    const first = addSavedFilter([], saved('外食', { categories: ['eating_out'] }))
    const second = addSavedFilter(first, { ...saved('外食', { categories: ['food'] }), id: 'x' })
    expect(second).toHaveLength(1)
    expect(second[0].filter.categories).toEqual(['food'])
  })

  it('上限を超えたら古いものから捨てる', () => {
    let list: SavedFilter[] = []
    for (let i = 0; i < MAX_SAVED_FILTERS + 3; i++) {
      list = addSavedFilter(list, saved(`条件${i}`))
    }
    expect(list).toHaveLength(MAX_SAVED_FILTERS)
    expect(list[0].name).toBe('条件3')
  })

  it('名前の前後の空白は落とす', () => {
    const list = addSavedFilter([], saved('  外食  '))
    expect(list[0].name).toBe('外食')
  })
})

describe('removeSavedFilter / findMatchingFilter', () => {
  const list = [saved('a', { query: 'スタバ' }), saved('b', { period: 'month' })]

  it('消せる', () => {
    expect(removeSavedFilter(list, 'a').map((s) => s.name)).toEqual(['b'])
  })

  it('いまの絞り込みと同じ保存条件が分かる', () => {
    const match = findMatchingFilter(list, { ...DEFAULT_FILTER, period: 'month' })
    expect(match?.name).toBe('b')
  })

  it('一致しなければ null', () => {
    expect(findMatchingFilter(list, DEFAULT_FILTER)).toBeNull()
  })
})

describe('canSaveFilter', () => {
  it('何も絞っていない状態は保存させない', () => {
    expect(canSaveFilter(DEFAULT_FILTER)).toBe(false)
    expect(canSaveFilter({ ...DEFAULT_FILTER, query: 'スタバ' })).toBe(true)
  })
})

describe('parseSavedFilters', () => {
  it('壊れた内容は捨てて、読める分だけ返す', () => {
    const raw = [
      null,
      { id: '1' },
      { id: '2', name: 'ok', filter: { query: 'スタバ' } },
      'ごみ',
    ]
    const got = parseSavedFilters(raw)
    expect(got).toHaveLength(1)
    expect(got[0].filter).toEqual({
      query: 'スタバ',
      sort: DEFAULT_FILTER.sort,
      period: DEFAULT_FILTER.period,
      categories: [],
    })
  })

  it('配列でなければ空', () => {
    expect(parseSavedFilters({ a: 1 })).toEqual([])
  })
})
