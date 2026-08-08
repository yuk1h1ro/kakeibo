// ============================================================
// 旅行1回ぶんのまとめを Discord に送る (組み立てだけの純粋関数)
//
// ---- 何のための機能か ----
// 「今回の旅行で、彼女の負担がいくらだったか」を1通で渡すためのもの。
// 残高の増減はそのつど通知が飛んでいるが、旅行のあいだは通知が細切れに
// 何十通も流れるので、**帰ってから1回ぶんをまとめて**読める形が要る。
//
// ---- 送る範囲は「彼女に関係する分だけ」 ----
// 判定は partnerBacklog.ts の isPartnerVisible をそのまま呼ぶ。共有ページ
// (partner_share_view)・そのつどの通知・履歴のまとめ送信と**一字一句同じ条件**
// (partner_amount > 0 または partner_paid > 0)にそろえるため、条件をここに
// 書き写さない。あなた個人の支出(彼女の負担0の買い物)は1件も出さない。
//
// ---- 土台は作り直さない ----
// 2,000文字での分割(packBlocks)・1通ごとの間隔・途中失敗からの再開は
// 履歴のまとめ送信(partnerBacklog.ts / partnerBacklogSends.ts)にあるものを
// そのまま使う。同じ壊れ方を2箇所で直すことになるのを避けるため。
//
// ---- 残高は必ず partnerBalance.ts を通す ----
// 「この旅行で残高がいくら動いたか」も「いまの残高」も、自前で足し引きしない。
// 画面と Discord で数字がずれるのがいちばん困る。
//
// ---- 金額の表記 ----
// 目隠し (機能169) の対象外。彼女が読む文章なので、こちらの画面が伏字かどうかで
// 中身が変わってはいけない(yenPlain 系だけを使う)。
// ============================================================

import { formatDate, yenPlain } from './format'
import { balanceLine } from './discordNotify'
import { inRange, rangeDays, type DateRange } from './report'
import { partnerBalance, partnerImpact } from './partnerBalance'
import { partnerPaid, tagsOf, type Transaction } from './types'
import {
  DISCORD_MESSAGE_LIMIT,
  backlogTitle,
  formatBacklogDate,
  isPartnerVisible,
  packBlocks,
} from './partnerBacklog'

/** 明細1件(彼女に見せるぶん) */
export interface TripEntry {
  id: string
  date: string
  /** 見出し(お店 → メモ → カテゴリ名。履歴のまとめ送信と同じ付け方) */
  title: string
  /** 彼女の負担分 */
  share: number
  /** 彼女が実際に払った額 (機能018)。0 なら自分が全額払った回 */
  paid: number
  /** 預かり残高への影響額(partnerBalance.ts の partnerImpact) */
  impact: number
  category: string | null
}

export interface TripCategoryItem {
  label: string
  /** 彼女の負担額の合計 */
  total: number
  count: number
}

export interface TripSummary {
  /** この旅行を指すタグ(親 → 行き先の順) */
  tags: string[]
  range: DateRange
  /** range の日数(両端を含む) */
  days: number
  /** 彼女に関係する明細(日付順) */
  entries: TripEntry[]
  /** 彼女の負担の合計 */
  shareTotal: number
  /** この旅行で預かり残高が動いた合計(partnerBalance を通す) */
  balanceImpact: number
  /** カテゴリ内訳(彼女の負担額。多い順) */
  categories: TripCategoryItem[]
  /** 送らなかった支出の件数(自分だけの支出)。画面で断るために持つ */
  skippedCount: number
}

/**
 * 旅行1回ぶんのまとめを組み立てる。(純粋関数)
 *
 * 対象は「タグが**すべて**付いた・期間内の・支出」。預かり/返金/調整を
 * 入れないのは、旅行のタグが付くのは支出だけだから(残高の付け替えに
 * 旅行かどうかの意味は無い)。それらは履歴のまとめ送信の担当。
 */
export function buildTripSummary(
  txs: readonly Transaction[],
  opts: {
    tags: readonly string[]
    range: DateRange
    labelOf: (category: string | null) => string
  }
): TripSummary {
  const tags = [...opts.tags]
  const inTrip = txs.filter(
    (t) =>
      t.type === 'expense' &&
      inRange(t.date, opts.range) &&
      tags.every((tag) => tagsOf(t).includes(tag))
  )
  // 並びは日付 → 記録日時 → ID。履歴のまとめ送信(compareCursor)と同じ順で、
  // 同じ日の複数件でも必ず同じ並びになる
  const visible = inTrip
    .filter((t) => isPartnerVisible(t))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id)
    )

  const entries: TripEntry[] = visible.map((t) => ({
    id: t.id,
    date: t.date,
    title: backlogTitle(t, opts.labelOf),
    share: t.partner_amount,
    paid: partnerPaid(t),
    impact: partnerImpact(t),
    category: t.category,
  }))

  const acc = new Map<string, TripCategoryItem>()
  for (const t of visible) {
    const label = opts.labelOf(t.category)
    const item = acc.get(label) ?? { label, total: 0, count: 0 }
    item.total += t.partner_amount
    item.count += 1
    acc.set(label, item)
  }

  return {
    tags,
    range: opts.range,
    days: rangeDays(opts.range),
    entries,
    // 負担額の合計は残高ではないのでそのまま足す(残高だけが partnerBalance の担当)
    shareTotal: entries.reduce((s, e) => s + e.share, 0),
    // 「この旅行で残高がどれだけ動いたか」は残高の計算なので、必ず純関数を通す
    balanceImpact: partnerBalance(visible),
    categories: [...acc.values()].sort(
      (a, b) => b.total - a.total || b.count - a.count || (a.label < b.label ? -1 : 1)
    ),
    skippedCount: inTrip.length - visible.length,
  }
}

