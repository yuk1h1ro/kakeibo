// ============================================================
// 記録の CSV 書き出し (機能198)
//
// 目的は **バックアップ** です。Supabase の無料プランには自動バックアップが無く、
// 操作ミスや事故で消えたデータは戻せません。1年分溜まってから失うと痛みが大きいので、
// 端末に丸ごと書き出せる手段を用意します。
//
// ここに置くのは「文字列を組み立てるところまで」の純粋関数だけ。
// 実際に端末へ保存するところ(Blob / 共有シート)は csvFile.ts、
// 画面は CsvExportSheet.tsx が持ちます。テストできる部分をすべてこちらに寄せています。
//
// 決めごと
//   * **情報の完全性が最優先**。見た目の整形より「あとから読んで意味が取れる」
//     「一部でも欠けない」ことを優先する
//   * カテゴリは **表示名** で出す。ID (food など) では、あとから開いた人に意味が伝わらない。
//     ただし ID も末尾の列に残す — 名前は変えられるので、名前だけでは元に戻せないため
//   * 金額は素の整数。¥ もカンマも付けない — 表計算が数値として読めるようにするため。
//     画面の目隠し (機能169) はここに効かせない(伏字のバックアップは意味が無い)。
//     format.ts の yenPlain と同じ「画面ではないものには素の値を」という作法に揃える
//   * 改行・カンマ・引用符を含むメモや店名でも壊れないよう、RFC 4180 に従って囲む
//   * 行区切りは CRLF (RFC 4180)。Excel でもテキストエディタでも素直に開ける
//   * 中身は原文のまま出す。先頭が = や + の店名を無害化する小細工はしない
//     — バックアップは「入っていたとおり」であることが最優先だから
// ============================================================

import {
  partnerPaid,
  satisfactionOf,
  tagsOf,
  type Satisfaction,
  type Transaction,
  type TransactionType,
} from './types'
import { favorOf, type FavorKind } from './favors'

// ---------- RFC 4180 ----------

/**
 * 1つの値を CSV の項目にする。(純粋関数)
 *
 * 引用符・カンマ・改行(CR / LF のどちらか一方でも)を含むときは全体を "" で囲み、
 * 中の " は "" に倍にする。囲まなくてよい値はそのまま出す(無駄に囲むと読みにくい)。
 *
 * ここが壊れると「ラーメン、餃子」というメモ1つで列がずれ、
 * バックアップとしての意味を丸ごと失う。この関数がこのファイルの心臓部。
 */
