import { describe, expect, it } from 'vitest'
import {
  BOM,
  CSV_HEADERS,
  csvFileName,
  describeRange,
  escapeCsvField,
  exportMonths,
  exportYears,
  filterByRange,
  isSameRange,
  sourceLabel,
  toCsvRow,
  toCsvText,
  transactionToCsvRow,
  transactionsCsv,
  typeLabel,
  withBom,
  type ExportRange,
} from './csvExport'
import type { Transaction } from './types'

// ============================================================
// CSV 書き出し (機能198) のテスト。
//
// これはバックアップなので、いちばん怖いのは「壊れているのに気付かないまま
// 保存され、必要になったときに読めない」こと。したがってここでは
// **書き出した文字列を読み直して、列が元どおりに戻るか** を確かめる。
// 目視できる形(文字列の比較)だけでは、カンマ入りのメモで列がずれても
// 「そういう文字列ですね」で通ってしまう。
// ============================================================

/**
 * テスト用の素朴な RFC 4180 パーサ。
 * 本体の実装とは独立に(逆向きに)書くことに意味がある —
 * 同じ考え違いを両方に埋め込まない限り、ずれていれば落ちる。
 */
function parseCsv(text: string): string[][] {
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      field += c
      i += 1
      continue
    }
    if (c === '"' && field === '') {
      quoted = true
      i += 1
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (c === '\r' && body[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 2
      continue
    }
    field += c
    i += 1
  }
  row.push(field)
  rows.push(row)
  return rows
}

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1',
    date: '2026-08-03',
    type: 'expense',
    amount: 1200,
    category: 'food',
    memo: '',
    store: 'スーパー',
    partner_amount: 0,
    created_at: '2026-08-03T01:00:00.000Z',
    ...over,
  }
}

// カテゴリIDから表示名を引く役(画面では categories.ts の categoryLabel が入る)
const labelOf = (id: string) => ({ food: '食費', eating_out: '外食' })[id] ?? id

const col = (header: (typeof CSV_HEADERS)[number]) => CSV_HEADERS.indexOf(header)

describe('escapeCsvField (RFC 4180)', () => {
  it('ふつうの値は囲まない', () => {
    expect(escapeCsvField('スーパー')).toBe('スーパー')
    expect(escapeCsvField('')).toBe('')
    expect(escapeCsvField('1200')).toBe('1200')
  })

  it('カンマを含む値は囲む', () => {
    expect(escapeCsvField('ラーメン、餃子')).toBe('ラーメン、餃子') // 読点は区切りではない
    expect(escapeCsvField('ラーメン,餃子')).toBe('"ラーメン,餃子"')
  })

  it('引用符は倍にして囲む', () => {
    expect(escapeCsvField('a"b')).toBe('"a""b"')
    expect(escapeCsvField('"')).toBe('""""')
    expect(escapeCsvField('""')).toBe('""""""')
  })

  it('改行(LF / CRLF / CR 単独)を含む値は囲む', () => {
    expect(escapeCsvField('1行目\n2行目')).toBe('"1行目\n2行目"')
    expect(escapeCsvField('1行目\r\n2行目')).toBe('"1行目\r\n2行目"')
    expect(escapeCsvField('1行目\r2行目')).toBe('"1行目\r2行目"')
  })

  it('カンマ・引用符・改行が全部入っていても囲める', () => {
    expect(escapeCsvField('a,"b"\nc')).toBe('"a,""b""\nc"')
  })
})

