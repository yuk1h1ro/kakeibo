import { describe, expect, it } from 'vitest'
import {
  buildStoreIndex,
  collectCategoryStores,
  daysBetween,
  guessStoreCategory,
  isSameStore,
  recencyWeight,
  storeOptionsFor,
} from './storePicker'
import { normalizeStoreName, type StoreCategory } from './storeCategories'
import type { Transaction } from './types'

// ============================================================
// カテゴリで絞ったお店の候補。
//
// 入力の主役が「そのカテゴリの店を1タップで選ぶ」ことなので、
// ここで守るのは「漏れないこと」と「選びやすい順に並ぶこと」の2つ。
// ============================================================

const TODAY = '2026-08-05'

const tx = (over: Partial<Transaction> = {}): Transaction => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  date: TODAY,
  type: 'expense',
  amount: 500,
  category: 'food',
  memo: '',
  store: '',
  partner_amount: 0,
  created_at: '2026-08-05T00:00:00Z',
  ...over,
})

const learned = (name: string, category: string, updatedAt: string): StoreCategory => ({
  storeKey: normalizeStoreName(name),
  storeName: name,
  category,
  updatedAt,
})

const names = (rows: { storeName: string }[]): string[] => rows.map((r) => r.storeName)

describe('daysBetween / recencyWeight', () => {
  it('日付の差を日数で返す', () => {
    expect(daysBetween('2026-08-01', '2026-08-05')).toBe(4)
    expect(daysBetween('2026-08-05', '2026-08-05')).toBe(0)
  })

  it('月をまたいでも数えられる', () => {
    expect(daysBetween('2026-07-31', '2026-08-01')).toBe(1)
  })

  it('日付として読めない文字列は null(重みの計算から外す)', () => {
    expect(daysBetween('', TODAY)).toBeNull()
    expect(daysBetween('きのう', TODAY)).toBeNull()
  })

  it('新しいほど重い', () => {
    expect(recencyWeight(0)).toBeGreaterThan(recencyWeight(20))
    expect(recencyWeight(20)).toBeGreaterThan(recencyWeight(60))
    expect(recencyWeight(60)).toBeGreaterThan(recencyWeight(400))
  })

  it('未来の日付(先に入力した記録)も今日と同じ扱いにする', () => {
    expect(recencyWeight(-3)).toBe(recencyWeight(0))
  })
})

