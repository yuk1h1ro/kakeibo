// ============================================================
// 月末に預かり金サマリーを Discord へ (機能016)
//
// サーバー側の cron は使えないので、繰り返し入力 (recurringRules.ts) と
// 同じ作法にそろえる:
//   1. 「まだ送っていない月」を純粋関数で算出する
//   2. **先に Supabase へ「送った」印を書き込み、成功したときだけ**送る
//      (逆順にすると、印の書き込みに失敗した次回起動で二重に送ってしまう)
//   3. 印は (user_id, month) の一意制約付きなので、複数端末が同時に開いても
//      INSERT に成功した1台しか送らない
//
// 二重送信の回避を、送信漏れの回避より優先している。
// Discord への送信は既存の作法どおり投げっぱなしで、失敗しても記録処理を止めない。
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { formatMonth, monthKey, yenPlain } from './format'
import { shiftMonth } from './calendar'
import { getWebhookUrl, sendDiscordMessage } from './discordNotify'
import { balanceWording, partnerImpact, type PartnerTxLike } from './partnerBalance'
import { partnerPaid } from './types'
import { createTableAvailability } from './tableAvailability'

/** さかのぼって送る月数の上限。長期間アプリを開いていなくても通知が溢れないようにする */
export const SUMMARY_LOOKBACK_MONTHS = 3

// ---------- 純粋関数 ----------

/**
 * まだ送っていない月を古い順に返す。(純粋関数)
 *
 * 境界の決めごと:
 * - **当月は絶対に含めない**。月の途中で「今月のまとめ」を送ってしまわないため。
 * - さかのぼるのは直近 lookback ヶ月まで。それより古い月は窓から外れ、
 *   以後ずっと対象にならない(開くたびに古い月が湧いて溢れるのを防ぐ)。
 * - 年をまたいでも 1月 の前は前年12月として正しく扱う。
 *
 * @param today  'YYYY-MM-DD'
 * @param sentMonths すでに送信済みの月 ('YYYY-MM') の集まり
 */
export function dueSummaryMonths(
  today: string,
  sentMonths: readonly string[],
  lookback: number = SUMMARY_LOOKBACK_MONTHS
): string[] {
  if (lookback <= 0) return []
  const sent = new Set(sentMonths)
  const current = monthKey(today)
  const out: string[] = []
  // i=1 が前月。古い順に並べたいので後ろから詰める
  for (let i = lookback; i >= 1; i--) {
    const m = shiftMonth(current, -i)
    if (!sent.has(m)) out.push(m)
  }
  return out
}

/** 集計に必要な最小の形(Transaction を構造的に受ける) */
export interface SummaryTxLike extends PartnerTxLike {
  date: string
  category: string | null
}

export interface MonthlySummary {
  month: string
  /** その月に彼女の負担として差し引いた合計 */
  withdrawTotal: number
  /** その月に預かった合計 */
  depositTotal: number
  /** その月に彼女へ返した合計 (機能012)。正の数 */
  refundTotal: number
  /** その月の手動調整の合計 (機能012)。符号つき(減らす調整はマイナス) */
  adjustTotal: number
  /** その月に彼女自身が払った合計 (機能018)。正の数 */
  partnerPaidTotal: number
  /** 集計時点(= 送信時点)の残高。全期間の影響額の合計 */
  balance: number
  /** その月の彼女負担分のカテゴリ別内訳(多い順) */
  categories: { category: string | null; amount: number }[]
  /** 動きが1件も無ければ false(送るものが無いので通知しない) */
  hasActivity: boolean
}

/**
 * 指定した月の預かり金サマリーを組み立てる。(純粋関数)
 *
 * 数えるのは「その月に残高を動かしたもの **すべて**」。
 * 預かりと彼女の負担分しか数えていなかった頃は、残高だけが正しくて
 * 本文の足し算が合わず、返金・調整しか無かった月は hasActivity が false になって
 * 「2万円返した月に1通も届かない」という黙り方をしていた。
 */
export function buildMonthlySummary(
  rows: readonly SummaryTxLike[],
  month: string
): MonthlySummary {
  let withdrawTotal = 0
  let depositTotal = 0
  let refundTotal = 0
  let adjustTotal = 0
  let partnerPaidTotal = 0
  let balance = 0
  const byCategory = new Map<string | null, number>()

  for (const t of rows) {
    // 残高は全期間の積み上げ(月で区切らない)。
    // 返金・調整・彼女が払った回も含めるため、計算は partnerBalance.ts に一本化する
    balance += partnerImpact(t)
    if (monthKey(t.date) !== month) continue
    if (t.type === 'partner_deposit') {
      depositTotal += t.amount
    } else if (t.type === 'partner_refund') {
      refundTotal += t.amount
    } else if (t.type === 'partner_adjust') {
      // 調整は符号つき。増やす調整と減らす調整が同額あれば 0 になる
      adjustTotal += t.amount
    } else if (t.type === 'expense') {
      // 機能018: 彼女が払った額は残高を増やす。負担分と別の行として数える
      partnerPaidTotal += partnerPaid(t)
      if (t.partner_amount > 0) {
        withdrawTotal += t.partner_amount
        byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.partner_amount)
      }
    }
  }

  const categories = [...byCategory.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)

  return {
    month,
    withdrawTotal,
    depositTotal,
    refundTotal,
    adjustTotal,
    partnerPaidTotal,
    balance,
    categories,
    // 残高が動いた月は必ず送る。返金・調整しか無い月に黙るのがいちばん困る
    hasActivity:
      withdrawTotal > 0 ||
      depositTotal > 0 ||
      refundTotal > 0 ||
      adjustTotal !== 0 ||
      partnerPaidTotal > 0,
  }
}

