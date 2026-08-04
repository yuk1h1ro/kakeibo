import { describe, expect, it } from 'vitest'
import {
  daysUntil,
  expiryFromDays,
  pickActiveLink,
  shareLinkStatus,
  type ShareLink,
} from './shareLinks'

const link = (o: Partial<ShareLink> & { id: string }): ShareLink => ({
  token: 'a'.repeat(48),
  expiresAt: null,
  revokedAt: null,
  lastViewedAt: null,
  createdAt: '2026-02-01T00:00:00.000Z',
  ...o,
})

const NOW = '2026-03-01T00:00:00.000Z'

describe('shareLinkStatus', () => {
  it('無期限で無効化されていなければ有効', () => {
    expect(shareLinkStatus(link({ id: '1' }), NOW)).toBe('active')
  })

  it('期限が先ならまだ有効', () => {
    expect(shareLinkStatus(link({ id: '1', expiresAt: '2026-03-02T00:00:00.000Z' }), NOW)).toBe(
      'active'
    )
  })

  it('期限ちょうどは切れている扱い(境界は安全側に倒す)', () => {
    expect(shareLinkStatus(link({ id: '1', expiresAt: NOW }), NOW)).toBe('expired')
  })

  it('期限を過ぎていれば expired', () => {
    expect(shareLinkStatus(link({ id: '1', expiresAt: '2026-02-28T23:59:59.000Z' }), NOW)).toBe(
      'expired'
    )
  })

  it('無効化されていれば、期限が残っていても revoked', () => {
    expect(
      shareLinkStatus(
        link({ id: '1', revokedAt: '2026-02-10T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' }),
        NOW
      )
    ).toBe('revoked')
  })
})

describe('pickActiveLink', () => {
  it('有効なものが無ければ null', () => {
    expect(pickActiveLink([], NOW)).toBeNull()
    expect(
      pickActiveLink([link({ id: '1', revokedAt: '2026-02-10T00:00:00.000Z' })], NOW)
    ).toBeNull()
  })

  it('有効なもののうち最も新しいものを選ぶ', () => {
    const chosen = pickActiveLink(
      [
        link({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }),
        link({ id: 'new', createdAt: '2026-02-20T00:00:00.000Z' }),
        link({ id: 'revoked', createdAt: '2026-02-28T00:00:00.000Z', revokedAt: NOW }),
      ],
      NOW
    )
    expect(chosen?.id).toBe('new')
  })
})

describe('expiryFromDays', () => {
  const base = new Date('2026-03-01T09:00:00.000Z')

  it('null なら無期限', () => {
    expect(expiryFromDays(base, null)).toBeNull()
  })

  it('n日後のISO文字列になる', () => {
    expect(expiryFromDays(base, 30)).toBe('2026-03-31T09:00:00.000Z')
  })

  it('月末・年末をまたいでも壊れない', () => {
    expect(expiryFromDays(new Date('2025-12-20T00:00:00.000Z'), 30)).toBe(
      '2026-01-19T00:00:00.000Z'
    )
  })
})

describe('daysUntil', () => {
  it('無期限なら null', () => {
    expect(daysUntil(null, NOW)).toBeNull()
  })

  it('残り日数を切り上げで返す', () => {
    expect(daysUntil('2026-03-02T00:00:00.000Z', NOW)).toBe(1)
    expect(daysUntil('2026-03-01T01:00:00.000Z', NOW)).toBe(1)
  })

  it('過ぎていれば 0 以下', () => {
    expect(daysUntil('2026-02-28T00:00:00.000Z', NOW)).toBe(-1)
  })
})
