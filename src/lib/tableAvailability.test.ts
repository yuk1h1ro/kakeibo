// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createTableAvailability } from './tableAvailability'

// ============================================================
// 「マイグレーション未実行」の見分け方と覚え方。
//
// ここが甘くなると、テーブルが無いのに書き込みを試し続ける(= 同期が詰まる)か、
// 逆にただの通信エラーを「テーブルが無い」と誤判定して機能を消してしまう。
// 9モジュールに散っていた判定を寄せたので、**寄せる前の各実装が持っていた
// 判定条件**をここで固定しておく。
// ============================================================

const KEY = 'kakeibo.tableMissing.demo_table'

beforeEach(() => {
  localStorage.clear()
})

describe('createTableAvailability の判定条件', () => {
  it('既定は「在る」— 何も分かっていないうちに機能を消さない', () => {
    const a = createTableAvailability('demo_table')
    expect(a.isMissing()).toBe(false)
    expect(a.getAvailableSnapshot()).toBe(true)
  })

  // 寄せる前は各モジュールが isSchemaError(error) を直接呼んでいた。
  // 見ているコードは serverErrors.ts の3つ
  it.each([
    ['42P01', 'relation "public.recurring_rules" does not exist'],
    ['42703', 'column transactions.satisfaction does not exist'],
    ['PGRST204', "Could not find the 'tags' column in the schema cache"],
  ])('コード %s はテーブル未作成と見なす', (code, message) => {
    const a = createTableAvailability('demo_table')
    expect(a.noteError({ code, message })).toBe(true)
    expect(a.isMissing()).toBe(true)
  })

  it.each([
    'relation "public.partner_share_links" does not exist',
    "Could not find the table 'public.transaction_templates' in the schema cache",
    'could not find the function',
  ])('コードが無くても文言で見分ける: %s', (message) => {
    const a = createTableAvailability('demo_table')
    a.noteError({ message })
    expect(a.isMissing()).toBe(true)
  })

  it('details / hint に出ていても見逃さない', () => {
    const a = createTableAvailability('demo_table')
    a.noteError({ message: 'Bad Request', details: 'relation does not exist', hint: null })
    expect(a.isMissing()).toBe(true)
  })

  it('通信エラーはテーブル未作成にしない(オフラインで機能が消えてしまう)', () => {
    const a = createTableAvailability('demo_table')
    expect(a.noteError({ message: 'TypeError: Failed to fetch', code: null })).toBe(false)
    expect(a.noteError({ message: 'Load failed' })).toBe(false)
    expect(a.isMissing()).toBe(false)
  })

  it('制約違反(23505 / 23514)もテーブル未作成にしない', () => {
    const a = createTableAvailability('demo_table')
    a.noteError({ code: '23505', message: 'duplicate key value violates unique constraint' })
    a.noteError({ code: '23514', message: 'violates check constraint' })
    expect(a.isMissing()).toBe(false)
  })

  // 寄せる前は catch 側だけ isSchemaError(toServerError(e)) と書き分けていた。
  // 書き忘れるとそこだけ判定が甘くなるので、例外もそのまま渡せるようにしてある
  it('catch した例外もそのまま渡せる', () => {
    const a = createTableAvailability('demo_table')
    a.noteError(new Error('relation "public.transaction_changes" does not exist'))
    expect(a.isMissing()).toBe(true)
  })

  it('null / undefined を渡しても倒れない', () => {
    const a = createTableAvailability('demo_table')
    expect(a.noteError(null)).toBe(false)
    expect(a.noteError(undefined)).toBe(false)
    expect(a.isMissing()).toBe(false)
  })

  // noteError の戻り値は「そのエラーがテーブル未作成を意味するか」。
  // 何度でも同じ答えを返す — 呼び出し側はこれを見て手元を空にするので、
  // 「2度目は false」にすると、2度目の検知だけ後始末が走らなくなる
  it('noteError は同じエラーなら何度でも true を返す', () => {
    const a = createTableAvailability('demo_table')
    expect(a.noteError({ code: '42P01', message: 'does not exist' })).toBe(true)
    expect(a.noteError({ code: '42P01', message: 'does not exist' })).toBe(true)
  })

  it('markMissing / markPresent の戻り値は「判定が変わったか」', () => {
    const a = createTableAvailability('demo_table')
    expect(a.markMissing()).toBe(true)
    expect(a.markMissing()).toBe(false)
    expect(a.markPresent()).toBe(true)
    expect(a.markPresent()).toBe(false)
  })

  it('購読者には判定が変わったときだけ通知する', () => {
    const a = createTableAvailability('demo_table')
    let calls = 0
    const unsubscribe = a.subscribe(() => {
      calls += 1
    })
    a.markMissing()
    a.markMissing()
    expect(calls).toBe(1)
    a.markPresent()
    expect(calls).toBe(2)
    unsubscribe()
    a.markMissing()
    expect(calls).toBe(2)
  })
})

describe('オフライン起動でも前回の答えが効く', () => {
  it('「無い」と分かった答えは localStorage に残る', () => {
    createTableAvailability('demo_table').markMissing()
    expect(localStorage.getItem(KEY)).toBe('1')
  })

  it('次の起動では、サーバーに問い合わせる前から「無い」と分かっている', () => {
    localStorage.setItem(KEY, '1')
    const next = createTableAvailability('demo_table')
    expect(next.isMissing()).toBe(true)
    expect(next.getAvailableSnapshot()).toBe(false)
  })

  it('マイグレーションを実行したあとは、読めた時点で答えが戻る', () => {
    localStorage.setItem(KEY, '1')
    const a = createTableAvailability('demo_table')
    expect(a.markPresent()).toBe(true)
    expect(localStorage.getItem(KEY)).toBe('0')
    expect(createTableAvailability('demo_table').isMissing()).toBe(false)
  })

  it('壊れた値は「在る」に倒す(機能が消えたままになるより安全)', () => {
    localStorage.setItem(KEY, 'なにか別の値')
    expect(createTableAvailability('demo_table').isMissing()).toBe(false)
  })

  it('モジュールごとにキーが分かれている', () => {
    createTableAvailability('recurring_rules').markMissing()
    expect(createTableAvailability('transaction_templates').isMissing()).toBe(false)
    expect(localStorage.getItem('kakeibo.tableMissing.recurring_rules')).toBe('1')
  })

  // 起動のたびに必ず確かめ直す経路が無いモジュール(monthlySummary / changeLog)は
  // 覚えさせない。覚えたまま誰も確かめ直さないと、マイグレーションを実行しても
  // 機能が戻らなくなるため
  it('remember: false のときは残さないし、読みもしない', () => {
    localStorage.setItem(KEY, '1')
    const a = createTableAvailability('demo_table', { remember: false })
    expect(a.isMissing()).toBe(false)
    a.markMissing()
    expect(localStorage.getItem(KEY)).toBe('1') // 触っていない(前の値のまま)
    expect(createTableAvailability('demo_table', { remember: false }).isMissing()).toBe(false)
  })

  it('resetForTest は覚えている答えごと捨てる', () => {
    const a = createTableAvailability('demo_table')
    a.markMissing()
    a.resetForTest()
    expect(a.isMissing()).toBe(false)
    expect(localStorage.getItem(KEY)).toBe(null)
  })
})