describe('collectCategoryStores', () => {
  it('そのカテゴリで使った店だけを出す', () => {
    const rows = [
      tx({ category: 'food', store: 'スーパー' }),
      tx({ category: 'daily', store: 'ドラッグストア' }),
    ]
    expect(names(collectCategoryStores(rows, [], 'food', TODAY))).toEqual(['スーパー'])
  })

  it('1つの店が複数カテゴリで使われていても、どちらの候補にも出る', () => {
    // store_categories は1店1カテゴリなので、ここが取引履歴を使う理由そのもの
    const rows = [
      tx({ category: 'food', store: 'セブンイレブン' }),
      tx({ category: 'daily', store: 'セブンイレブン' }),
    ]
    expect(names(collectCategoryStores(rows, [], 'food', TODAY))).toEqual(['セブンイレブン'])
    expect(names(collectCategoryStores(rows, [], 'daily', TODAY))).toEqual(['セブンイレブン'])
  })

  it('表記ゆれ(全角・空白)は同じ店にまとめ、最後に打った表記で出す', () => {
    const rows = [
      tx({ date: '2026-08-05', store: 'セブンイレブン' }),
      tx({ date: '2026-08-01', store: 'セブン イレブン' }),
    ]
    const out = collectCategoryStores(rows, [], 'food', TODAY)
    expect(out).toHaveLength(1)
    expect(out[0].storeName).toBe('セブンイレブン')
    expect(out[0].uses).toBe(2)
  })

  it('よく使う店が上に来る', () => {
    const rows = [
      tx({ store: 'よく行く店' }),
      tx({ store: 'よく行く店' }),
      tx({ store: 'よく行く店' }),
      tx({ store: 'たまの店' }),
    ]
    expect(names(collectCategoryStores(rows, [], 'food', TODAY))).toEqual(['よく行く店', 'たまの店'])
  })

  it('回数が同じなら最近使った店が上に来る', () => {
    const rows = [
      tx({ store: '古い店', date: '2026-05-01' }),
      tx({ store: '最近の店', date: '2026-08-04' }),
    ]
    expect(names(collectCategoryStores(rows, [], 'food', TODAY))).toEqual(['最近の店', '古い店'])
  })

  it('昔よく行った店より、最近通っている店を優先する', () => {
    // 半年前に5回 (0.5 × 5 = 2.5) より、今週2回 (4 × 2 = 8) を上に出す
    const rows = [
      ...Array.from({ length: 5 }, () => tx({ store: '昔の常連', date: '2026-02-01' })),
      tx({ store: '今の常連', date: '2026-08-03' }),
      tx({ store: '今の常連', date: '2026-08-04' }),
    ]
    expect(names(collectCategoryStores(rows, [], 'food', TODAY))[0]).toBe('今の常連')
  })

  it('店名が空の記録は候補にしない', () => {
    const rows = [tx({ store: '' }), tx({ store: '   ' }), tx({ store: 'スーパー' })]
    expect(names(collectCategoryStores(rows, [], 'food', TODAY))).toEqual(['スーパー'])
  })

  it('支出以外(預かり・返金)は数えない', () => {
    const rows = [
      tx({ type: 'partner_deposit', category: 'food', store: '銀行' }),
      tx({ store: 'スーパー' }),
    ]
    expect(names(collectCategoryStores(rows, [], 'food', TODAY))).toEqual(['スーパー'])
  })

  it('カテゴリが未選択なら候補を出さない(まずカテゴリを選ぶ流れのため)', () => {
    expect(collectCategoryStores([tx({ store: 'スーパー' })], [], null, TODAY)).toEqual([])
  })

  it('履歴に無い店は store_categories の学習内容から補う', () => {
    const out = collectCategoryStores([], [learned('八百屋', 'food', '2026-08-01T00:00:00Z')], 'food', TODAY)
    expect(names(out)).toEqual(['八百屋'])
    expect(out[0].uses).toBe(0)
  })

  it('学習内容のカテゴリ違いは混ぜない', () => {
    const rows = [learned('薬局', 'daily', '2026-08-01T00:00:00Z')]
    expect(collectCategoryStores([], rows, 'food', TODAY)).toEqual([])
  })

  it('履歴と学習内容で重なる店は1つにまとめる(履歴の実績を優先)', () => {
    const out = collectCategoryStores(
      [tx({ store: 'スーパー' })],
      [learned('スーパー', 'food', '2026-08-01T00:00:00Z')],
      'food',
      TODAY
    )
    expect(out).toHaveLength(1)
    expect(out[0].uses).toBe(1)
  })

  it('上限を超えたら切り詰める(並べすぎると探すのが遅くなる)', () => {
    const rows = Array.from({ length: 20 }, (_, i) => tx({ store: `店${i}` }))
    expect(collectCategoryStores(rows, [], 'food', TODAY, 12)).toHaveLength(12)
  })

  it('同じ点数のときの並びが実行ごとに変わらない', () => {
    const rows = [tx({ store: 'B店' }), tx({ store: 'A店' })]
    const first = names(collectCategoryStores(rows, [], 'food', TODAY))
    const second = names(collectCategoryStores([...rows].reverse(), [], 'food', TODAY))
    expect(first).toEqual(second)
  })
})

describe('buildStoreIndex(索引は全記録から1回だけ作る)', () => {
  it('1回の走査でカテゴリごとの候補がすべて出そろう', () => {
    const index = buildStoreIndex(
      [
        tx({ category: 'food', store: 'セブンイレブン' }),
        tx({ category: 'daily', store: 'セブンイレブン' }),
        tx({ category: 'food', store: 'スーパー' }),
      ],
      [],
      TODAY
    )
    // 同点(同じ日に1回ずつ)なので、並びは店名で安定させている
    expect(names(storeOptionsFor(index, 'food'))).toEqual(['スーパー', 'セブンイレブン'])
    expect(names(storeOptionsFor(index, 'daily'))).toEqual(['セブンイレブン'])
    expect(storeOptionsFor(index, null)).toEqual([])
    expect(storeOptionsFor(index, 'transport')).toEqual([])
  })
})