/**
 * Discord に流す本文を組み立てる。(純粋関数)
 * カテゴリ名の解決は呼び出し側から関数で受け取る(このファイルを純粋に保つため)。
 *
 * 0 の行は出さない(使っていない機能の行を毎月見せない)が、
 * **残高を動かしたものは必ず1行にする**。書かないと、彼女が本文を足し算しても
 * 残高に届かず、通知そのものが信用されなくなる。
 */
export function formatMonthlySummary(
  s: MonthlySummary,
  labelOf: (category: string | null) => string
): string {
  const lines: string[] = [`📅 ${formatMonth(s.month)}のまとめ`]
  lines.push(`使った分の合計: ${yenPlain(s.withdrawTotal)}`)
  if (s.partnerPaidTotal > 0) lines.push(`彼女が払ってくれた分: ${yenPlain(s.partnerPaidTotal)}`)
  if (s.depositTotal > 0) lines.push(`預かった合計: ${yenPlain(s.depositTotal)}`)
  if (s.refundTotal > 0) lines.push(`返した合計: ${yenPlain(s.refundTotal)}`)
  if (s.adjustTotal !== 0) {
    // 符号の意味を数字だけに担わせない(増やしたのか減らしたのかを言葉で書く)
    lines.push(
      s.adjustTotal > 0
        ? `調整で増やした分: ${yenPlain(s.adjustTotal)}`
        : `調整で減らした分: ${yenPlain(-s.adjustTotal)}`
    )
  }
  // 符号だけでは「預かり」か「貸し」か読めないので、機能011 の言い回しを添える
  const w = balanceWording(s.balance)
  lines.push(`いまの残高: ${yenPlain(w.magnitude)}(${w.title})`)
  if (s.categories.length > 0) {
    lines.push('内訳')
    for (const c of s.categories) {
      lines.push(`・${labelOf(c.category)} ${yenPlain(c.amount)}`)
    }
  }
  return lines.join('\n')
}

// ---------- Supabase 連携 ----------

// partner_summary_sends テーブルが無い(マイグレーション未実行)場合。
// **答えは localStorage に残さない**(remember: false)。
// 起動のたびにこのテーブルを確かめる経路は fetchSentMonths しか無く、その
// fetchSentMonths 自体が下の「無いなら送らない」で飛ばされるので、覚えてしまうと
// マイグレーションを実行しても月末サマリーが二度と送られなくなる。
const availability = createTableAvailability('partner_summary_sends', { remember: false })

export function isMonthlySummaryUnavailable(): boolean {
  return availability.isMissing()
}

/** テスト用に、モジュールに残る「テーブルが無い」判定を戻す */
export function resetMonthlySummaryForTest(): void {
  availability.resetForTest()
}

/** 送信済みの月を読み込む。テーブルが無ければ null(= 機能を静かに止める) */
export async function fetchSentMonths(supabase: SupabaseClient): Promise<string[] | null> {
  try {
    const { data, error } = await supabase.from('partner_summary_sends').select('month')
    if (error) {
      availability.noteError(error)
      return null
    }
    availability.markPresent()
    return ((data ?? []) as { month: string }[]).map((r) => r.month)
  } catch {
    return null
  }
}

/**
 * 「この月は自分が送る」と宣言する。
 * (user_id, month) の一意制約により、他の端末が先に取っていれば false になる。
 * ここで true を返した端末だけが Discord に送る = 二重送信しない。
 */
export async function claimSummaryMonth(
  supabase: SupabaseClient,
  month: string
): Promise<boolean> {
  try {
    const { error } = await supabase.from('partner_summary_sends').insert({ month })
    if (error) {
      availability.noteError(error)
      // 23505 = unique_violation(他の端末が先に送った)。それ以外も安全側で送らない
      return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * アプリを開いたときに1回だけ呼ぶ。未送信の月のサマリーを Discord へ送る。
 * 戻り値は送った件数(何もしなければ 0)。例外は投げない。
 */
export async function sendDueMonthlySummaries(
  supabase: SupabaseClient,
  rows: readonly SummaryTxLike[],
  today: string,
  labelOf: (category: string | null) => string
): Promise<number> {
  // Webhook 未設定なら何もしない(印も残さない。あとで設定したときに送れるように)
  if (!getWebhookUrl()) return 0
  // この起動中に「無い」と分かっていれば、もう問い合わせない
  // (判定を次の起動へ持ち越さない理由は上の createTableAvailability のコメント)
  if (availability.isMissing()) return 0
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0

  const sent = await fetchSentMonths(supabase)
  if (sent === null) return 0

  let count = 0
  for (const month of dueSummaryMonths(today, sent)) {
    const summary = buildMonthlySummary(rows, month)
    // 動きが無い月は送るものが無い。印も残さないので、あとから記録を
    // 遡って足したときはまだ送れる(窓から外れるまでの間)
    if (!summary.hasActivity) continue
    // 先に印を取る。取れなければ送らない
    const claimed = await claimSummaryMonth(supabase, month)
    if (!claimed) continue
    // 投げっぱなし。失敗しても他の月の処理は止めない
    void sendDiscordMessage(formatMonthlySummary(summary, labelOf))
    count += 1
  }
  return count
}
