// ============================================================
// 過去の記録に、あとから行き先タグをまとめて付ける / 外す
//
// ---- なぜ必要か ----
// 共起タグのドリルダウン(reportTags.ts)は「旅行」と「2026和歌山」が
// **フラットに2つ付いている**ことが前提。ところが行き先タグが自動で付くのは
// 旅行モードを使ったときだけなので、**すでに終わった旅行には何も付いていない**。
// 先週の旅行35件を1件ずつ開いてタグを打つ運用は続かない(続かない前提の
// 入力に依存した集計は、いずれ意味を失う)。
// レポートの「回ごと」はすでに 8月6日〜8月8日 という1回ぶんを特定できているので、
// **その行から1タップ**でまとめて付けられるようにした。
//
// ---- このファイルの責任 ----
// 「どの記録に効くか」を決める純粋関数だけ。実際の書き込みは
// useTransactions の updateMany(= オフラインキュー経由)が行う。
// 直接 Supabase に投げないのは、通信できない場所で操作しても記録を失わないため。
//
// ---- 黙って飛ばさない ----
// 1件に付けられるタグは5個まで(MAX_TAGS_PER_TX)。上限の記録に足そうとすると
// sanitizeTags が静かに落とすので、**落ちた件数を必ず数えて画面に返す**。
// 「35件に付けたはずが34件だった」が黙って起きるのがいちばん困る。
// ============================================================

import type { TransactionInput } from '../hooks/useTransactions'
import type { Transaction } from './types'
import { tagsOf } from './types'
import { MAX_TAGS_PER_TX, normalizeTag, sanitizeTags } from './tags'
import { transactionToInput } from './txActions'

export interface BulkTagPlan {
  /** 正規化済みのタグ */
  tag: string
  /** 実際に書き換える記録(これだけが updateMany に流れる) */
  targets: Transaction[]
  /** すでに同じタグが付いていて、何もしなくてよい件数 */
  alreadyCount: number
  /** タグが上限(5個)に達していて付けられない件数 */
  fullCount: number
  /** 見ていた記録の総数 */
  totalCount: number
}

/**
 * まとめて付ける計画を立てる。(純粋関数)
 * タグが空になる文字列のときは null(= 実行できない)。
 *
 * すでに付いている記録を対象から外すのは、書き換えなくても結果が同じだから。
 * 無駄な update を積むと、変更履歴に「タグ: #旅行 → #旅行」という
 * 中身の無い行が35件並び、本当の変更が埋もれる。
 */
export function planAddTag(txs: readonly Transaction[], rawTag: string): BulkTagPlan | null {
  const tag = normalizeTag(rawTag)
  if (tag === null) return null
  const targets: Transaction[] = []
  let alreadyCount = 0
  let fullCount = 0
  for (const t of txs) {
    const own = tagsOf(t)
    if (own.includes(tag)) {
      alreadyCount += 1
      continue
    }
    // 上限に達している記録は、足しても sanitizeTags に落とされる。
    // 落ちたことを数えて画面に出すため、ここで先に分けておく
    if (own.length >= MAX_TAGS_PER_TX) {
      fullCount += 1
      continue
    }
    targets.push(t)
  }
  return { tag, targets, alreadyCount, fullCount, totalCount: txs.length }
}

/**
 * まとめて外す計画を立てる。(純粋関数)
 *
 * 付け間違えたときの逃げ道。35件に一括で付けたものを1件ずつ剥がすのは
 * 現実的ではないので、付けた入り口と同じ場所から外せるようにする。
 * 付いていない記録は対象にしない(こちらも空の update を積まないため)。
 */
export function planRemoveTag(txs: readonly Transaction[], rawTag: string): BulkTagPlan | null {
  const tag = normalizeTag(rawTag)
  if (tag === null) return null
  const targets = txs.filter((t) => tagsOf(t).includes(tag))
  return {
    tag,
    targets,
    alreadyCount: txs.length - targets.length,
    fullCount: 0,
    totalCount: txs.length,
  }
}

