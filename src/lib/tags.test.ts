import { describe, expect, it } from 'vitest'
import type { Transaction } from './types'
import {
  MAX_TAGS_PER_TX,
  collectTags,
  matchesAnyTag,
  normalizeTag,
  parseTagInput,
  sanitizeTags,
} from './tags'

let seq = 0
function tx(p: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: `id${seq}`,
    date: '2026-08-04',
    type: 'expense',
    amount: 1000,
    category: 'food',
    memo: '',
    store: '',
    partner_amount: 0,
    created_at: '2026-08-04T03:00:00.000Z',
    ...p,
  }
}

describe('normalizeTag', () => {
  it('先頭の # は落とす(付けても付けなくても同じタグ)', () => {
    expect(normalizeTag('#旅行2026')).toBe('旅行2026')
    expect(normalizeTag('＃デート')).toBe('デート')
    expect(normalizeTag('デート')).toBe('デート')
  })

  it('前後と中の空白を落とす', () => {
    expect(normalizeTag('  旅行 2026 ')).toBe('旅行2026')
  })

  it('中身が無くなるものは null', () => {
    expect(normalizeTag('   ')).toBeNull()
    expect(normalizeTag('#')).toBeNull()
    expect(normalizeTag('')).toBeNull()
  })

  it('長すぎるタグは切る', () => {
    expect(normalizeTag('あ'.repeat(30))).toHaveLength(20)
  })
})

describe('parseTagInput', () => {
  it('空白・カンマ・読点で区切る', () => {
    expect(parseTagInput('#旅行2026 デート,記念日、外食')).toEqual([
      '旅行2026',
      'デート',
      '記念日',
      '外食',
    ])
  })

  it('空文字は空配列', () => {
    expect(parseTagInput('')).toEqual([])
    expect(parseTagInput('   ')).toEqual([])
  })
})

describe('sanitizeTags', () => {
  it('重複を落とし、入力順を保つ', () => {
    expect(sanitizeTags(['デート', '#デート', '旅行'])).toEqual(['デート', '旅行'])
  })

  it('上限を超えた分は落とす', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(sanitizeTags(many)).toHaveLength(MAX_TAGS_PER_TX)
  })
})

describe('collectTags', () => {
  it('使用回数の多い順に集める', () => {
    const rows = [
      tx({ tags: ['デート', '旅行2026'] }),
      tx({ tags: ['デート'] }),
      tx({ tags: [] }),
      tx({}), // 列が無い環境(undefined)でも落ちないこと
    ]
    expect(collectTags(rows)).toEqual([
      { tag: 'デート', count: 2 },
      { tag: '旅行2026', count: 1 },
    ])
  })

  it('同数のときは名前順で並びが必ず決まる', () => {
    const rows = [tx({ tags: ['b'] }), tx({ tags: ['a'] })]
    expect(collectTags(rows).map((t) => t.tag)).toEqual(['a', 'b'])
  })
})

describe('matchesAnyTag', () => {
  const t = tx({ tags: ['デート', '旅行2026'] })

  it('選んでいなければ全件を通す', () => {
    expect(matchesAnyTag(t, [])).toBe(true)
    expect(matchesAnyTag(tx({}), [])).toBe(true)
  })

  it('どれかが付いていれば通す(カテゴリの絞り込みと同じ OR)', () => {
    expect(matchesAnyTag(t, ['デート'])).toBe(true)
    expect(matchesAnyTag(t, ['記念日', '旅行2026'])).toBe(true)
    expect(matchesAnyTag(t, ['記念日'])).toBe(false)
  })

  it('タグを持たない記録は絞り込みから外れる', () => {
    expect(matchesAnyTag(tx({}), ['デート'])).toBe(false)
  })
})
