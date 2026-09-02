import { describe, expect, it } from 'vitest'
import { isDuplicateRowError, isRetryableServerError, isSchemaError } from './serverErrors'

// ============================================================
// 「その行はもう入っている」(23505) の見分け。
//
// 行の UUID は端末が採番しているので、**自分が送ろうとしている id** が
// すでにサーバーに在る = 前回の送信は届いていた、ということ。成功として扱う。
// ただし 23505 は主キー以外の一意制約でも起きるので、無関係な重複まで
// 成功に倒してはいけない。
//
// 下の応答は実測したもの(自前の PostgREST 互換サーバーに supabase-js から
// 同じ id を2回 insert して受け取った中身)。どの列のどの値がぶつかったかは
// details にしか出ないので、判定の根拠もそこに置いている。
// ============================================================

const ROW = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'

/** 実測した「同じ行IDをもう一度 insert した」ときの応答 */
function pkeyViolation(rowId: string) {
  return {
    code: '23505',
    message: 'duplicate key value violates unique constraint "transactions_pkey"',
    details: `Key (id)=(${rowId}) already exists.`,
    hint: null,
  }
}

describe('isDuplicateRowError', () => {
  it('いま送ろうとしている行IDが原因の重複は「すでに入っている」と見なす', () => {
    expect(isDuplicateRowError(pkeyViolation(ROW), ROW)).toBe(true)
  })

  it('別の行の重複は見なさない(他人の行・別の会計を成功にしない)', () => {
    expect(isDuplicateRowError(pkeyViolation('bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'), ROW)).toBe(
      false
    )
  })

  it('id 以外の一意制約(共有リンクのトークン重複など)は見なさない', () => {
    expect(
      isDuplicateRowError(
        {
          code: '23505',
          message: 'duplicate key value violates unique constraint "partner_share_links_token_key"',
          details: 'Key (token)=(abc123) already exists.',
          hint: null,
        },
        ROW
      )
    ).toBe(false)
  })

  it('どの値がぶつかったのか分からない応答は、今までどおり拒否として扱う', () => {
    // details が無ければ「自分の行が原因」と言い切れない。
    // 取りこぼしても記録は隔離箱に残るので、安全側に倒す
    expect(
      isDuplicateRowError(
        { code: '23505', message: 'duplicate key value violates unique constraint', details: null },
        ROW
      )
    ).toBe(false)
  })

  it('重複以外のエラーは見なさない', () => {
    expect(
      isDuplicateRowError(
        {
          code: '23514',
          message: 'new row violates check constraint "transactions_amount_check"',
          details: `Failing row contains (${ROW}, 0).`,
          hint: null,
        },
        ROW
      )
    ).toBe(false)
    expect(isDuplicateRowError({ message: 'TypeError: Failed to fetch' }, ROW)).toBe(false)
  })

  it('uuid の英大小は問わない(端末側の採番と DB の表記が違っても同じ行)', () => {
    expect(isDuplicateRowError(pkeyViolation(ROW.toUpperCase()), ROW)).toBe(true)
  })

  it('重複は「マイグレーション未実行」でも「再試行すべき失敗」でもない', () => {
    // 既存の分類は一切変えていないことの控え(ここが変わると案内文が入れ替わる)
    expect(isSchemaError(pkeyViolation(ROW))).toBe(false)
    expect(isRetryableServerError(pkeyViolation(ROW))).toBe(false)
  })
})
