// ============================================================
// 「非日常」とみなすタグの選択(端末ごと)
//
// ---- なぜ端末内(localStorage)なのか ----
//   1. これは **記録ではなく見方** だから。旅行を特別扱いするかどうかを
//      変えても、保存されている取引は1件も変わらない。
//      別の端末で選び直しても、失われるのは「表示の設定」だけで済む。
//   2. 保存先を DB にすると列(またはテーブル)を1つ増やすことになる。
//      この家計簿は過去に「マイグレーション未実行で入力が失われた」事故を
//      起こしていて、tags 列すら無い環境が現に想定されている。
//      設定のためにその面を広げたくない。
//   3. 金額の目隠し(機能169)やテンキーの設定と同じ「端末ごとの見え方」の
//      仲間なので、置き場所も同じにしておくほうが探しやすい。
//
// ---- 既定で 旅行 / デート / 出張 を入れておく ----
// 「まず設定してください」から始まる機能は、たいてい設定されないまま終わる。
// 何もしなくても意味のある切り分けが見えるよう、いちばんよくある3つを
// 最初から選んだ状態にしてある。決め打ちではなく、増やすことも
// **1つも選ばない状態に戻すこと** もできる。
//
// そのため保存値は3つの状態を区別する:
//   キーが無い     … まだ触っていない → 既定の3つ
//   [] が入っている … 自分で全部外した → 全部が日常(既定を復活させない)
//   タグが入っている … その選択
// 「外したのに次に開くと戻っている」ほど信用を失う挙動はないので、
// 空配列は必ず尊重する。
// ============================================================

import { useSyncExternalStore } from 'react'
import { normalizeTag } from './tags'

const STORAGE_KEY = 'kakeibo.specialTags'

/**
 * 最初から選んでおくタグ。旅行・デート・出張 —
 * 「日常とは違う場面の支出」として最初に思い浮かぶ3つ。
 * 記録に1件も付いていなくても候補としては出す(でないと、
 * これから使うつもりのタグを選べない)。
 */
export const DEFAULT_SPECIAL_TAGS: readonly string[] = ['旅行', 'デート', '出張']

/**
 * 選べる特別タグの上限。1件に付けられるタグ(5個)とは別の数字で、
 * こちらは「旅行・デート・出張・帰省・冠婚葬祭…」を並べられる程度に広く取る。
 * 上限を置くのは、壊れた/巨大な保存値を読み込んで画面が埋まるのを防ぐため。
 */
export const MAX_SPECIAL_TAGS = 20

/**
 * 保存されている文字列を特別タグの配列に読み直す。(純粋関数)
 *
 * まだ触っていない(キーが無い)ときと、読めない値が入っているときは
 * **既定の3つ** を返す。空配列が保存されているときだけは、
 * 「自分で全部外した」という意思表示なので空のまま返す。
 */
export function resolveSpecialTags(raw: string | null): string[] {
  if (raw === null || raw === '') return [...DEFAULT_SPECIAL_TAGS]
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return [...DEFAULT_SPECIAL_TAGS]
  }
  if (!Array.isArray(parsed)) return [...DEFAULT_SPECIAL_TAGS]
  return parseSpecialTags(parsed)
}

/**
 * タグの配列を保存する形に整える。(純粋関数)
 * 空・重複・「#」だけのものを落とし、上限で打ち切る。
 * 入力欄(tags.ts)と同じ正規化を通すので、「#旅行」と「旅行」は同じになる。
 */
export function parseSpecialTags(parsed: readonly unknown[]): string[] {
  const out: string[] = []
  for (const v of parsed) {
    if (typeof v !== 'string') continue
    const tag = normalizeTag(v)
    if (tag === null || out.includes(tag)) continue
    out.push(tag)
    if (out.length >= MAX_SPECIAL_TAGS) break
  }
  return out
}

/** 保存する形に整える。(純粋関数。読み込みと同じ規則を通す) */
export function normalizeSpecialTags(tags: readonly string[]): string[] {
  return parseSpecialTags(tags)
}

function load(): string[] {
  try {
    return resolveSpecialTags(localStorage.getItem(STORAGE_KEY))
  } catch {
    // プライベートブラウズ等で localStorage が使えない環境でも、既定の3つで動かす
    return [...DEFAULT_SPECIAL_TAGS]
  }
}

// useSyncExternalStore に渡すスナップショットは参照を安定させる
// (毎回新しい配列を返すと再描画が止まらなくなる)
let current: string[] = load()
const listeners = new Set<() => void>()

export function getSpecialTags(): string[] {
  return current
}

export function setSpecialTags(tags: readonly string[]): void {
  current = normalizeSpecialTags(tags)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // 保存できなくても、この起動中は選んだとおりに見える
  }
  for (const l of listeners) l()
}

/** 1つ入り切り(チップのタップ) */
export function toggleSpecialTag(tag: string): void {
  const next = current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag]
  setSpecialTags(next)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 現在の選択。設定の変更に追従する */
export function useSpecialTags(): string[] {
  return useSyncExternalStore(subscribe, getSpecialTags, getSpecialTags)
}
