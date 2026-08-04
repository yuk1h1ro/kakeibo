// ============================================================
// 明細に対する操作の中身 (機能149 複製 / 151 一括編集 / 159 元に戻す)
//
// どれも「既存の1行から、書き込む内容(TransactionInput)を組み立てる」だけの
// 純粋関数。実際の書き込みは useTransactions のオフラインキュー経由で行うので、
// オフラインでも操作が失われない。
// ============================================================

import type { TransactionInput } from '../hooks/useTransactions'
import type { Transaction } from './types'

/**
 * 既存の行を、そのまま書き戻せる内容に写す。(純粋関数)
 * 一括編集・複製・元に戻す、のすべての土台。
 * source(自動生成の印)と satisfaction(気分)は「その記録が持っている事実」なので、
 * 写すときは必ず一緒に運ぶ — 編集しただけで印や気分が消えると記録が変質してしまう。
 */
export function transactionToInput(t: Transaction): TransactionInput {
  const input: TransactionInput = {
    date: t.date,
    type: t.type,
    amount: t.amount,
    category: t.category,
    memo: t.memo ?? '',
    store: t.store ?? '',
    partner_amount: t.partner_amount,
  }
  // 'recurring' 以外(空文字・null)のときはキーごと送らない。
  // source 列が無い環境でも書き込みが通るようにするため。
  if (t.source === 'recurring') input.source = 'recurring'
  // 未設定(undefined)のときはキーごと落とす(satisfaction 列が無い環境への配慮)
  if (t.satisfaction !== undefined) input.satisfaction = t.satisfaction
  // 誰が払ったか(018)・タグ(088)・分割の束ね(096)も「その記録が持っている事実」。
  // 写さずに書き戻すと、編集や取り消しをしただけで預かり残高が動いてしまう
  // (partner_paid が消えると立て替えの向きが変わる)。
  // 列が無い環境に配慮して、undefined のときはキーごと落とす。
  if (t.partner_paid !== undefined && t.partner_paid !== null) input.partner_paid = t.partner_paid
  if (t.tags !== undefined && t.tags !== null) input.tags = t.tags
  if (t.split_group !== undefined) input.split_group = t.split_group
  return input
}

/**
 * 複製 (機能149)。同じ内容で「今日の日付」にする。(純粋関数)
 *
 * 過去日のまま複製しても使い道が薄い。複製を使いたいのは
 * 「この前と同じものをまた買った」ときなので、日付は今日にする。
 * 気分(satisfaction)は引き継がない — 今回の買い物をどう感じたかはこれから決まるため。
 * 自動生成の印も引き継がない — 手で複製した記録は手入力扱いが正しい。
 */
export function duplicateInput(t: Transaction, todayIso: string): TransactionInput {
  const input = transactionToInput(t)
  delete input.source
  delete input.satisfaction
  // 分割の束ね(096)は引き継がない — 複製は別の会計なので、
  // 元の会計の内訳に紛れ込ませてはいけない。タグ(088)は引き継ぐ
  // (「また同じ旅行の支出」であることのほうが多いため)
  delete input.split_group
  return { ...input, date: todayIso }
}

/** 一括カテゴリ変更 (機能151)。カテゴリ以外は一切変えない。(純粋関数) */
export function withCategory(t: Transaction, category: string | null): TransactionInput {
  return { ...transactionToInput(t), category }
}

/**
 * 削除の取り消し (機能159) で書き戻す内容。(純粋関数)
 *
 * 行ID(t.id)は呼び出し側がそのまま使う。同じIDで入れ直すことで、
 * 共有ページのコメントなど「取引IDを指しているもの」との結び付きが切れない。
 */
export function restoreInput(t: Transaction): TransactionInput {
  return transactionToInput(t)
}

/**
 * 一括カテゴリ変更の対象。(純粋関数)
 * すでにそのカテゴリの行・預かりの行は除く(無意味な更新を投げない)。
 * 預かりはカテゴリを持たないので、まとめてカテゴリを変える対象にしない。
 */
export function categoryBulkTargets(
  txs: readonly Transaction[],
  category: string | null
): Transaction[] {
  return txs.filter((t) => t.type === 'expense' && t.category !== category)
}
