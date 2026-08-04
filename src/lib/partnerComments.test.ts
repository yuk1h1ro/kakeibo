import { describe, expect, it } from 'vitest'
import {
  groupCommentsByTransaction,
  hasUnread,
  MAX_COMMENT_LENGTH,
  normalizeCommentBody,
  unreadCommentCount,
  validateComment,
  type PartnerComment,
} from './partnerComments'

const comment = (o: Partial<PartnerComment> & { id: string }): PartnerComment => ({
  transactionId: 't1',
  author: 'partner',
  body: 'こめんと',
  createdAt: '2026-02-01T00:00:00Z',
  readByOwner: false,
  ...o,
})

describe('normalizeCommentBody', () => {
  it('前後の空白と改行を落とす', () => {
    expect(normalizeCommentBody('  ありがとう \n')).toBe('ありがとう')
  })

  it('連続する空行を2行までにする', () => {
    expect(normalizeCommentBody('あ\n\n\n\n\nい')).toBe('あ\n\nい')
  })

  it('CRLF を LF にそろえる', () => {
    expect(normalizeCommentBody('あ\r\nい')).toBe('あ\nい')
  })

  it('制御文字を落とす', () => {
    expect(normalizeCommentBody('あ\u0007\u0000い')).toBe('あい')
  })

  it('HTML に見える文字列もそのまま文字として残す(描画側でテキスト扱いするため)', () => {
    expect(normalizeCommentBody('<script>alert(1)</script>')).toBe('<script>alert(1)</script>')
  })
})

describe('validateComment', () => {
  it('普通の文は通る', () => {
    const v = validateComment('これなに?')
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.body).toBe('これなに?')
  })

  it('空・空白だけは弾く', () => {
    expect(validateComment('').ok).toBe(false)
    expect(validateComment('   \n  ').ok).toBe(false)
  })

  it('上限ちょうどは通り、1文字超えると弾く', () => {
    expect(validateComment('あ'.repeat(MAX_COMMENT_LENGTH)).ok).toBe(true)
    const over = validateComment('あ'.repeat(MAX_COMMENT_LENGTH + 1))
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.reason).toBe('length')
  })

  it('前後の空白を除いた長さで判定する', () => {
    expect(validateComment(`   ${'あ'.repeat(MAX_COMMENT_LENGTH)}   `).ok).toBe(true)
  })
})

describe('groupCommentsByTransaction', () => {
  it('明細ごとに古い順でまとめる', () => {
    const grouped = groupCommentsByTransaction([
      comment({ id: 'b', transactionId: 't1', createdAt: '2026-02-02T00:00:00Z' }),
      comment({ id: 'a', transactionId: 't1', createdAt: '2026-02-01T00:00:00Z' }),
      comment({ id: 'c', transactionId: 't2', createdAt: '2026-02-03T00:00:00Z' }),
    ])
    expect(grouped.t1.map((c) => c.id)).toEqual(['a', 'b'])
    expect(grouped.t2.map((c) => c.id)).toEqual(['c'])
  })

  it('コメントが無ければ空', () => {
    expect(groupCommentsByTransaction([])).toEqual({})
  })
})

describe('unreadCommentCount / hasUnread', () => {
  it('未読の彼女のコメントだけ数える', () => {
    const list = [
      comment({ id: 'a', author: 'partner', readByOwner: false }),
      comment({ id: 'b', author: 'partner', readByOwner: true }),
      comment({ id: 'c', author: 'owner', readByOwner: false }), // 自分の投稿は未読にしない
    ]
    expect(unreadCommentCount(list)).toBe(1)
    expect(hasUnread(list)).toBe(true)
  })

  it('全部読んでいれば 0', () => {
    expect(unreadCommentCount([comment({ id: 'a', readByOwner: true })])).toBe(0)
    expect(hasUnread([])).toBe(false)
  })
})
