// ============================================================
// 明細に対する操作の中身 (機能149 複製 / 151 一括編集 / 159 元に戻す)
//
// どれも「既存の1行から、書き込む内容(TransactionInput)を組み立てる」だけの
// 純粋関数。実際の書き込みは useTransactions のオフラインキュー経由で行うので、
// オフラインでも操作が失われない。
// ============================================================

import type { TransactionInput } from '../hooks/useTransactions'
import type { Satisfaction, Transaction } from './types'

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
  // おごり・値引き (favors.ts)。**3つで1組**なので、写すときも必ず3つ一緒に運ぶ。
  // 額だけ残って理由が消えると DB の制約に弾かれるし、相手の名前だけ落ちると
  // 「誰にご馳走になったか」という、この記録でいちばん値打ちのある部分が消える。
  // 全額おごりの回は amount が 0 なので、写し損ねると 0円 の理由不明な行になり、
  // 保存そのものができなくなる(そうなると編集も取り消しも通らない)。
  if (t.favor_amount !== undefined && t.favor_amount !== null) {
    input.favor_amount = t.favor_amount
    input.favor_kind = t.favor_kind ?? null
    input.favor_from = t.favor_from ?? ''
  }
  // created_at はここでは写さない。書き換え(一括編集・気分の付け直し)で送ると、
  // 楽観表示のために仮置きした時刻でサーバーの本物を上書きしてしまうため。
  // 「同じ行を入れ直す」restoreInput だけが写す。
  return input
}

/**
 * 複製 (機能149)。同じ内容で「今日の日付」にする。(純粋関数)
 *
 * 過去日のまま複製しても使い道が薄い。複製を使いたいのは
 * 「この前と同じものをまた買った」ときなので、日付は今日にする。
 * 気分(satisfaction)は引き継がない — 今回の買い物をどう感じたかはこれから決まるため。
 * 自動生成の印も引き継がない — 手で複製した記録は手入力扱いが正しい。
 *
 * おごり・値引き (favors.ts) は **引き継ぐ**。気分と同じく「その回の事実」ではあるが、
 * 全額おごりの記録は amount が 0 で、ここで理由だけ落とすと
 * 「理由の無い 0円」= DB が受け付けない行になり、複製した瞬間に同期が止まる。
 * 今回は自分で払ったのなら、複製したあとに外せばよい(外すのは1タップ)。
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
 * 気分スタンプの付け直し (機能143)。気分以外は一切変えない。(純粋関数)
 *
 * 画面側で `{ date, type, amount, ... , satisfaction }` と項目を手書きしていた頃は
 * partner_paid が抜けており、サーバーのデータは部分更新なので無事だったが、
 * 通知の差分計算がそれを 0 とみなして「記録が修正されました 差分 −¥5,000」という
 * **実在しない差分を彼女に送っていた**。組み立ては必ずここを通すこと。
 */
export function withSatisfaction(
  t: Transaction,
  satisfaction: Satisfaction | null
): TransactionInput {
  return { ...transactionToInput(t), satisfaction }
}

/**
 * 削除の取り消し (機能159) で書き戻す内容。(純粋関数)
 *
 * 行ID(t.id)は呼び出し側がそのまま使う。同じIDで入れ直すことで、
 * 共有ページのコメントなど「取引IDを指しているもの」との結び付きが戻る
 * (コメント側の外部キーは on delete cascade を外してあり、
 *  明細が消えている間はコメントが見えないだけで、消えはしない)。
 *
 * created_at も写す。写さないと DB の now() が入り、**元に戻したはずの記録が
 * 「いま作られた記録」になってしまう** — 同じ日の中での並び順が変わり、
 * レポートの「時間帯別」も復元した時刻に付け替わる。
 */
export function restoreInput(t: Transaction): TransactionInput {
  const input = transactionToInput(t)
  if (typeof t.created_at === 'string' && t.created_at !== '') input.created_at = t.created_at
  return input
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