describe('guessStoreCategory(店 → カテゴリの自動選択・機能067/075)', () => {
  const index = (rows: Transaction[], learnedRows: StoreCategory[] = []) =>
    buildStoreIndex(rows, learnedRows, TODAY)

  it('その店でいちばん多く使ったカテゴリを選ぶ(「最後に選んだ」ではない)', () => {
    const guess = guessStoreCategory(
      index([
        tx({ category: 'food', store: 'コンビニ', date: '2026-08-01' }),
        tx({ category: 'food', store: 'コンビニ', date: '2026-08-02' }),
        tx({ category: 'food', store: 'コンビニ', date: '2026-08-03' }),
        // 最後の1件だけ日用品 — 「最後に選んだ」方式だとこれに引きずられる
        tx({ category: 'daily', store: 'コンビニ', date: '2026-08-04' }),
      ]),
      'コンビニ'
    )
    expect(guess?.category).toBe('food')
    expect(guess?.confident).toBe(true)
  })

  it('僅差で割れているときは自信ありげに1つに決めない', () => {
    const guess = guessStoreCategory(
      index([
        tx({ category: 'food', store: 'コンビニ' }),
        tx({ category: 'food', store: 'コンビニ' }),
        tx({ category: 'daily', store: 'コンビニ' }),
      ]),
      'コンビニ'
    )
    expect(guess?.category).toBe('food')
    expect(guess?.confident).toBe(false)
    expect(guess?.rivals).toEqual(['daily'])
  })

  it('はっきり差が付いていれば言い切る', () => {
    const guess = guessStoreCategory(
      index([
        tx({ category: 'food', store: 'コンビニ' }),
        tx({ category: 'food', store: 'コンビニ' }),
        tx({ category: 'food', store: 'コンビニ' }),
        tx({ category: 'food', store: 'コンビニ' }),
        tx({ category: 'daily', store: 'コンビニ' }),
      ]),
      'コンビニ'
    )
    expect(guess?.confident).toBe(true)
    expect(guess?.rivals).toEqual([])
  })

  it('表記ゆれがあっても同じ店として数える', () => {
    const guess = guessStoreCategory(
      index([
        tx({ category: 'food', store: 'セブン イレブン' }),
        tx({ category: 'food', store: 'ｾﾌﾞﾝｲﾚﾌﾞﾝ' }),
        tx({ category: 'daily', store: 'セブンイレブン' }),
      ]),
      'ＳＥＶＥＮ'.replace('ＳＥＶＥＮ', 'セブンイレブン')
    )
    expect(guess?.category).toBe('food')
  })

  it('履歴が無い店は store_categories の学習内容に従う(別端末で覚えた店の保険)', () => {
    const guess = guessStoreCategory(index([], [learned('八百屋', 'food', '2026-08-01T00:00:00Z')]), '八百屋')
    expect(guess).toEqual({ category: 'food', confident: true, rivals: [] })
  })

  it('知らない店・空文字では何も返さない', () => {
    expect(guessStoreCategory(index([tx({ store: 'スーパー' })]), 'まだ行っていない店')).toBeNull()
    expect(guessStoreCategory(index([]), '')).toBeNull()
  })

  it('支出以外は数えない', () => {
    const guess = guessStoreCategory(
      index([tx({ type: 'partner_deposit', category: 'food', store: '銀行' })]),
      '銀行'
    )
    expect(guess).toBeNull()
  })
})

describe('isSameStore', () => {
  it('空文字は何にも一致しない', () => {
    expect(isSameStore('', '')).toBe(false)
  })

  it('同じ店かどうかを正規化して比べる', () => {
    expect(isSameStore('ＳＥＶＥＮ', 'seven')).toBe(true)
    expect(isSameStore('セブン', 'ローソン')).toBe(false)
  })
})
