import { describe, expect, it } from 'vitest'
import type { Transaction } from './types'
import { monthRange, totalOwn } from './report'
import {
  EVENT_GAP_DAYS,
  NO_TAG_LABEL,
  coTagBreakdown,
  everydaySplit,
  hasAnyTaggedTx,
  innerTagSet,
  selectionCategoryBreakdown,
  selectionEvents,
  selectionLabel,
  selectionSpan,
  selectionTxs,
  specialTagOptions,
  tagBreakdown,
  tagCategoryBreakdown,
  tagEvents,
  tagOutline,
  tagSpan,
  tagsInRange,
  withTag,
  withoutTags,
} from './reportTags'

// テスト用の取引。必要な項目だけ上書きする(report.test.ts と同じ作り)
let seq = 0
function tx(p: Partial<Transaction> = {}): Transaction {
  seq += 1
  return {
    id: p.id ?? `id${String(seq).padStart(3, '0')}`,
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

const AUG = monthRange('2026-08')
const label = (id: string | null) => id ?? '未分類'

describe('tagBreakdown', () => {
  it('タグが1件も無ければ、すべて「タグなし」1項目になる', () => {
    const txs = [tx({ amount: 300 }), tx({ amount: 700 })]
    const b = tagBreakdown(txs, AUG)
    expect(b.items).toHaveLength(1)
    expect(b.items[0].label).toBe(NO_TAG_LABEL)
    expect(b.items[0].tag).toBeNull()
    expect(b.items[0].total).toBe(1000)
    expect(b.items[0].count).toBe(2)
    expect(b.overlap).toBe(0)
    expect(b.multiTagCount).toBe(0)
  })

  it('記録そのものが無ければ空になる', () => {
    expect(tagBreakdown([], AUG).items).toEqual([])
    expect(tagBreakdown([], AUG).total).toBe(0)
  })

  it('タグなしも金額順の中に並ぶ(末尾送りにしない)', () => {
    const txs = [
      tx({ amount: 5000 }), // タグなし
      tx({ amount: 1000, tags: ['旅行'] }),
    ]
    const b = tagBreakdown(txs, AUG)
    expect(b.items.map((i) => i.label)).toEqual([NO_TAG_LABEL, '旅行'])
  })

  it('1件に複数タグが付くと、そのすべてに満額で数える', () => {
    const txs = [tx({ amount: 8000, tags: ['旅行', 'デート'] })]
    const b = tagBreakdown(txs, AUG)
    expect(b.items.map((i) => [i.label, i.total, i.count])).toEqual([
      ['デート', 8000, 1],
      ['旅行', 8000, 1],
    ])
    // 総額は1件ぶん。足すと超える分が overlap
    expect(b.total).toBe(8000)
    expect(b.itemsTotal).toBe(16000)
    expect(b.overlap).toBe(8000)
    expect(b.multiTagCount).toBe(1)
  })

  it('同じタグが2つ入っていても1件ぶんしか数えない', () => {
    const b = tagBreakdown([tx({ amount: 3000, tags: ['旅行', '旅行'] })], AUG)
    expect(b.items).toHaveLength(1)
    expect(b.items[0].total).toBe(3000)
    expect(b.items[0].count).toBe(1)
    expect(b.overlap).toBe(0)
  })

  it('期間外の記録は数えない', () => {
    const txs = [
      tx({ date: '2026-07-31', amount: 9000, tags: ['旅行'] }),
      tx({ date: '2026-08-01', amount: 1000, tags: ['旅行'] }),
      tx({ date: '2026-09-01', amount: 9000, tags: ['旅行'] }),
    ]
    const b = tagBreakdown(txs, AUG)
    expect(b.items[0].total).toBe(1000)
    expect(b.total).toBe(1000)
  })

  it('彼女の負担分は除いた実質支出で数える', () => {
    const b = tagBreakdown([tx({ amount: 10000, partner_amount: 4000, tags: ['旅行'] })], AUG)
    expect(b.items[0].total).toBe(6000)
    expect(b.total).toBe(6000)
  })

  it('支出でない記録(預かり・返金)は数えない', () => {
    const txs = [
      tx({ type: 'partner_deposit', amount: 30000, tags: ['旅行'] }),
      tx({ type: 'partner_refund', amount: 5000, tags: ['旅行'] }),
      tx({ amount: 1200, tags: ['旅行'] }),
    ]
    const b = tagBreakdown(txs, AUG)
    expect(b.items).toHaveLength(1)
    expect(b.items[0].total).toBe(1200)
    expect(b.items[0].count).toBe(1)
  })

  it('同額なら 件数 → タグ名 の順で必ず決まる(並びがブレない)', () => {
    const txs = [
      tx({ amount: 1000, tags: ['い'] }),
      tx({ amount: 500, tags: ['あ'] }),
      tx({ amount: 500, tags: ['あ'] }),
      tx({ amount: 1000, tags: ['う'] }),
    ]
    const first = tagBreakdown(txs, AUG).items.map((i) => i.label)
    // 金額はすべて1000で同じ → 件数が多い「あ」が先、残りはタグ名順
    expect(first).toEqual(['あ', 'い', 'う'])
    // 入力の順番を変えても同じ並びになる
    expect(tagBreakdown([...txs].reverse(), AUG).items.map((i) => i.label)).toEqual(first)
  })

  it('総額は既存の totalOwn と一致する', () => {
    const txs = [
      tx({ amount: 1000, tags: ['旅行'] }),
      tx({ amount: 2000, tags: ['旅行', 'デート'] }),
      tx({ amount: 3000 }),
    ]
    expect(tagBreakdown(txs, AUG).total).toBe(totalOwn(txs, AUG))
  })
})

describe('withTag / withoutTags / tagCategoryBreakdown', () => {
  const txs = [
    tx({ amount: 20000, category: 'hotel', tags: ['旅行'] }),
    tx({ amount: 5000, category: 'food', tags: ['旅行'] }),
    tx({ amount: 3000, category: 'food', tags: ['旅行', 'デート'] }),
    tx({ amount: 900, category: 'food' }),
  ]

  it('タグの付いた記録だけを取り出す', () => {
    expect(withTag(txs, '旅行')).toHaveLength(3)
    expect(withTag(txs, 'デート')).toHaveLength(1)
    expect(withTag(txs, '出張')).toHaveLength(0)
  })

  it('タグの付いていない記録だけを取り出す', () => {
    expect(withoutTags(txs)).toHaveLength(1)
  })

  it('タグの中のカテゴリ内訳が出る', () => {
    const rows = tagCategoryBreakdown(txs, AUG, '旅行', label)
    expect(rows.map((r) => [r.label, r.total])).toEqual([
      ['hotel', 20000],
      ['food', 8000],
    ])
  })

  it('「タグなし」のカテゴリ内訳も出せる', () => {
    const rows = tagCategoryBreakdown(txs, AUG, null, label)
    expect(rows.map((r) => [r.label, r.total])).toEqual([['food', 900]])
  })
})

describe('everydaySplit', () => {
  const txs = [
    tx({ date: '2026-08-02', amount: 1000 }),
    tx({ date: '2026-08-03', amount: 2000, tags: ['コンビニ'] }),
    tx({ date: '2026-08-10', amount: 30000, tags: ['旅行'] }),
    tx({ date: '2026-08-11', amount: 5000, tags: ['旅行', '食べ歩き'] }),
    tx({ date: '2026-08-20', amount: 4000, tags: ['デート'] }),
  ]

  it('特別タグを選んでいなければ、全部が日常になる', () => {
    const s = everydaySplit(txs, AUG, [])
    expect(s.special).toBe(0)
    expect(s.specialCount).toBe(0)
    expect(s.everyday).toBe(42000)
    expect(s.everydayCount).toBe(5)
    expect(s.byTag).toEqual([])
  })

  it('選んだタグの付いた支出だけが特別に回る', () => {
    const s = everydaySplit(txs, AUG, ['旅行', 'デート'])
    expect(s.special).toBe(39000)
    expect(s.specialCount).toBe(3)
    expect(s.everyday).toBe(3000)
    expect(s.everydayCount).toBe(2)
  })

  it('日常と特別を足すと必ず総額に一致する(二重に数えない分け方)', () => {
    for (const sel of [[], ['旅行'], ['旅行', 'デート'], ['食べ歩き'], ['無いタグ']]) {
      const s = everydaySplit(txs, AUG, sel)
      expect(s.everyday + s.special).toBe(totalOwn(txs, AUG))
      expect(s.total).toBe(totalOwn(txs, AUG))
    }
  })

  it('1件に特別タグが2つ付いていても、支出は片側に1回だけ入る', () => {
    const s = everydaySplit(txs, AUG, ['旅行', '食べ歩き'])
    expect(s.special).toBe(35000)
    expect(s.specialCount).toBe(2)
    // 内訳のほうは両方に数える(だから内訳の合計は special を超えうる)
    expect(s.byTag.map((i) => [i.label, i.total])).toEqual([
      ['旅行', 35000],
      ['食べ歩き', 5000],
    ])
    expect(s.byTag.reduce((n, i) => n + i.total, 0)).toBeGreaterThan(s.special)
  })

  it('存在しないタグを選んでも壊れない(全部が日常のまま)', () => {
    const s = everydaySplit(txs, AUG, ['そんなタグはない'])
    expect(s.special).toBe(0)
    expect(s.everyday).toBe(42000)
  })

  it('期間外の特別支出は数えない', () => {
    const s = everydaySplit(
      [...txs, tx({ date: '2026-09-01', amount: 99999, tags: ['旅行'] })],
      AUG,
      ['旅行']
    )
    expect(s.special).toBe(35000)
  })

  it('うるう年の2月は29日で割る(1日あたりが1日ぶんずれない)', () => {
    const feb = monthRange('2024-02')
    const leap = [tx({ date: '2024-02-29', amount: 2900 })]
    const s = everydaySplit(leap, feb, ['旅行'])
    expect(s.days).toBe(29)
    expect(s.everyday).toBe(2900) // 2/29 の記録が落ちない
    expect(s.everydayPerDay).toBe(100)

    const notLeap = everydaySplit([], monthRange('2023-02'), [])
    expect(notLeap.days).toBe(28)
  })

  it('記録が無くても1日あたりが NaN にならない', () => {
    const s = everydaySplit([], AUG, ['旅行'])
    expect(s.everydayPerDay).toBe(0)
    expect(s.total).toBe(0)
  })
})

describe('tagEvents / tagSpan', () => {
  it('月をまたいでも、続いた記録は1回の出来事になる', () => {
    const txs = [
      tx({ date: '2026-07-30', amount: 12000, category: 'hotel', tags: ['旅行'] }),
      tx({ date: '2026-07-31', amount: 3000, category: 'food', tags: ['旅行'] }),
      tx({ date: '2026-08-01', amount: 2000, category: 'food', tags: ['旅行'] }),
    ]
    const events = tagEvents(txs, '旅行', label)
    expect(events).toHaveLength(1)
    expect(events[0].range).toEqual({ start: '2026-07-30', end: '2026-08-01' })
    expect(events[0].days).toBe(3)
    expect(events[0].total).toBe(17000)
    expect(events[0].count).toBe(3)
    expect(events[0].categories.map((c) => [c.label, c.total])).toEqual([
      ['hotel', 12000],
      ['food', 5000],
    ])
  })

  it('間が空けば別の回に分かれ、新しい回が先に来る', () => {
    const txs = [
      tx({ date: '2026-05-03', amount: 40000, tags: ['旅行'] }),
      tx({ date: '2026-05-04', amount: 10000, tags: ['旅行'] }),
      tx({ date: '2026-08-10', amount: 30000, tags: ['旅行'] }),
      tx({ date: '2026-08-13', amount: 8000, tags: ['旅行'] }),
    ]
    const events = tagEvents(txs, '旅行', label)
    expect(events.map((e) => [e.range.start, e.range.end, e.total])).toEqual([
      ['2026-08-10', '2026-08-13', 38000],
      ['2026-05-03', '2026-05-04', 50000],
    ])
  })

  it('ちょうど区切りの日数(7日空き)までは同じ回、それを超えると分かれる', () => {
    const same = tagEvents(
      [
        tx({ date: '2026-08-01', amount: 100, tags: ['出張'] }),
        tx({ date: `2026-08-0${1 + EVENT_GAP_DAYS}`, amount: 100, tags: ['出張'] }),
      ],
      '出張',
      label
    )
    expect(same).toHaveLength(1)

    const apart = tagEvents(
      [
        tx({ date: '2026-08-01', amount: 100, tags: ['出張'] }),
        tx({ date: '2026-08-09', amount: 100, tags: ['出張'] }), // 8日空き
      ],
      '出張',
      label
    )
    expect(apart).toHaveLength(2)
  })

  it('うるう年の2月末をまたいでも続きとして扱う', () => {
    const events = tagEvents(
      [
        tx({ date: '2024-02-28', amount: 1000, tags: ['旅行'] }),
        tx({ date: '2024-03-01', amount: 2000, tags: ['旅行'] }), // 2/29 を挟んで2日差
      ],
      '旅行',
      label
    )
    expect(events).toHaveLength(1)
    expect(events[0].days).toBe(3)
    expect(events[0].total).toBe(3000)
  })

  it('同じ日に何件あっても1回にまとまる', () => {
    const events = tagEvents(
      [
        tx({ date: '2026-08-10', amount: 1000, tags: ['デート'] }),
        tx({ date: '2026-08-10', amount: 2000, tags: ['デート'] }),
      ],
      'デート',
      label
    )
    expect(events).toHaveLength(1)
    expect(events[0].days).toBe(1)
    expect(events[0].total).toBe(3000)
  })

  it('金額0(彼女が全額出した)の記録も、回の区切りの判断には使う', () => {
    const events = tagEvents(
      [
        tx({ date: '2026-08-01', amount: 5000, tags: ['旅行'] }),
        tx({ date: '2026-08-08', amount: 4000, partner_amount: 4000, tags: ['旅行'] }),
        tx({ date: '2026-08-15', amount: 6000, tags: ['旅行'] }),
      ],
      '旅行',
      label
    )
    // 8/8 が無ければ 8/1 と 8/15 は別の回になるが、記録がある以上ひと続き
    expect(events).toHaveLength(1)
    expect(events[0].total).toBe(11000)
    expect(events[0].count).toBe(2) // 自分の負担が0の1件は件数に入らない
  })

  it('そのタグの記録が無ければ空', () => {
    expect(tagEvents([tx({ tags: ['旅行'] })], '出張', label)).toEqual([])
    expect(tagEvents([], '旅行', label)).toEqual([])
    expect(tagSpan([], '旅行', label)).toBeNull()
  })

  it('tagSpan は最初から最後までをまとめた1つになる', () => {
    const txs = [
      tx({ date: '2026-05-03', amount: 40000, tags: ['デート'] }),
      tx({ date: '2026-08-10', amount: 30000, tags: ['デート'] }),
    ]
    const span = tagSpan(txs, 'デート', label)
    expect(span?.range).toEqual({ start: '2026-05-03', end: '2026-08-10' })
    expect(span?.total).toBe(70000)
    expect(span?.count).toBe(2)
  })
})

describe('specialTagOptions', () => {
  it('よく使うタグから順に並ぶ', () => {
    const txs = [
      tx({ tags: ['デート'] }),
      tx({ tags: ['デート'] }),
      tx({ tags: ['旅行'] }),
      tx({ tags: [] }),
    ]
    expect(specialTagOptions(txs, [])).toEqual(['デート', '旅行'])
  })

  it('まだ一度も使っていない既定のタグも候補に出る', () => {
    expect(specialTagOptions([], ['旅行', 'デート', '出張'])).toEqual(['旅行', 'デート', '出張'])
  })

  it('記録が1件も無くても候補が消えない(初期状態で選び直せる)', () => {
    expect(specialTagOptions([], ['旅行'])).toEqual(['旅行'])
  })

  it('使われているタグと候補が重なっても二重に出ない', () => {
    const txs = [tx({ tags: ['旅行'] })]
    expect(specialTagOptions(txs, ['旅行', '出張'])).toEqual(['旅行', '出張'])
  })
})

describe('tagsInRange / hasAnyTaggedTx', () => {
  const txs = [
    tx({ date: '2026-08-02', amount: 1000, tags: ['デート'] }),
    tx({ date: '2026-08-03', amount: 9000, tags: ['旅行'] }),
    tx({ date: '2026-09-03', amount: 9999, tags: ['出張'] }),
    tx({ date: '2026-08-04', amount: 500 }),
  ]

  it('期間内に出てくるタグだけを多い順に返す', () => {
    expect(tagsInRange(txs, AUG)).toEqual(['旅行', 'デート'])
  })

  it('タグの付いた記録があるかを判定できる', () => {
    expect(hasAnyTaggedTx(txs, AUG)).toBe(true)
    expect(hasAnyTaggedTx([tx({ date: '2026-08-04', amount: 500 })], AUG)).toBe(false)
    expect(hasAnyTaggedTx([], AUG)).toBe(false)
  })
})

// ============================================================
// 共起タグのドリルダウン(#旅行 の中の #2026和歌山)
//
// 階層タグ(親子関係)は作らず、フラットに2つ付いたタグの**共起**だけで
// 内側を出す。ここで確かめるのは:
//   ・行き先タグがトップの一覧に出ないこと(二重計上を目に見えて増やさない)
//   ・親を選ぶと内側が出て、押すとその旅行だけに絞れること
//   ・絞ったあとも カテゴリ内訳 と 回ごと が同じ切り方で動くこと
// ============================================================

describe('innerTagSet / tagOutline', () => {
  // 特別タグ(レポートの設定。既定は 旅行・デート・出張)を親とみなす
  const SPECIAL = ['旅行', 'デート', '出張']

  it('いつも親と一緒に付くタグは、トップの一覧に出さない', () => {
    const txs = [
      tx({ date: '2026-08-01', amount: 30000, tags: ['旅行', '2026和歌山'] }),
      tx({ date: '2026-08-02', amount: 20000, tags: ['旅行', '2026和歌山'] }),
      tx({ date: '2026-08-20', amount: 10000, tags: ['旅行', '2025北海道'] }),
    ]
    const outline = tagOutline(txs, AUG, SPECIAL)
    expect(outline.top.map((i) => i.tag)).toEqual(['旅行'])
    expect(outline.inner.map((i) => i.tag)).toEqual(['2026和歌山', '2025北海道'])
    // 行き先を外したので、トップの合計は総額とぴったり一致する
    expect(outline.topTotal).toBe(60000)
    expect(outline.total).toBe(60000)
    expect(outline.overlap).toBe(0)
    expect(outline.multiTopCount).toBe(0)
  })

  it('1回目の旅行(親と子が同じ件数)でも、行き先はトップに出さない', () => {
    // 「旅行」を35件すべてに、あとから「2026和歌山」をまとめて付けた状態。
    // 件数が並ぶので、件数だけでは親子が決まらない ——
    // 特別タグに選ばれている「旅行」を親とみなす
    const txs = Array.from({ length: 35 }, (_, i) =>
      tx({ date: '2026-08-06', amount: 1000 + i, tags: ['旅行', '2026和歌山'] })
    )
    const outline = tagOutline(txs, AUG, SPECIAL)
    expect(outline.top.map((i) => i.tag)).toEqual(['旅行'])
    expect(outline.inner.map((i) => i.tag)).toEqual(['2026和歌山'])
    expect(outline.overlap).toBe(0)
  })

  it('共起タグが1件も無ければ、これまでどおり全部トップに出る', () => {
    const txs = [tx({ amount: 1000, tags: ['旅行'] }), tx({ amount: 2000, tags: ['デート'] })]
    const outline = tagOutline(txs, AUG, SPECIAL)
    expect(outline.top.map((i) => i.tag)).toEqual(['デート', '旅行'])
    expect(outline.inner).toEqual([])
  })

  it('1度でも単独で出てくるタグは隠さない(一覧から金額が消えないように)', () => {
    const txs = [
      tx({ amount: 30000, tags: ['旅行', '2026和歌山'] }),
      tx({ amount: 20000, tags: ['旅行', '2026和歌山'] }),
      // 旅行タグを付け忘れた1件。ここで単独になるので、行き先タグもトップに戻る
      tx({ amount: 5000, tags: ['2026和歌山'] }),
    ]
    expect(tagOutline(txs, AUG, SPECIAL).top.map((i) => i.tag)).toEqual(['2026和歌山', '旅行'])
    expect(tagOutline(txs, AUG, SPECIAL).inner).toEqual([])
  })

  it('特別タグは、ほかの特別タグと必ず一緒に付いていても隠さない', () => {
    const txs = [tx({ amount: 1000, tags: ['旅行', 'デート'] })]
    const outline = tagOutline(txs, AUG, SPECIAL)
    expect(outline.top.map((i) => i.tag)).toEqual(['デート', '旅行'])
    expect(outline.inner).toEqual([])
    // 隠さない以上、二重計上はこれまでどおり注記で断る
    expect(outline.overlap).toBe(1000)
    expect(outline.multiTopCount).toBe(1)
  })

  it('特別タグでなくても、件数が多い方が親になる', () => {
    const txs = [
      tx({ amount: 1000, tags: ['ごほうび', 'ケーキ'] }),
      tx({ amount: 1000, tags: ['ごほうび'] }),
    ]
    const outline = tagOutline(txs, AUG, SPECIAL)
    expect(outline.top.map((i) => i.tag)).toEqual(['ごほうび'])
    expect(outline.inner.map((i) => i.tag)).toEqual(['ケーキ'])
  })

  it('件数が同じ普通のタグどうしはどちらも隠さない(僅差で一覧が出入りしない)', () => {
    const txs = [tx({ amount: 1000, tags: ['ごほうび', 'ケーキ'] })]
    expect(tagOutline(txs, AUG, SPECIAL).inner).toEqual([])
  })

  it('1件に3つ以上のタグが付いていても、親の内側にまとめて入る', () => {
    const txs = [
      tx({ amount: 10000, tags: ['旅行', '2026和歌山', '記念日'] }),
      tx({ amount: 10000, tags: ['旅行', '2026和歌山'] }),
      tx({ amount: 10000, tags: ['旅行'] }),
      tx({ amount: 10000, tags: ['旅行'] }),
    ]
    const outline = tagOutline(txs, AUG, SPECIAL)
    expect(outline.top.map((i) => i.tag)).toEqual(['旅行'])
    expect(outline.inner.map((i) => i.tag)).toEqual(['2026和歌山', '記念日'])
  })

  it('「タグなし」はいつでもトップに残る', () => {
    const txs = [
      tx({ amount: 10000, tags: ['旅行', '2026和歌山'] }),
      tx({ amount: 10000, tags: ['旅行', '2026和歌山'] }),
      tx({ amount: 3000 }),
    ]
    expect(tagOutline(txs, AUG, SPECIAL).top.map((i) => i.tag)).toEqual(['旅行', null])
  })

  it('親子の判定は全期間で決める(月を送るたびに一覧から消えない)', () => {
    const txs = [
      // 7月の旅行。8月を見ているときも、行き先タグは内側のまま
      tx({ date: '2026-07-20', amount: 90000, tags: ['旅行', '2026和歌山'] }),
      tx({ date: '2026-08-04', amount: 1000, tags: ['旅行', '2026和歌山'] }),
      tx({ date: '2026-08-05', amount: 500, tags: ['デート'] }),
    ]
    const outline = tagOutline(txs, AUG, SPECIAL)
    expect(outline.top.map((i) => i.tag)).toEqual(['旅行', 'デート'])
    expect(outline.inner.map((i) => i.tag)).toEqual(['2026和歌山'])
    // 期間内の金額だけを数える
    expect(outline.total).toBe(1500)
  })

  it('記録が1件も無くても壊れない', () => {
    expect(tagOutline([], AUG, SPECIAL).top).toEqual([])
    expect(tagOutline([], AUG, SPECIAL).inner).toEqual([])
    expect(innerTagSet([], SPECIAL).size).toBe(0)
  })

  it('特別タグを1つも選んでいなくても、件数だけで親子が決まる', () => {
    const txs = [
      tx({ amount: 1000, tags: ['旅行', '2026和歌山'] }),
      tx({ amount: 1000, tags: ['旅行'] }),
    ]
    expect([...innerTagSet(txs, [])]).toEqual(['2026和歌山'])
  })
})

describe('coTagBreakdown', () => {
  const txs = [
    tx({ date: '2026-08-01', amount: 30000, tags: ['旅行', '2026和歌山'] }),
    tx({ date: '2026-08-02', amount: 20000, tags: ['旅行', '2026和歌山'] }),
    tx({ date: '2026-08-20', amount: 10000, tags: ['旅行', '2025北海道'] }),
    tx({ date: '2026-08-25', amount: 5000, tags: ['旅行'] }),
    tx({ date: '2026-08-26', amount: 999, tags: ['デート'] }),
  ]

  it('一緒に付いているタグを多い順に出す(親そのものは出さない)', () => {
    const co = coTagBreakdown(txs, AUG, '旅行')
    expect(co.items.map((i) => i.tag)).toEqual(['2026和歌山', '2025北海道'])
    expect(co.items[0].total).toBe(50000)
    expect(co.items[0].count).toBe(2)
    // 親の合計は tagBreakdown の「旅行」の行と同じ数字
    expect(co.total).toBe(65000)
  })

  it('行き先タグを付けていない分は、件数と金額で別に持つ', () => {
    const co = coTagBreakdown(txs, AUG, '旅行')
    expect(co.soloCount).toBe(1)
    expect(co.soloTotal).toBe(5000)
  })

  it('共起タグが0件のときは空になる(内側を出さない判断に使う)', () => {
    const co = coTagBreakdown(txs, AUG, 'デート')
    expect(co.items).toEqual([])
    expect(co.soloCount).toBe(1)
    expect(co.soloTotal).toBe(999)
  })

  it('同じ記録に同じタグが重複していても二重に数えない', () => {
    const dup = [tx({ amount: 1000, tags: ['旅行', '2026和歌山', '2026和歌山'] })]
    const co = coTagBreakdown(dup, AUG, '旅行')
    expect(co.items).toHaveLength(1)
    expect(co.items[0].total).toBe(1000)
    expect(co.items[0].count).toBe(1)
  })

  it('付いていないタグを渡しても空で返る', () => {
    expect(coTagBreakdown(txs, AUG, '出張').items).toEqual([])
    expect(coTagBreakdown(txs, AUG, '出張').total).toBe(0)
  })
})

describe('選択(親 → 内側の1段)', () => {
  const txs = [
    // 2026和歌山(1回目)
    tx({ date: '2026-08-01', amount: 30000, category: 'stay', tags: ['旅行', '2026和歌山'] }),
    tx({ date: '2026-08-02', amount: 20000, category: 'food', tags: ['旅行', '2026和歌山'] }),
    // 同じ行き先にもう一度行った(7日以上あいだが空く)
    tx({ date: '2026-08-20', amount: 8000, category: 'food', tags: ['旅行', '2026和歌山'] }),
    // 別の旅行
    tx({ date: '2026-08-10', amount: 10000, category: 'food', tags: ['旅行', '2025北海道'] }),
    tx({ date: '2026-08-11', amount: 700, category: 'food' }),
  ]

  it('選択の呼び名は「親 › 内側」', () => {
    expect(selectionLabel({ tag: '旅行', co: '2026和歌山' })).toBe('#旅行 › #2026和歌山')
    expect(selectionLabel({ tag: '旅行', co: null })).toBe('#旅行')
    expect(selectionLabel({ tag: null, co: null })).toBe(NO_TAG_LABEL)
  })

  it('2つ選ぶと AND で絞る', () => {
    expect(selectionTxs(txs, { tag: '旅行', co: '2026和歌山' })).toHaveLength(3)
    expect(selectionTxs(txs, { tag: '旅行', co: null })).toHaveLength(4)
    expect(selectionTxs(txs, { tag: null, co: null })).toHaveLength(1)
  })

  it('絞ったあともカテゴリ内訳が正しく動く', () => {
    const cats = selectionCategoryBreakdown(txs, AUG, { tag: '旅行', co: '2026和歌山' }, label)
    expect(cats.map((c) => [c.label, c.total])).toEqual([
      ['stay', 30000],
      ['food', 28000],
    ])
  })

  it('絞ったあとも「回ごと」が同じ切り方で動く(同じ行き先に複数回)', () => {
    const events = selectionEvents(txs, { tag: '旅行', co: '2026和歌山' }, label)
    expect(events).toHaveLength(2)
    // 直近の回が先頭
    expect(events[0].range).toEqual({ start: '2026-08-20', end: '2026-08-20' })
    expect(events[0].total).toBe(8000)
    expect(events[1].range).toEqual({ start: '2026-08-01', end: '2026-08-02' })
    expect(events[1].total).toBe(50000)
    // 別の旅行(8/10)は混ざらない
    expect(events.some((e) => e.total === 10000)).toBe(false)
  })

  it('親だけを選んだときの回ごとは、これまでの tagEvents とまったく同じ', () => {
    expect(selectionEvents(txs, { tag: '旅行', co: null }, label)).toEqual(
      tagEvents(txs, '旅行', label)
    )
  })

  it('回ごとは選んでいる期間に縛られない(旅行は月をまたぐ)', () => {
    const across = [
      tx({ date: '2026-07-31', amount: 1000, tags: ['旅行', '2026和歌山'] }),
      tx({ date: '2026-08-01', amount: 2000, tags: ['旅行', '2026和歌山'] }),
    ]
    const events = selectionEvents(across, { tag: '旅行', co: '2026和歌山' }, label)
    expect(events).toHaveLength(1)
    expect(events[0].range).toEqual({ start: '2026-07-31', end: '2026-08-01' })
    expect(events[0].total).toBe(3000)
  })

  it('全期間をまとめた1つも出せる', () => {
    const span = selectionSpan(txs, { tag: '旅行', co: '2026和歌山' }, label)
    expect(span?.range).toEqual({ start: '2026-08-01', end: '2026-08-20' })
    expect(span?.total).toBe(58000)
  })

  it('「タグなし」からは掘らない(回ごとも出さない)', () => {
    expect(selectionEvents(txs, { tag: null, co: null }, label)).toEqual([])
    expect(selectionSpan(txs, { tag: null, co: null }, label)).toBeNull()
  })
})