export function escapeCsvField(value: string): string {
  if (value === '') return ''
  if (!/[",\r\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

/** 項目を1行にする。(純粋関数) */
export function toCsvRow(fields: readonly string[]): string {
  return fields.map(escapeCsvField).join(',')
}

/** 行を CSV 本文にする。(純粋関数。行区切りは CRLF) */
export function toCsvText(rows: readonly (readonly string[])[]): string {
  return rows.map(toCsvRow).join('\r\n')
}

/**
 * BOM (U+FEFF)。
 *
 * Excel は BOM の無い UTF-8 を Shift_JIS だと思って開くため、日本語が化ける。
 * テキストエディタ・スプレッドシート側は BOM があっても読めるので、付ける側に倒す。
 */
export const BOM = '﻿'

export function withBom(text: string): string {
  return text.startsWith(BOM) ? text : BOM + text
}

// ---------- 列の構成 ----------

/**
 * 列の並び。
 *
 * 前半は人が読む順(いつ・何に・いくら)、後半は機械的な控え(日時・ID)。
 * 列名は日本語にしてある — 半年後に開いた本人が読めることを優先する。
 */
export const CSV_HEADERS = [
  '日付',
  '種別',
  '金額',
  'カテゴリ',
  'お店',
  'メモ',
  'タグ',
  '彼女の負担分',
  '彼女が払った額',
  '気分',
  'おごり・値引き額',
  'おごり・値引きの別',
  'おごってくれた人',
  '記録元',
  '記録日時',
  '分割ID',
  'カテゴリID',
  'ID',
] as const

const TYPE_LABELS: Record<TransactionType, string> = {
  expense: '支出',
  partner_deposit: '預かり',
  partner_refund: '返金',
  partner_adjust: '調整',
}

const SATISFACTION_LABELS: Record<Satisfaction, string> = {
  good: '満足',
  neutral: '普通',
  regret: '後悔',
}

// おごり・値引き (favors.ts)。金額(amount)には入っていない額なので、
// 列を分けて出す。ここを落とすと「誰にご馳走になったか」がバックアップから
// 消え、書き戻しても復元できない
const FAVOR_LABELS: Record<FavorKind, string> = {
  treat: 'おごり',
  discount: '割引',
}

/**
 * 種別の表示名。(純粋関数)
 * 表に無い値(将来増えた種別・手で入れた行)はそのまま出す = 情報を落とさない。
 */
export function typeLabel(type: TransactionType): string {
  return TYPE_LABELS[type] ?? String(type)
}

/**
 * 文字列の項目を安全に取り出す。(純粋関数)
 * null / undefined は空文字に、数値などが紛れ込んでいても文字にして必ず出す
 * — バックアップの途中で例外を投げて全体が書き出せなくなるほうが困るため。
 */
function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : String(value)
}

/**
 * 数値の項目。(純粋関数)
 * 整数のまま出す(通貨記号・桁区切りを入れない) — 表計算で数値として扱えるように。
 * NaN や欠損は空欄にする(0 と区別が付かなくなるため)。
 */
function toNumberText(value: number): string {
  return Number.isFinite(value) ? String(value) : ''
}

/**
 * 記録元。(純粋関数)
 * 'recurring' は繰り返し入力が自動生成した行。無印は手入力。
 * 将来別の値が入ったときは、その値をそのまま出す(意味は分からなくても消さない)。
 */
export function sourceLabel(source: string | null | undefined): string {
  if (source === 'recurring') return '繰り返し入力'
  if (!source) return '手入力'
  return source
}

/**
 * 取引1件を CSV の1行(項目の配列)にする。(純粋関数)
 *
 * カテゴリ名の解決は呼び出し側から渡す(categories.ts の React ストアに依存させないため)。
 *
 * 預かり・返金・調整の行でも、値が入っていればそのまま出す。
 * 「支出ではないから空欄にする」という整形はしない — 種別の列を見れば読み違えようがなく、
 * 保存されている値を消してしまうほうがバックアップとしては損失だから。
 *
 * カテゴリだけは null のときに「未分類」ではなく空欄にする。
 * 「未分類」という名前のカテゴリを自分で作れてしまうので、
 * 空欄(カテゴリ無し)と区別が付かなくなるのを避ける。
 */
export function transactionToCsvRow(
  t: Transaction,
  labelOf: (category: string) => string
): string[] {
  const category = toText(t.category)
  const satisfaction = satisfactionOf(t)
  const favor = favorOf(t)
  return [
    toText(t.date),
    typeLabel(t.type),
    toNumberText(t.amount),
    category === '' ? '' : labelOf(category),
    toText(t.store),
    toText(t.memo),
    // タグは空白区切り。normalizeTag が空白を必ず落とすので、
    // タグ自体に空白は入らない = 区切りとして曖昧にならない (tags.ts)
    tagsOf(t).join(' '),
    toNumberText(t.partner_amount),
    toNumberText(partnerPaid(t)),
    satisfaction ? SATISFACTION_LABELS[satisfaction] : '',
    favor ? toNumberText(favor.amount) : '',
    favor ? FAVOR_LABELS[favor.kind] : '',
    favor ? favor.from : '',
    sourceLabel(t.source),
    toText(t.created_at),
    toText(t.split_group),
    category,
    toText(t.id),
  ]
}

/**
 * 取引の一覧を CSV(BOM 付き UTF-8 の中身)にする。(純粋関数)
 *
 * 並びは日付の昇順 → 記録日時の昇順。画面(新しい順)とは逆にしているのは、
 * 表計算で開いたときに家計簿として上から読めるほうが自然だから。
 *
 * 記録が0件でも **見出し行だけの CSV を返す**。空文字にしないのは、
 * 「書き出したのに中身が空のファイル」より「列の定義が残っている空のファイル」の
 * ほうが、あとから見て『この期間には記録が無かった』と読めるため。
 * (0件の期間をそもそも書き出させないかどうかは画面側の判断)
 *
 * 末尾に改行は付けない。付けると、素朴に splitで分ける読み手に
 * 空の1行が見えてしまうため(RFC 4180 でも末尾の改行は任意)。
 */
export function transactionsCsv(
  rows: readonly Transaction[],
  labelOf: (category: string) => string
): string {
  const sorted = [...rows].sort(
    (a, b) =>
      toText(a.date).localeCompare(toText(b.date)) ||
      toText(a.created_at).localeCompare(toText(b.created_at))
  )
  return withBom(
    toCsvText([
      CSV_HEADERS as readonly string[],
      ...sorted.map((t) => transactionToCsvRow(t, labelOf)),
    ])
  )
}

// ---------- 期間 ----------

/** 書き出す期間 */
export type ExportRange =
  | { kind: 'all' }
  /** 年 ('YYYY') */
  | { kind: 'year'; value: string }
  /** 月 ('YYYY-MM') */
  | { kind: 'month'; value: string }

/**
 * 期間で絞る。(純粋関数)
 * 日付は 'YYYY-MM-DD' なので前方一致で足りる(月をまたぐ計算をしなくてよい)。
 */
export function filterByRange(
  rows: readonly Transaction[],
  range: ExportRange
): Transaction[] {
  if (range.kind === 'all') return [...rows]
  return rows.filter((t) => toText(t.date).startsWith(range.value))
}

/** 画面に出す期間の名前。(純粋関数) */
export function describeRange(range: ExportRange): string {
  if (range.kind === 'all') return '全期間'
  if (range.kind === 'year') return `${Number(range.value)}年`
  const [y, m] = range.value.split('-')
  return `${Number(y)}年${Number(m)}月`
}

/** 同じ期間を指しているか。(純粋関数。選択中の見た目に使う) */
export function isSameRange(a: ExportRange, b: ExportRange): boolean {
  if (a.kind !== b.kind) return false
  return a.kind === 'all' || b.kind === 'all' || a.value === b.value
}

/**
 * 選べる年の一覧。(純粋関数。新しい順)
 * 記録のある年に加えて今年を必ず含める — 今年まだ1件も無い時期でも
 * 「今年」を選べないと、選択肢の並びが日によって変わって戸惑うため。
 */
export function exportYears(dates: readonly string[], todayIso: string): string[] {
  const years = new Set<string>([todayIso.slice(0, 4)])
  for (const d of dates) {
    if (typeof d === 'string' && d.length >= 4) years.add(d.slice(0, 4))
  }
  return [...years].sort((a, b) => b.localeCompare(a))
}

/**
 * 選べる月の一覧。(純粋関数。新しい順)
 * こちらは **記録のある月だけ**。月は数が多く、空の月を並べても選ぶ手間が増えるだけ。
 */
export function exportMonths(dates: readonly string[]): string[] {
  const months = new Set<string>()
  for (const d of dates) {
    if (typeof d === 'string' && d.length >= 7) months.add(d.slice(0, 7))
  }
  return [...months].sort((a, b) => b.localeCompare(a))
}

/**
 * 保存するファイル名。(純粋関数)
 *
 * 日本語を入れないのは、端末やクラウドの間で文字化け・拒否が起きにくいため。
 * 書き出した日を必ず入れる(同じ期間を何度も出したときに前のファイルを上書きしない)。
 */
export function csvFileName(range: ExportRange, todayIso: string): string {
  const stamp = todayIso.replace(/-/g, '')
  if (range.kind === 'all') return `kakeibo-all-${stamp}.csv`
  return `kakeibo-${range.value}-${stamp}.csv`
}
