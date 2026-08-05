// ============================================================
// カテゴリ ↔ お店の索引 (入力フローの組み替え)
//
// 入力の順番を「カテゴリ → お店 → 金額」に変えたので、
// カテゴリを選んだ瞬間に「そのカテゴリで過去に使った店」を出す必要がある。
// storeCategories.ts が持っているのは逆向き(店 → その店で最後に選んだカテゴリ)
// なので、ここでは前向き(カテゴリ → 店の一覧)を組み立てる。
//
// ---- なぜ取引履歴 (transactions) から集計するのか ----
//
// 利用者は同じ店を複数のカテゴリで使う(コンビニで食費と日用品、など)。
// store_categories は「その店で *最後に* 選ばれたカテゴリ」を1店1行で持つ設計なので、
// これだけを使うと必ず候補から漏れる — コンビニで日用品を買った翌日に食費を選んでも、
// コンビニが候補に出てこない。これが利用者にとって最も不便な壊れ方なので、
// 「そのカテゴリで実際に使った店」は取引履歴から数える。漏れないことを最優先する。
//
// store_categories は補い(取引を消した店・別端末で覚えた店)としてだけ足す。
// この作りなら「店×カテゴリ」に作り替えるマイグレーションは要らない
// (未実行の環境が生まれるほど、入力が壊れる面が増える)。
//
// ---- 計算量 ----
//
// 全記録を1回だけなめて索引(カテゴリ→店 / 店→カテゴリ)を作る。
// 呼び出し側は useMemo で1度だけ組み立て、カテゴリを選び直しても作り直さない。
// 記録が数千件になっても、描画のたびには走らない。
//
// 店名の正規化は storeCategories.ts の normalizeStoreName に揃える
// (全角/半角・大文字小文字・空白を吸収)。表示は利用者が実際に打った綴りを使う。
// ============================================================

import { normalizeStoreName, type StoreCategory } from './storeCategories'
import type { Transaction } from './types'

export interface StoreOption {
  /** 突き合わせ用に正規化した店名 (storeCategories.ts と同じ作法) */
  storeKey: string
  /** 画面に出す店名。同じ店なら最後に打った表記を採る */
  storeName: string
  /** そのカテゴリでこの店を使った回数(取引履歴から数えた実績) */
  uses: number
  /** 最後に使った日 (YYYY-MM-DD)。分からないときは空文字 */
  lastUsed: string
  /** 並べ替え用の重み。大きいほど上に出る */
  score: number
}

/** その店をどのカテゴリで何回使ったか */
export interface CategoryUse {
  category: string
  uses: number
  lastUsed: string
}

/** 店名からカテゴリを当てた結果 (機能067/075) */
export interface CategoryGuess {
  /** その店でいちばん多く使われたカテゴリ */
  category: string
  /** 迷いなく決めてよいか。僅差で割れているときは false */
  confident: boolean
  /** 僅差で並んでいる他のカテゴリ(confident が false のときだけ入る) */
  rivals: string[]
}

export interface StoreIndex {
  /** カテゴリ → そのカテゴリで使った店(並べ替え済み) */
  byCategory: Map<string, StoreOption[]>
  /** 店(正規化キー) → そのお店をどのカテゴリで何回使ったか(多い順) */
  byStore: Map<string, CategoryUse[]>
  /** 店(正規化キー) → store_categories が覚えているカテゴリ(履歴が無い店の保険) */
  learnedByStore: Map<string, string>
}

/** 候補として並べる上限。指で選べる数を超えて並べても、探すのが遅くなるだけ */
export const STORE_OPTION_LIMIT = 12

/** YYYY-MM-DD を UTC の通し日数に直す。不正な文字列は null */
function dayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(t) ? Math.floor(t / 86400000) : null
}

/** from から to までの日数。どちらかが不正なら null。(純粋関数) */
export function daysBetween(from: string, to: string): number | null {
  const a = dayNumber(from)
  const b = dayNumber(to)
  if (a === null || b === null) return null
  return b - a
}

/**
 * 「何日前に使ったか」を重みに直す。(純粋関数)
 *
 * 単純な回数順だと、引っ越しや行きつけの変化についていけない —
 * 何年も行っていない店がいつまでも先頭に居座り、いま通っている店が下に沈む。
 * 逆に単純な新しい順だと、たまたま1回寄っただけの店が常連の店を押しのける。
 * そこで「1回の利用」を新しいほど重く数えて足し合わせる。
 * 同じ時期の中では回数がそのまま効くので、基本は「よく使う順」になる。
 */
export function recencyWeight(daysAgo: number): number {
  if (daysAgo <= 7) return 4 // 今週
  if (daysAgo <= 30) return 2 // 今月あたり
  if (daysAgo <= 90) return 1 // ここ3か月
  return 0.5 // それより前(消しはしないが、下に沈める)
}

interface Bucket {
  storeKey: string
  storeName: string
  uses: number
  lastUsed: string
  score: number
}

/**
 * 全記録から索引を1回だけ組み立てる。(純粋関数)
 *
 * today は「何日前か」を測る基準日 (YYYY-MM-DD)。テストのために引数で受ける。
 */