// ---------- 本文の整形 ----------

/** 見出しの区切り(履歴のまとめ送信と同じ罫線) */
const RULE = '────────'

/** 明細1行。(純粋関数) */
export function tripEntryLine(e: TripEntry): string {
  const head = `${formatDate(e.date)} ${e.title} ${yenPlain(e.share)}`
  // 機能018: 彼女が払った回は、いくら出していくらが自分の分だったかを添える
  if (e.paid > 0) return `${head}(あなたが ${yenPlain(e.paid)} 払いました)`
  return head
}

/**
 * 1通目の見出し。(純粋関数)
 * 「いつの・何のまとめで、何件・いくらか」を先に置く。明細だけ流すと、
 * 彼女は何を読まされているのか分からない。
 */
export function tripHeaderLines(s: TripSummary): string[] {
  const period =
    s.range.start === s.range.end
      ? formatBacklogDate(s.range.start)
      : `${formatBacklogDate(s.range.start)} 〜 ${formatBacklogDate(s.range.end)}(${s.days}日間)`
  return [
    `期間: ${period}`,
    `タグ: ${s.tags.map((t) => `#${t}`).join(' ')}`,
    `あなたに関係する記録: ${s.entries.length}件`,
    `あなたの負担の合計: ${yenPlain(s.shareTotal)}`,
    // 出していないものを、出していないと書く。共有ページと同じ範囲であることの説明
    '私だけの支出(あなたの負担が0のもの)は入っていません',
    RULE,
  ]
}

/** カテゴリ内訳のブロック。(純粋関数。1件も無ければ空) */
export function tripCategoryLines(s: TripSummary): string[] {
  if (s.categories.length === 0) return []
  return [
    RULE,
    'カテゴリ内訳(あなたの負担)',
    ...s.categories.map((c) => `${c.label} ${yenPlain(c.total)}(${c.count}件)`),
  ]
}

/**
 * 締め。(純粋関数)
 * 旅行のあいだに残高がどちらへ動いたかと、**いまの残高**を書く。
 * 言い回しは、そのつど飛んでいる通知と同じ (discordNotify.ts の balanceLine)。
 */
export function tripFooterLines(s: TripSummary, currentBalance: number): string[] {
  const impact = s.balanceImpact
  const move =
    impact > 0
      ? `この旅行で、あずかっているお金は ${yenPlain(impact)} 増えました(あなたが多く払ってくれた分です)`
      : impact < 0
        ? `この旅行で、あずかっているお金から ${yenPlain(-impact)} を使いました`
        : 'この旅行で、あずかっているお金は動いていません'
  return [RULE, move, `いまの${balanceLine(currentBalance)}`]
}

/**
 * 各メッセージの先頭に付ける1行。(純粋関数)
 *
 * 送り直しのときは **必ずその印を付ける**。同じ旅行が2度届いたときに、
 * 彼女が「2回ぶんの支出があった」と読んでしまうのを防ぐため
 * (二度送ることそのものは禁じない — 直してから送り直したい場面がある)。
 */
export function tripHeadline(
  s: TripSummary,
  index: number,
  total: number,
  resend: boolean
): string {
  // 見出しに出すのは、いちばん内側のタグ(= 行き先)。無ければ親タグ
  const name = s.tags.length > 0 ? `#${s.tags[s.tags.length - 1]}` : '旅行'
  const head = `🧳 ${name} のまとめ${resend ? '(送り直し)' : ''}`
  return total > 1 ? `${head}(${index}/${total})` : head
}

export interface TripMessage {
  /** 実際に Discord へ送る文字列(見出しの行を含む) */
  text: string
}

export interface TripPlanInput {
  summary: TripSummary
  /** 全期間を積んだ、いまの残高(partnerBalance で出したもの) */
  currentBalance: number
  /** 2回目以降の送信か */
  resend?: boolean
  limit?: number
}

/**
 * 送る内容を組み立てる。(純粋関数)
 *
 * 0件なら**1通も作らない**。「この旅行に、あなたに関係する記録はありません」
 * とだけ書かれた通知は、彼女にとって受け取る意味が無い(押させないのは画面の責任)。
 *
 * 分割は履歴のまとめ送信と同じ packBlocks に任せる。見出しの「(2/3)」は
 * 分割してみるまで総数が決まらないので、総数が増えなくなるまで詰め直してから
 * 番号を振る(余白は多めに取る = 上限を超えない側にだけ倒す)。
 */
export function buildTripMessages(input: TripPlanInput): TripMessage[] {
  const { summary, currentBalance } = input
  const limit = input.limit ?? DISCORD_MESSAGE_LIMIT
  const resend = input.resend ?? false
  if (summary.entries.length === 0) return []

  const blocks = [
    tripHeaderLines(summary).join('\n'),
    ...summary.entries.map(tripEntryLine),
    ...(tripCategoryLines(summary).length > 0 ? [tripCategoryLines(summary).join('\n')] : []),
    tripFooterLines(summary, currentBalance).join('\n'),
  ]

  const reserveFor = (total: number) => tripHeadline(summary, total, total, resend).length + 1

  let estimate = 1
  let packed = packBlocks(blocks, limit - reserveFor(estimate))
  for (let round = 0; round < 5 && packed.length > estimate; round++) {
    estimate = packed.length
    packed = packBlocks(blocks, limit - reserveFor(estimate))
  }

  const total = packed.length
  return packed.map((m, i) => ({
    text: `${tripHeadline(summary, i + 1, total, resend)}\n${m.text}`,
  }))
}

/** いまの残高。(残高の計算は必ず partnerBalance.ts を通す) */
export function tripCurrentBalance(txs: readonly Transaction[]): number {
  return partnerBalance(txs)
}