/**
 * タグを足した書き込み内容。(純粋関数)
 * 組み立ては必ず transactionToInput を通す — 項目を手書きすると
 * partner_paid のような「その記録が持っている事実」が抜けて、
 * 預かり残高が静かに動く(txActions.ts の withSatisfaction のコメントを参照)。
 * 足すタグは**末尾**に置く。先頭に置くと、上限の記録で元のタグが押し出される。
 */
export function tagAddInput(t: Transaction, tag: string): TransactionInput {
  return { ...transactionToInput(t), tags: sanitizeTags([...tagsOf(t), tag]) }
}

/** タグを外した書き込み内容。(純粋関数) */
export function tagRemoveInput(t: Transaction, tag: string): TransactionInput {
  return { ...transactionToInput(t), tags: tagsOf(t).filter((x) => x !== tag) }
}

/** updateMany にそのまま渡せる形にする。(純粋関数) */
export function bulkTagUpdates(
  plan: BulkTagPlan,
  mode: 'add' | 'remove'
): { id: string; input: TransactionInput }[] {
  return plan.targets.map((t) => ({
    id: t.id,
    input: mode === 'add' ? tagAddInput(t, plan.tag) : tagRemoveInput(t, plan.tag),
  }))
}

/**
 * 押す前に見せる確認の文。(純粋関数)
 * **件数を必ず先に書く。** 35件が一度に書き換わる操作なので、
 * 押してから知るのでは遅い。飛ばす分があるときは、その理由もここで言う。
 */
export function bulkTagConfirmText(plan: BulkTagPlan, mode: 'add' | 'remove'): string {
  const verb = mode === 'add' ? '付けます' : '外します'
  const head = `${plan.targets.length}件に #${plan.tag} を${verb}`
  const notes: string[] = []
  if (mode === 'add') {
    if (plan.alreadyCount > 0) notes.push(`すでに付いている${plan.alreadyCount}件はそのまま`)
    if (plan.fullCount > 0) {
      notes.push(`タグが${MAX_TAGS_PER_TX}個ある${plan.fullCount}件は付けられません`)
    }
  } else if (plan.alreadyCount > 0) {
    notes.push(`付いていない${plan.alreadyCount}件はそのまま`)
  }
  return notes.length > 0 ? `${head}(${notes.join('・')})` : head
}

/**
 * 実行したあとに見せる文。(純粋関数)
 * 上限で付けられなかった分は **黙って飛ばさず、必ずここで伝える**。
 */
export function bulkTagDoneText(plan: BulkTagPlan, mode: 'add' | 'remove'): string {
  const verb = mode === 'add' ? '付けました' : '外しました'
  const head = `${plan.targets.length}件に #${plan.tag} を${verb}`
  if (mode === 'add' && plan.fullCount > 0) {
    return `${head}。${plan.fullCount}件は付けられませんでした(タグは1件${MAX_TAGS_PER_TX}個までです)`
  }
  return head
}

/**
 * その記録たちに実際に付いているタグを、多い順に数える。(純粋関数)
 * 「この回から外す」の候補に使う。除外(exclude)には、いま選んでいる親タグを渡す —
 * 「#旅行」そのものをこの入り口から外せてしまうと、回そのものが消えて
 * 一覧から辿れなくなる(外すなら履歴から1件ずつ、が正しい)。
 */
export function tagsOnTransactions(
  txs: readonly Transaction[],
  exclude: readonly string[] = []
): { tag: string; count: number }[] {
  const acc = new Map<string, number>()
  for (const t of txs) {
    for (const tag of new Set(tagsOf(t))) {
      if (exclude.includes(tag)) continue
      acc.set(tag, (acc.get(tag) ?? 0) + 1)
    }
  }
  return [...acc.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
}