describe('toCsvRow / toCsvText', () => {
  it('項目をカンマで、行を CRLF でつなぐ', () => {
    expect(toCsvRow(['a', 'b'])).toBe('a,b')
    expect(toCsvText([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d')
  })

  it('末尾に改行を付けない(素朴に分割しても空行が出ない)', () => {
    expect(toCsvText([['a']]).endsWith('\r\n')).toBe(false)
  })
})

describe('withBom', () => {
  it('BOM を先頭に付ける', () => {
    expect(withBom('日付')).toBe('﻿日付')
  })

  it('二重には付けない', () => {
    expect(withBom(withBom('日付'))).toBe('﻿日付')
  })
})

describe('transactionToCsvRow', () => {
  it('カテゴリは ID ではなく表示名で出す(ID は別の列に残す)', () => {
    const row = transactionToCsvRow(tx({ category: 'eating_out' }), labelOf)
    expect(row[col('カテゴリ')]).toBe('外食')
    expect(row[col('カテゴリID')]).toBe('eating_out')
  })

  it('カテゴリ未設定は空欄(「未分類」という名前のカテゴリと区別が付かなくなるため)', () => {
    const row = transactionToCsvRow(tx({ category: null }), labelOf)
    expect(row[col('カテゴリ')]).toBe('')
    expect(row[col('カテゴリID')]).toBe('')
  })

  it('金額は通貨記号も桁区切りも付けない素の整数', () => {
    const row = transactionToCsvRow(tx({ amount: 1234567 }), labelOf)
    expect(row[col('金額')]).toBe('1234567')
  })

  it('0円でも空欄にしない(「入っていない」との区別が付かなくなるため)', () => {
    const row = transactionToCsvRow(tx({ amount: 0, partner_amount: 0 }), labelOf)
    expect(row[col('金額')]).toBe('0')
    expect(row[col('彼女の負担分')]).toBe('0')
    expect(row[col('彼女が払った額')]).toBe('0')
  })

  it('マイナス(調整)もそのまま出す', () => {
    const row = transactionToCsvRow(
      tx({ type: 'partner_adjust', amount: -3000, category: null, store: '' }),
      labelOf
    )
    expect(row[col('種別')]).toBe('調整')
    expect(row[col('金額')]).toBe('-3000')
  })

  it('種別は日本語にする', () => {
    expect(typeLabel('expense')).toBe('支出')
    expect(typeLabel('partner_deposit')).toBe('預かり')
    expect(typeLabel('partner_refund')).toBe('返金')
    expect(typeLabel('partner_adjust')).toBe('調整')
  })

  it('タグは0個なら空欄、複数なら空白区切り', () => {
    expect(transactionToCsvRow(tx({ tags: [] }), labelOf)[col('タグ')]).toBe('')
    expect(transactionToCsvRow(tx({ tags: undefined }), labelOf)[col('タグ')]).toBe('')
    expect(transactionToCsvRow(tx({ tags: ['デート', '旅行2026'] }), labelOf)[col('タグ')]).toBe(
      'デート 旅行2026'
    )
  })

  it('彼女の負担分・彼女が払った額を落とさない', () => {
    const row = transactionToCsvRow(
      tx({ amount: 5000, partner_amount: 2000, partner_paid: 5000 }),
      labelOf
    )
    expect(row[col('彼女の負担分')]).toBe('2000')
    expect(row[col('彼女が払った額')]).toBe('5000')
  })

  it('彼女が払った額の列が無い環境では 0(自分が全額払った)', () => {
    const row = transactionToCsvRow(tx({ partner_paid: undefined }), labelOf)
    expect(row[col('彼女が払った額')]).toBe('0')
  })

  it('分割の束ねIDを落とさない', () => {
    const row = transactionToCsvRow(tx({ split_group: 'g-1' }), labelOf)
    expect(row[col('分割ID')]).toBe('g-1')
    expect(transactionToCsvRow(tx({ split_group: null }), labelOf)[col('分割ID')]).toBe('')
  })

  it('気分は日本語、未設定・未知の値は空欄', () => {
    expect(transactionToCsvRow(tx({ satisfaction: 'good' }), labelOf)[col('気分')]).toBe('満足')
    expect(transactionToCsvRow(tx({ satisfaction: 'neutral' }), labelOf)[col('気分')]).toBe('普通')
    expect(transactionToCsvRow(tx({ satisfaction: 'regret' }), labelOf)[col('気分')]).toBe('後悔')
    expect(transactionToCsvRow(tx({ satisfaction: null }), labelOf)[col('気分')]).toBe('')
  })

  it('記録元は手入力/繰り返し入力。知らない値はそのまま残す', () => {
    expect(sourceLabel(undefined)).toBe('手入力')
    expect(sourceLabel(null)).toBe('手入力')
    expect(sourceLabel('recurring')).toBe('繰り返し入力')
    expect(sourceLabel('import')).toBe('import')
  })

  it('日付・記録日時・ID を落とさない', () => {
    const row = transactionToCsvRow(tx(), labelOf)
    expect(row[col('日付')]).toBe('2026-08-03')
    expect(row[col('記録日時')]).toBe('2026-08-03T01:00:00.000Z')
    expect(row[col('ID')]).toBe('t1')
  })

  it('列の数は見出しと必ず一致する', () => {
    expect(transactionToCsvRow(tx(), labelOf)).toHaveLength(CSV_HEADERS.length)
  })

  it('欠けている値(null が入っていた古い行)でも落ちずに空欄にする', () => {
    const broken = { ...tx(), memo: null, store: undefined } as unknown as Transaction
    const row = transactionToCsvRow(broken, labelOf)
    expect(row[col('メモ')]).toBe('')
    expect(row[col('お店')]).toBe('')
  })
})

describe('transactionsCsv', () => {
  it('BOM 付き・見出しから始まる', () => {
    const csv = transactionsCsv([tx()], labelOf)
    expect(csv.startsWith(BOM)).toBe(true)
    expect(parseCsv(csv)[0]).toEqual([...CSV_HEADERS])
  })

  it('記録0件でも見出しだけの CSV を返す', () => {
    const rows = parseCsv(transactionsCsv([], labelOf))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual([...CSV_HEADERS])
  })

  it('日付の昇順 → 記録日時の昇順に並べる(家計簿として上から読めるように)', () => {
    const csv = transactionsCsv(
      [
        tx({ id: 'c', date: '2026-08-05', created_at: '2026-08-05T00:00:00.000Z' }),
        tx({ id: 'b', date: '2026-08-03', created_at: '2026-08-03T09:00:00.000Z' }),
        tx({ id: 'a', date: '2026-08-03', created_at: '2026-08-03T01:00:00.000Z' }),
      ],
      labelOf
    )
    const ids = parseCsv(csv)
      .slice(1)
      .map((r) => r[col('ID')])
    expect(ids).toEqual(['a', 'b', 'c'])
  })

  // ---- ここが本丸: 危ない文字が入っていても列がずれないこと ----

  it('カンマを含むメモでも列がずれない', () => {
    const csv = transactionsCsv([tx({ memo: 'ラーメン,餃子' })], labelOf)
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toHaveLength(CSV_HEADERS.length)
    expect(rows[1][col('メモ')]).toBe('ラーメン,餃子')
    expect(rows[1][col('タグ')]).toBe('')
  })

  it('改行を含むメモでも行がずれない', () => {
    const csv = transactionsCsv(
      [tx({ memo: '1行目\n2行目', store: 'A\r\nB' }), tx({ id: 't2', date: '2026-08-04' })],
      labelOf
    )
    const rows = parseCsv(csv)
    expect(rows).toHaveLength(3) // 見出し + 2件。メモの改行で行が増えない
    expect(rows[1][col('メモ')]).toBe('1行目\n2行目')
    expect(rows[1][col('お店')]).toBe('A\r\nB')
    expect(rows[2][col('ID')]).toBe('t2')
  })

  it('引用符を含む店名でも読み直せる', () => {
    const csv = transactionsCsv([tx({ store: '"かど" の店', memo: 'いわゆる "定番"' })], labelOf)
    const rows = parseCsv(csv)
    expect(rows[1][col('お店')]).toBe('"かど" の店')
    expect(rows[1][col('メモ')]).toBe('いわゆる "定番"')
  })

  it('カンマ・改行・引用符が全部入っていても、全列が元どおり読み直せる', () => {
    const nasty = tx({
      id: 'x,1',
      store: 'カフェ,"ラ",\r\n本店',
      memo: '1行目\n"2行目",おわり',
      tags: ['デート', '旅行2026'],
      amount: 5000,
      partner_amount: 2500,
      partner_paid: 5000,
      satisfaction: 'good',
      split_group: 'g,1',
      source: 'recurring',
    })
    const rows = parseCsv(transactionsCsv([nasty], labelOf))
    expect(rows).toHaveLength(2)
    expect(rows[1]).toEqual([
      '2026-08-03',
      '支出',
      '5000',
      '食費',
      'カフェ,"ラ",\r\n本店',
      '1行目\n"2行目",おわり',
      'デート 旅行2026',
      '2500',
      '5000',
      '満足',
      '繰り返し入力',
      '2026-08-03T01:00:00.000Z',
      'g,1',
      'food',
      'x,1',
    ])
  })

  it('空の値ばかりの記録でも列数を保つ', () => {
    const csv = transactionsCsv(
      [tx({ store: '', memo: '', category: null, tags: [], split_group: null })],
      labelOf
    )
    const rows = parseCsv(csv)
    expect(rows[1]).toHaveLength(CSV_HEADERS.length)
    expect(rows[1][col('メモ')]).toBe('')
  })

  it('数式に見える文字列も原文のまま出す(バックアップは入っていたとおりが最優先)', () => {
    const rows = parseCsv(transactionsCsv([tx({ store: '=SUM(A1)' })], labelOf))
    expect(rows[1][col('お店')]).toBe('=SUM(A1)')
  })
})

describe('期間', () => {
  const rows = [
    tx({ id: 'a', date: '2025-12-31' }),
    tx({ id: 'b', date: '2026-07-15' }),
    tx({ id: 'c', date: '2026-08-03' }),
  ]

  it('全期間は全部返す', () => {
    expect(filterByRange(rows, { kind: 'all' })).toHaveLength(3)
  })

  it('年で絞る', () => {
    expect(filterByRange(rows, { kind: 'year', value: '2026' }).map((t) => t.id)).toEqual(['b', 'c'])
    expect(filterByRange(rows, { kind: 'year', value: '2025' }).map((t) => t.id)).toEqual(['a'])
  })

  it('月で絞る', () => {
    expect(filterByRange(rows, { kind: 'month', value: '2026-08' }).map((t) => t.id)).toEqual(['c'])
    expect(filterByRange(rows, { kind: 'month', value: '2026-01' })).toEqual([])
  })

  it('期間の名前', () => {
    expect(describeRange({ kind: 'all' })).toBe('全期間')
    expect(describeRange({ kind: 'year', value: '2026' })).toBe('2026年')
    expect(describeRange({ kind: 'month', value: '2026-08' })).toBe('2026年8月')
  })

  it('同じ期間かどうか', () => {
    const a: ExportRange = { kind: 'month', value: '2026-08' }
    expect(isSameRange(a, { kind: 'month', value: '2026-08' })).toBe(true)
    expect(isSameRange(a, { kind: 'month', value: '2026-07' })).toBe(false)
    expect(isSameRange(a, { kind: 'year', value: '2026' })).toBe(false)
    expect(isSameRange({ kind: 'all' }, { kind: 'all' })).toBe(true)
  })

  it('選べる年は新しい順。今年は記録が無くても必ず出す', () => {
    expect(exportYears(['2025-12-31', '2024-01-01'], '2026-08-05')).toEqual([
      '2026',
      '2025',
      '2024',
    ])
    expect(exportYears([], '2026-08-05')).toEqual(['2026'])
  })

  it('選べる月は記録のある月だけ、新しい順', () => {
    expect(exportMonths(['2026-08-03', '2026-08-31', '2025-12-01'])).toEqual([
      '2026-08',
      '2025-12',
    ])
    expect(exportMonths([])).toEqual([])
  })
})

describe('csvFileName', () => {
  it('期間と書き出した日が入る(前のファイルを上書きしない)', () => {
    expect(csvFileName({ kind: 'all' }, '2026-08-05')).toBe('kakeibo-all-20260805.csv')
    expect(csvFileName({ kind: 'year', value: '2026' }, '2026-08-05')).toBe(
      'kakeibo-2026-20260805.csv'
    )
    expect(csvFileName({ kind: 'month', value: '2026-08' }, '2026-08-05')).toBe(
      'kakeibo-2026-08-20260805.csv'
    )
  })

  it('日本語を含まない(端末やクラウドをまたいでも化けない)', () => {
    expect(csvFileName({ kind: 'month', value: '2026-08' }, '2026-08-05')).toMatch(
      /^[a-z0-9-]+\.csv$/
    )
  })
})
