// ============================================================
// タグ / ラベル (機能088)
//
// ---- なぜ「メモの中の #ハッシュタグ」ではなく専用の列にしたか ----
// 機能060(レシート読み取り)まわりで、メモから拾う軽い方式も候補だった。
// それでも専用の列(transactions.tags text[])にしたのは次の3点:
//   1. メモは共有ページに出さない項目。タグをメモに埋めると、
//      「メモを見せない」という約束と「タグで絞りたい」欲求がぶつかる。
//   2. メモを書き直しただけでタグが消える / 金額の「#」やお店の名前が
//      うっかりタグになる、という事故が起きる。分類は明示的に付けたい。
//   3. 候補の提示(過去に使ったタグを1タップで再利用)を出すには、
//      全メモを解析するより配列を数えるほうが確実で速い。
// ただし入力の手間は増やしたくないので、**入力欄では # 付きでも無しでも
// 打てる**ようにし、履歴の検索欄でも「#デート」で引けるようにしている。
//
// ここは純粋関数だけ。React にも Supabase にも依存しない。
// ============================================================

import type { Transaction } from './types'
import { tagsOf } from './types'

/** 1件に付けられるタグの上限。多すぎると行が読めなくなる */
export const MAX_TAGS_PER_TX = 5

/** タグ1つの長さの上限(文字) */
export const MAX_TAG_LENGTH = 20

/**
 * タグ文字列を保存する形に整える。(純粋関数)
 * - 前後の空白と先頭の「#」を落とす(「#旅行2026」も「旅行2026」も同じタグ)
 * - 中の空白は詰める(タグの区切りに空白を使うため)
 * - 長すぎるものは切る
 * 空になったら null(= タグとして扱わない)。
 */
export function normalizeTag(raw: string): string | null {
  const s = raw
    .trim()
    .replace(/^[#＃]+/, '')
    .replace(/[\s　]+/g, '')
    .trim()
  if (s === '') return null
  return s.slice(0, MAX_TAG_LENGTH)
}

/**
 * 入力欄の文字列をタグの配列にする。(純粋関数)
 * 空白・カンマ・読点で区切る。「#旅行2026 #デート」も「旅行2026,デート」も同じ。
 */
export function parseTagInput(input: string): string[] {
  return sanitizeTags(input.split(/[\s　,、]+/).map((s) => normalizeTag(s) ?? ''))
}

/** 重複と空を落とし、上限で打ち切る。(純粋関数。並び順は入力順を保つ) */
export function sanitizeTags(tags: readonly string[]): string[] {
  const out: string[] = []
  for (const raw of tags) {
    const t = normalizeTag(raw)
    if (t === null) continue
    if (out.includes(t)) continue
    out.push(t)
    if (out.length >= MAX_TAGS_PER_TX) break
  }
  return out
}

export interface TagUsage {
  tag: string
  count: number
}

/**
 * 使われているタグを多い順に集める。(純粋関数)
 * 同数のときは名前順で必ず決まる(並びがブレて「さっき押したタグ」を見失わないため)。
 */
export function collectTags(txs: readonly Transaction[], limit = 30): TagUsage[] {
  const acc = new Map<string, number>()
  for (const t of txs) {
    for (const tag of tagsOf(t)) {
      acc.set(tag, (acc.get(tag) ?? 0) + 1)
    }
  }
  return [...acc.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
    .slice(0, limit)
}

/**
 * 選んだタグのどれかが実際に付いているか。(純粋関数)
 *
 * 「選んでいないときは全件を通す」絞り込み用の matchesAnyTag とは別に用意した。
 * レポートの日常/非日常の切り分け(reportTags.ts)は、この判定で支出を
 * **2つに分ける**ので、「1つも選んでいない = 全件が特別」になってしまうと
 * 意味が反転する。分ける側は「付いていない = false」でなければならない。
 */
export function hasAnyTag(t: Transaction, selected: readonly string[]): boolean {
  if (selected.length === 0) return false
  const own = tagsOf(t)
  return selected.some((tag) => own.includes(tag))
}

/**
 * 選んだタグのどれかが付いているか。(純粋関数)
 * OR で判定するのは、カテゴリの絞り込み(既存)と同じ挙動にそろえるため。
 * 選んでいないとき(空配列)は全件を通す。
 */
export function matchesAnyTag(t: Transaction, selected: readonly string[]): boolean {
  return selected.length === 0 || hasAnyTag(t, selected)
}
