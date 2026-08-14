import { describe, expect, it } from 'vitest'
import {
  isFavorAmountRejection,
  isLedgerTypeRejection,
  markTxFeatureUnavailable,
  stripUnavailableColumns,
} from './txExtensions'

// ============================================================
// 後から足した列が無いサーバーでも、記録そのものは必ず通ること。
//
// このモジュールの状態(どの機能が使えるか)はモジュール全体で1つなので、
// 「使えない」に倒すテストは **このファイルの最後** に置く。
// 先に倒すと、それ以降のテストが別の前提で走ってしまう。
// ============================================================

describe('isFavorAmountRejection', () => {
  const err = {
    message: 'new row for relation "transactions" violates check constraint "transactions_amount_check"',
    code: '23514',
  }

  it('支払い 0円 の支出が弾かれたときだけ、おごりの制約違反とみなす', () => {
    expect(isFavorAmountRejection(err, { type: 'expense', amount: 0 })).toBe(true)
  })

  it('金額が入っている記録は対象外(原因は別にある)', () => {
    expect(isFavorAmountRejection(err, { type: 'expense', amount: 1000 })).toBe(false)
  })

  it('調整のマイナス金額とは取り違えない(同じ制約名でも中身が違う)', () => {
    expect(isFavorAmountRejection(err, { type: 'partner_adjust', amount: -500 })).toBe(false)
    // そちらは種別を見る側が拾う
    expect(isLedgerTypeRejection(err, 'partner_adjust')).toBe(true)
  })

  it('制約違反でないエラーは対象外(通信エラーで記録を捨てないため)', () => {
    expect(isFavorAmountRejection({ message: 'Failed to fetch' }, { type: 'expense', amount: 0 })).toBe(
      false
    )
  })

  it('送る内容が分からないときは判断しない', () => {
    expect(isFavorAmountRejection(err, undefined)).toBe(false)
  })
})

describe('stripUnavailableColumns', () => {
  it('列がそろっているうちは、送る内容を1つも削らない', () => {
    const payload = {
      amount: 0,
      favor_amount: 3200,
      favor_kind: 'treat',
      favor_from: '田中',
      tags: ['外食'],
    }
    expect(stripUnavailableColumns(payload)).toEqual(payload)
  })

  it('おごりの列が無いと分かったら、3つともキーごと落とす(記録の本体は残る)', () => {
    // ここでモジュールの状態を倒すので、このテストは最後に置いてある
    markTxFeatureUnavailable('favor')
    const out = stripUnavailableColumns({
      amount: 1000,
      favor_amount: 500,
      favor_kind: 'discount',
      favor_from: '',
      tags: ['外食'],
    })
    expect('favor_amount' in out).toBe(false)
    expect('favor_kind' in out).toBe(false)
    expect('favor_from' in out).toBe(false)
    // 金額とタグ(別の機能)は残る
    expect(out.amount).toBe(1000)
    expect(out.tags).toEqual(['外食'])
  })
})