export function buildStoreIndex(
  transactions: readonly Transaction[],
  learned: readonly StoreCategory[],
  today: string,
  limit: number = STORE_OPTION_LIMIT
): StoreIndex {
  // カテゴリ → (店キー → 集計)
  const perCategory = new Map<string, Map<string, Bucket>>()
  // 店キー → (カテゴリ → 集計)
  const perStore = new Map<string, Map<string, CategoryUse>>()

  for (const t of transactions) {
    if (t.type !== 'expense' || t.category === null || t.category === '') continue
    const name = (t.store ?? '').trim()
    const key = normalizeStoreName(name)
    if (key === '') continue

    // --- カテゴリ → 店 ---
    let stores = perCategory.get(t.category)
    if (!stores) {
      stores = new Map()
      perCategory.set(t.category, stores)
    }
    const gap = daysBetween(t.date, today)
    const weight = recencyWeight(gap === null ? 999 : gap)
    const cur = stores.get(key)
    if (!cur) {
      stores.set(key, { storeKey: key, storeName: name, uses: 1, lastUsed: t.date, score: weight })
    } else {
      cur.uses += 1
      cur.score += weight
      // 表記ゆれ(「セブン イレブン」/「ｾﾌﾞﾝｲﾚﾌﾞﾝ」)は最後に打った表記に寄せる
      if (t.date > cur.lastUsed) {
        cur.lastUsed = t.date
        cur.storeName = name
      }
    }

    // --- 店 → カテゴリ(自動選択の根拠) ---
    let cats = perStore.get(key)
    if (!cats) {
      cats = new Map()
      perStore.set(key, cats)
    }
    const use = cats.get(t.category)
    if (!use) cats.set(t.category, { category: t.category, uses: 1, lastUsed: t.date })
    else {
      use.uses += 1
      if (t.date > use.lastUsed) use.lastUsed = t.date
    }
  }

  // --- store_categories の学習内容。履歴に出てこない店だけを補う ---
  const learnedByStore = new Map<string, string>()
  for (const e of learned) {
    if (e.storeKey === '' || e.category === '') continue
    if (!learnedByStore.has(e.storeKey)) learnedByStore.set(e.storeKey, e.category)
    let stores = perCategory.get(e.category)
    if (!stores) {
      stores = new Map()
      perCategory.set(e.category, stores)
    }
    if (stores.has(e.storeKey)) continue
    const day = e.updatedAt.slice(0, 10)
    const gap = daysBetween(day, today)
    stores.set(e.storeKey, {
      storeKey: e.storeKey,
      storeName: e.storeName.trim(),
      // 履歴に無い(= 実績を数えられない)ので回数は 0。
      // 「1回は使った」ぶんの重みだけ与えて、履歴のある店より下に置く
      uses: 0,
      lastUsed: gap === null ? '' : day,
      score: gap === null ? 0.5 : recencyWeight(gap),
    })
  }

  const byCategory = new Map<string, StoreOption[]>()
  for (const [category, stores] of perCategory) {
    byCategory.set(
      category,
      [...stores.values()]
        .sort(
          (a, b) =>
            b.score - a.score ||
            b.lastUsed.localeCompare(a.lastUsed) ||
            b.uses - a.uses ||
            a.storeName.localeCompare(b.storeName, 'ja')
        )
        .slice(0, limit)
    )
  }

  const byStore = new Map<string, CategoryUse[]>()
  for (const [key, cats] of perStore) {
    byStore.set(
      key,
      [...cats.values()].sort(
        (a, b) => b.uses - a.uses || b.lastUsed.localeCompare(a.lastUsed) || a.category.localeCompare(b.category)
      )
    )
  }

  return { byCategory, byStore, learnedByStore }
}

/** 索引から、そのカテゴリの店の候補を取り出す。(純粋関数) */
export function storeOptionsFor(index: StoreIndex, category: string | null): StoreOption[] {
  if (category === null || category === '') return []
  return index.byCategory.get(category) ?? []
}

/**
 * 店名からカテゴリを当てる (機能067/075)。(純粋関数)
 *
 * 同じ店を複数カテゴリで使う前提なので「最後に選ばれたカテゴリ」ではなく
 * 「いちばん多く使われたカテゴリ」を採る(そのほうが外れにくい)。
 * 2位に2倍以上の差が無いときは割れているとみなし、confident を false にして
 * 呼び出し側が「決めつけない言い方」に切り替えられるようにする。
 * 履歴がまったく無い店は、store_categories の学習内容にそのまま従う。
 */
export function guessStoreCategory(index: StoreIndex, storeName: string): CategoryGuess | null {
  const key = normalizeStoreName(storeName)
  if (key === '') return null
  const uses = index.byStore.get(key)
  if (!uses || uses.length === 0) {
    const learned = index.learnedByStore.get(key)
    return learned === undefined ? null : { category: learned, confident: true, rivals: [] }
  }
  const best = uses[0]
  // 2:1 程度では「その店だからこのカテゴリ」と言い切れない。
  // 2倍を超える差が付いて初めて言い切る(等しく 2倍のときは割れている扱い)
  const confident = uses.length === 1 || best.uses > uses[1].uses * 2
  return {
    category: best.category,
    confident,
    // 「2倍つけて勝てていない」カテゴリだけを対抗馬として出す
    rivals: confident
      ? []
      : uses.slice(1).filter((u) => u.uses * 2 >= best.uses).map((u) => u.category),
  }
}

/**
 * そのカテゴリで過去に使った店の候補。(純粋関数)
 * 索引を1回だけ作る呼び出し側は storeOptionsFor を使う。
 */
export function collectCategoryStores(
  transactions: readonly Transaction[],
  learned: readonly StoreCategory[],
  category: string | null,
  today: string,
  limit: number = STORE_OPTION_LIMIT
): StoreOption[] {
  if (category === null || category === '') return []
  return storeOptionsFor(buildStoreIndex(transactions, learned, today, limit), category)
}

/** 2つの店名が同じ店を指すか。(純粋関数) */
export function isSameStore(a: string, b: string): boolean {
  const ka = normalizeStoreName(a)
  return ka !== '' && ka === normalizeStoreName(b)
}
