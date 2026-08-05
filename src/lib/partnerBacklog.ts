// ============================================================
// 預かり金の履歴を、まとめて Discord に送る (機能009 の穴埋め)
//
// ---- なぜこの機能が要るのか ----
// このアプリは預かり残高が動くたびに Discord へ通知する。ところが Webhook URL は
// 長いあいだ「設定した端末の localStorage」にしか無く、いちばん入力に使っている
// スマホからの記録は1通も通知されていなかった(端末間の同期は直前の変更で入った)。
// つまり彼女は、過去の増減をほとんど知らない。ここを追いつかせるのがこの機能。
//
// ---- このファイルの責任 ----
// **文字列を組み立てるところまでの純粋関数だけ**を置く。
//   ・彼女に見せてよい行の選別   (共有ページと同じ原則)
//   ・その時点の残高の積み上げ   (計算は partnerBalance.ts に一本化)
//   ・2,000文字での分割          (Discord の上限。ここが壊れると送信が丸ごと失敗する)
//   ・どこから送るかの算出       (前回送った続き = カーソル)
// Supabase への読み書きと実際の送信は partnerBacklogSends.ts、画面は
// PartnerBacklogSheet.tsx が持つ。テストできる部分をすべてこちらに寄せている。
//
// ---- 金額の表記 ----
// 目隠し (機能169) の対象外。彼女が読む文章なので、こちらの画面が伏字かどうかで
// 中身が変わってはいけない。format.ts の yenPlain 系だけを使う。
// ============================================================

import { formatDate, yenPlain } from './format'
import { balanceLine } from './discordNotify'
import {
  balanceWording,
  ledgerRowTitle,
  partnerBalance,
  partnerImpact,
  type PartnerTxLike,
} from './partnerBalance'
import { partnerPaid } from './types'

/** Discord の1メッセージの上限。超えると送信そのものが 400 で弾かれる */
export const DISCORD_MESSAGE_LIMIT = 2000

/** 本文を組み立てるのに必要な最小の形(Transaction を構造的に受ける) */
export interface BacklogTxLike extends PartnerTxLike {
  id: string
  date: string
  created_at: string
  category: string | null
  memo: string
  store: string
}

// ---------- 彼女に見せる範囲 ----------

/**
 * その記録を彼女に見せてよいか。(純粋関数)
 *
 * 共有ページ (partner_share_view / shareCharges.ts) と**同じ原則**にそろえる:
 *   ・彼女の負担がある支出と、彼女自身が払った回だけ
 *   ・利用者個人の支出は1件も出さない
 *   ・預かり・返金・調整は、残高を動かしたものだけ
 * ここを緩めると、彼女が見る画面と Discord で見えるものが食い違う。
 *
 * 支出の条件を `partnerImpact !== 0` にしていないのは、彼女が自分の負担分を
 * ちょうど払った回(影響額 0)も彼女には関係のある出来事だから。
 * 共有ページの条件 (partner_amount > 0 or partner_paid > 0) と一字一句そろえてある。
 */
export function isPartnerVisible(t: BacklogTxLike): boolean {
  if (t.type === 'expense') return t.partner_amount > 0 || partnerPaid(t) > 0
  // 預かり・返金・調整。金額 0 の行(意味を持たない)だけを落とす
  return partnerImpact(t) !== 0
}

// ---------- 並び順とカーソル ----------

/**
 * 前回どこまで送ったかの目印。(取引1件を一意に指す)
 * 日付だけでは同じ日の複数件を区切れないので、並び順と同じ3つ組で持つ。
 */
export interface BacklogCursor {
  date: string
  createdAt: string
  id: string
}

export function cursorOf(t: BacklogTxLike): BacklogCursor {
  return { date: t.date, createdAt: t.created_at, id: t.id }
}

/** 組み立て済みの明細からカーソルを作る。(純粋関数) */
export function entryCursor(e: BacklogEntry): BacklogCursor {
  return { date: e.date, createdAt: e.createdAt, id: e.id }
}

/**
 * 送信順(古い順)の比較。(純粋関数)
 * 日付 → 記録日時 → ID の順。ID まで見るのは、同じ日付・同じ記録日時の行でも
 * 必ず同じ順番に並べるため(順番が揺れるとカーソルの意味が壊れる)。
 * 日付も記録日時も文字列の辞書順で時系列になる形式なので、そのまま比べられる。
 */
export function compareCursor(a: BacklogCursor, b: BacklogCursor): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return 0
}

/** カーソルより後ろ(まだ送っていない)か。(純粋関数) */
export function isAfterCursor(t: BacklogTxLike, cursor: BacklogCursor | null): boolean {
  if (!cursor) return true
  return compareCursor(cursorOf(t), cursor) > 0
}

/**
 * 2つのカーソルのうち「より先まで進んでいる方」を返す。(純粋関数)
 *
 * カーソルは**戻ってはいけない**。戻ると、すでに彼女に送った分をもう一度送ることになる。
 * サーバーの値と端末のキャッシュが食い違ったときは、必ず進んでいる側を採る。
 */
export function newerCursor(
  a: BacklogCursor | null,
  b: BacklogCursor | null
): BacklogCursor | null {
  if (!a) return b
  if (!b) return a
  return compareCursor(a, b) >= 0 ? a : b
}

// ---------- 明細の組み立て ----------

export interface BacklogEntry {
  id: string
  date: string
  createdAt: string
  /** 見出し(お店 → メモ → カテゴリ名 / 預かり・返金・調整の言い回し) */
  title: string
  /** 残高への影響額(符号つき) */
  impact: number
  /** この記録を反映した**直後**の残高 */
  balance: number
  /** 彼女が実際に払った額 (機能018)。0 なら自分が全額払った回 */
  paid: number
  /** 彼女の負担分 */
  share: number
}

/** 見出しの長さの上限。お店やメモは自由入力なので、1行が暴れないように詰める */
export const TITLE_MAX = 40

/** 長すぎる見出しを詰める。(純粋関数) */
export function truncateTitle(text: string): string {
  const chars = [...text]
  return chars.length <= TITLE_MAX ? text : `${chars.slice(0, TITLE_MAX - 1).join('')}…`
}

/**
 * 1件の見出し。(純粋関数)
 *
 * 支出の優先順位 (お店 → メモ → カテゴリ名) は、そのつど飛んでいる通知
 * (discordNotify.ts の buildPartnerOpMessage) とわざと同じにしてある。
 * この機能は「届かなかった通知を後から届ける」ものなので、同じ出来事が
 * 同じ言葉で出るのがいちばん読みやすい。
 * 預かり・返金・調整は、理由(メモ)も残高が動いた理由として添える
 * (共有ページでも返金・調整の理由だけは彼女に出している)。
 */
export function backlogTitle(t: BacklogTxLike, labelOf: (category: string | null) => string): string {
  if (t.type === 'expense') {
    return truncateTitle(t.store || t.memo || labelOf(t.category))
  }
  const head = ledgerRowTitle(t)
  return truncateTitle(t.memo ? `${head}(${t.memo})` : head)
}

/**
 * 全期間の記録から、彼女に見せる明細を古い順に組み立てる。(純粋関数)
 *
 * 残高は**渡された行すべて**を古い順に積んで出す。期間で絞ったあとに積むと、
 * 「5月だけ送る」ときの残高が 0 から始まって画面と食い違う。
 * 積み方は partnerBalance.ts の partnerImpact をそのまま足すだけ —
 * ここで独自の式を書くと、画面と Discord で数字がずれる。
 * (彼女に見せない行 = 自分だけの支出は影響額が必ず 0 なので、
 *  見せないことと残高が合うことは両立する)
 */
export function buildBacklogEntries(
  rows: readonly BacklogTxLike[],
  labelOf: (category: string | null) => string
): BacklogEntry[] {
  const sorted = [...rows].sort((a, b) => compareCursor(cursorOf(a), cursorOf(b)))
  const out: BacklogEntry[] = []
  let balance = 0
  for (const t of sorted) {
    balance += partnerImpact(t)
    if (!isPartnerVisible(t)) continue
    out.push({
      id: t.id,
      date: t.date,
      createdAt: t.created_at,
      title: backlogTitle(t, labelOf),
      impact: partnerImpact(t),
      balance,
      paid: partnerPaid(t),
      share: t.partner_amount,
    })
  }
  return out
}

// ---------- 期間 ----------

/**
 * 送る範囲。
 * 'since' = 前回送った続き(既定)。それ以外は「もう一度送り直したい」ときの逃げ道で、
 * 送った印があっても構わず全部を組み立て直す。
 */
export type BacklogRange =
  | { kind: 'since' }
  | { kind: 'all' }
  | { kind: 'year'; value: string }
  | { kind: 'month'; value: string }

/** 期間で絞る。(純粋関数。日付は 'YYYY-MM-DD' なので前方一致で足りる) */
export function filterBacklogEntries(
  entries: readonly BacklogEntry[],
  range: BacklogRange,
  cursor: BacklogCursor | null
): BacklogEntry[] {
  switch (range.kind) {
    case 'all':
      return [...entries]
    case 'since':
      if (!cursor) return [...entries]
      return entries.filter((e) => compareCursor(e, cursor) > 0)
    case 'year':
    case 'month':
      return entries.filter((e) => e.date.startsWith(range.value))
  }
}

/** 画面と本文に出す期間の名前。(純粋関数) */
export function describeBacklogRange(range: BacklogRange, cursor: BacklogCursor | null): string {
  switch (range.kind) {
    case 'all':
      return '全期間'
    case 'since':
      // まだ一度も送っていないときは、続きも何も無いので中身は全期間そのもの。
      // 「まだ送っていない」ことは画面の別の行で伝える(名前を二重に説明しない)
      return cursor ? '前回の続き' : '全期間'
    case 'year':
      return `${Number(range.value)}年`
    case 'month': {
      const [y, m] = range.value.split('-')
      return `${Number(y)}年${Number(m)}月`
    }
  }
}

/** 同じ期間を指しているか。(純粋関数。選択中の見た目に使う) */
export function isSameBacklogRange(a: BacklogRange, b: BacklogRange): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'year' || a.kind === 'month') {
    return a.value === (b as { value: string }).value
  }
  return true
}

/** 選べる年。(純粋関数。新しい順。記録のある年だけ) */
export function backlogYears(entries: readonly BacklogEntry[]): string[] {
  const years = new Set<string>()
  for (const e of entries) years.add(e.date.slice(0, 4))
  return [...years].sort((a, b) => b.localeCompare(a))
}

/** 選べる月。(純粋関数。新しい順。記録のある月だけ) */
export function backlogMonths(entries: readonly BacklogEntry[]): string[] {
  const months = new Set<string>()
  for (const e of entries) months.add(e.date.slice(0, 7))
  return [...months].sort((a, b) => b.localeCompare(a))
}

// ---------- 本文の整形 ----------

/** 影響額の符号付き表記。(純粋関数。負号は見やすい U+2212 — 既存の通知と同じ) */
export function signedImpactText(impact: number): string {
  if (impact > 0) return `+${yenPlain(impact)}`
  if (impact < 0) return `−${yenPlain(-impact)}`
  // ちょうど相殺した回。「±¥0」と書く。空欄にすると動いたのか読めない
  return `±${yenPlain(0)}`
}

/**
 * その時点の残高の短い言い方。(純粋関数)
 * 1行ごとに「(預かり中)」まで書くと長すぎるので、向きだけを言葉にする。
 * 言葉の意味は1通目の見出しで説明する。
 */
export function runningBalanceText(balance: number): string {
  return balance < 0 ? `立て替え ${yenPlain(-balance)}` : `残り ${yenPlain(balance)}`
}

/** 明細1行。(純粋関数) */
export function backlogEntryLine(e: BacklogEntry): string {
  const head = `${formatDate(e.date)} ${e.title} ${signedImpactText(e.impact)} → ${runningBalanceText(e.balance)}`
  // 機能018: 彼女が払った回は、内訳を書かないと符号の意味が読めない
  if (e.paid > 0) return `${head}(彼女が ${yenPlain(e.paid)} 払い、負担 ${yenPlain(e.share)})`
  return head
}

/** 見出しの区切り。長すぎない罫線1本 */
const RULE = '────────'

/**
 * 見出しに出す日付。(純粋関数)
 * 明細の1行は `5月1日(金)` で足りるが、見出しは何年ぶんを送っているのかを
 * 決められないと困るので、ここだけ年を付ける。
 */
export function formatBacklogDate(iso: string): string {
  return `${iso.slice(0, 4)}年${formatDate(iso)}`
}

/**
 * 1通目の見出し。(純粋関数)
 * 「いつからいつまでの何件で、始まりの残高がいくらだったか」を先に置く。
 * 明細だけ流すと、彼女は自分がどこから読まされているのか分からない。
 *
 * 期間は**日付そのもの**で書く。こちら側の呼び方(「前回の続き」など)は
 * 彼女には意味が無く、いつからいつまでかだけが必要なため。
 */
export function backlogHeaderLines(entries: readonly BacklogEntry[]): string[] {
  const first = entries[0]
  const last = entries[entries.length - 1]
  // 最初の1件を反映する**前**の残高 = 始まりの残高
  const startBalance = first.balance - first.impact
  const w = balanceWording(startBalance)
  return [
    `期間: ${formatBacklogDate(first.date)} 〜 ${formatBacklogDate(last.date)}・${entries.length}件`,
    `はじめの残高: ${yenPlain(w.magnitude)}(${w.title})`,
    '「残り」はあずかっているお金、「立て替え」は使い切って私が払っている分です',
    RULE,
  ]
}

/**
 * 最後の締め。(純粋関数)
 * 期間を区切って送ったときは、その期間の終わりの残高と**いまの残高**が違う。
 * 違うときだけ2行にして、彼女が最新の残高を読み違えないようにする。
 */
export function backlogFooterLines(rangeEndBalance: number, currentBalance: number): string[] {
  const lines = [RULE]
  if (rangeEndBalance !== currentBalance) {
    const w = balanceWording(rangeEndBalance)
    lines.push(`この期間のあとの残高: ${yenPlain(w.magnitude)}(${w.title})`)
  }
  // 言い回しは、そのつど飛んでいる通知と同じ (discordNotify.ts の balanceLine)
  lines.push(`いまの${balanceLine(currentBalance)}`)
  return lines
}

/** 各メッセージの先頭に付ける1行。(純粋関数。分割したときだけ番号を出す) */
export function backlogHeadline(index: number, total: number): string {
  const head = '📖 これまでの預かり金の記録'
  return total > 1 ? `${head}(${index}/${total})` : head
}

// ---------- 2,000文字での分割 ----------

/**
 * 1通に収まりきらないブロックを、文字数で切り分ける。(純粋関数)
 *
 * 自由入力(お店・メモ)が異常に長いときの保険。切り捨てずに必ず全部送る。
 * サロゲートペア(絵文字など)の途中で切ると文字が壊れるので、
 * コードポイント単位で数えながら詰める。長さの物差しは UTF-16 の length で、
 * これは Discord の数え方より必ず多めに出る = 上限を超えない側に倒れる。
 */
export function splitLongBlock(block: string, limit: number): string[] {
  if (limit <= 0) return [block]
  if (block.length <= limit) return [block]
  const out: string[] = []
  let buf = ''
  for (const ch of block) {
    if (buf.length + ch.length > limit) {
      out.push(buf)
      buf = ''
    }
    buf += ch
  }
  if (buf !== '') out.push(buf)
  return out
}

export interface PackedMessage {
  /** 本文(見出しの行はまだ付いていない) */
  text: string
  /**
   * この通で**最後まで**入り切ったブロックのうち、いちばん後ろの添字。
   * 途中で切れたブロックしか入っていなければ null。
   * 「どこまで送れたか」をこの値だけで決められるようにするためのもの。
   */
  lastCompleteBlock: number | null
}

/**
 * ブロック(1件=1ブロック)を、1通あたり limit 文字に収まるよう順に詰める。(純粋関数)
 *
 * ここがこのファイルの心臓部。1通でも上限を超えると Discord に丸ごと拒否され、
 * 「送ったのに届いていない」という、この機能でいちばん困る壊れ方をする。
 * 順番は絶対に入れ替えない(残高が積み上がる順に読めなくなるため)。
 */
export function packBlocks(blocks: readonly string[], limit: number): PackedMessage[] {
  const out: PackedMessage[] = []
  let buf = ''
  let lastComplete: number | null = null

  const flush = () => {
    if (buf === '') return
    out.push({ text: buf, lastCompleteBlock: lastComplete })
    buf = ''
    lastComplete = null
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block === '') continue
    // 1つで上限を超えるブロックは、単独にしてから切り分ける
    if (block.length > limit) {
      flush()
      const pieces = splitLongBlock(block, limit)
      pieces.forEach((piece, k) => {
        // 最後の断片が入った通だけが「このブロックを送り終えた通」
        out.push({ text: piece, lastCompleteBlock: k === pieces.length - 1 ? i : null })
      })
      continue
    }
    // 改行1文字ぶんも数に入れる(ここを忘れると境界ちょうどで1文字あふれる)
    const need = buf === '' ? block.length : buf.length + 1 + block.length
    if (need > limit) flush()
    buf = buf === '' ? block : `${buf}\n${block}`
    lastComplete = i
  }
  flush()
  return out
}

// ---------- 送る中身(1回ぶん) ----------

export interface BacklogMessage {
  /** 実際に Discord へ送る文字列(見出しの行を含む) */
  text: string
  /** この通を送り終えた時点で「ここまで送った」と言える明細。無ければ null */
  lastEntry: BacklogEntry | null
  /** 同じ時点で、送信済みと言える明細の**累計**件数 */
  entriesThrough: number
}

export interface BacklogPlanInput {
  entries: readonly BacklogEntry[]
  /** 全期間を積んだ、いまの残高 */
  currentBalance: number
  limit?: number
}

/**
 * 送る内容を1回ぶん組み立てる。(純粋関数)
 *
 * 0件なら**1通も作らない**。「記録がありません」とだけ書かれた通知は、
 * 彼女にとって受け取る意味が無いため(押させないのは画面側の責任)。
 *
 * 見出しの「(2/5)」は、分割してみるまで総数が決まらない。そこで
 * 「総数の見積り → 詰め直し」を、総数が増えなくなるまで繰り返してから
 * 実際の通数で番号を振る。見積りが実際より大きい場合でも、余白を多めに
 * 取っただけなので**上限を超えることはない**(ここは超えない側にだけ倒す)。
 */
export function buildBacklogMessages(input: BacklogPlanInput): BacklogMessage[] {
  const { entries, currentBalance } = input
  const limit = input.limit ?? DISCORD_MESSAGE_LIMIT
  if (entries.length === 0) return []

  const header = backlogHeaderLines(entries).join('\n')
  const entryBlocks = entries.map(backlogEntryLine)
  const footer = backlogFooterLines(entries[entries.length - 1].balance, currentBalance).join('\n')
  const blocks = [header, ...entryBlocks, footer]

  // 見出し1行ぶんの余白。番号の桁が増えると1〜2文字伸びるので、見積りから作る
  const reserveFor = (total: number) => backlogHeadline(total, total).length + 1

  let estimate = 1
  let packed = packBlocks(blocks, limit - reserveFor(estimate))
  for (let round = 0; round < 5 && packed.length > estimate; round++) {
    estimate = packed.length
    packed = packBlocks(blocks, limit - reserveFor(estimate))
  }

  const total = packed.length
  // 途中で失敗しても「ここまでは届いた」と言えるように、通ごとの到達点を持たせる。
  // ブロックの添字 0 は見出し、末尾は締め。あいだが明細1件ずつ
  let reached = 0
  return packed.map((m, i) => {
    reached = Math.max(reached, entriesThroughBlock(entries.length, m.lastCompleteBlock))
    return {
      text: `${backlogHeadline(i + 1, total)}\n${m.text}`,
      lastEntry: reached > 0 ? entries[reached - 1] : null,
      entriesThrough: reached,
    }
  })
}

/** ブロックの添字から「送り終えた明細の累計件数」を出す。(純粋関数) */
function entriesThroughBlock(entryCount: number, block: number | null): number {
  if (block === null) return 0
  // 見出し(0)しか入っていない通は、まだ1件も送り終えていない
  if (block <= 0) return 0
  // 締めのブロックまで入った通は、最後の明細まで送り終えている
  return Math.min(block, entryCount)
}

// ---------- レート制限への備え ----------

/**
 * 1通ごとに空ける間隔(ミリ秒)。
 *
 * Discord の Webhook は、1つの Webhook あたり **2秒間に5回** を超えると 429 を返す。
 * 1.2秒あけると 2秒あたり約1.7回で、上限の3分の1ほどに収まる。
 * 100件(およそ3通)で4秒弱、極端に長い履歴でも「送信中」の表示を出していれば
 * 待てる範囲に収まる。速く送ることより、1通も落とさないことを優先している。
 */
export const BACKLOG_SEND_INTERVAL_MS = 1200

/** 429 や 5xx を受けたときに待ち直す時間(ミリ秒) */
export const BACKLOG_RETRY_DELAY_MS = 5000

/**
 * 失敗したとき、同じ通をもう一度試すなら何ミリ秒待つか。(純粋関数)
 * null は「待っても直らない / ここで止める」。
 *
 *   http (429・5xx) … 混雑や一時的な不調。1回だけ長めに待って試し直す
 *   webhook (401/403/404) … URL が無効。待っても直らないので即やめる
 *   network … この端末が通信できていない。連打しても同じなので止めて、
 *             残りは「前回の続き」から送り直してもらう
 */
export function backlogRetryDelay(
  failure: { kind: 'network' | 'webhook' | 'http' },
  attempt: number
): number | null {
  if (failure.kind === 'http' && attempt === 1) return BACKLOG_RETRY_DELAY_MS
  return null
}

// ---------- 画面に出す言葉 ----------

/** 送信中の進み具合。(純粋関数) */
export function backlogProgressText(sent: number, total: number): string {
  return `送信中… ${sent}/${total}通`
}

/** 送り終えたときの言葉。(純粋関数) */
export function backlogDoneText(entries: number, messages: number): string {
  return `${entries}件を${messages}通に分けて送りました`
}

/**
 * 途中で失敗したときの言葉。(純粋関数)
 * **どこまで届いたか**を必ず先に書く。「失敗しました」だけだと、
 * 彼女の画面に何が届いているのか分からず、もう一度全部送りたくなる。
 */
export function backlogPartialText(
  sentMessages: number,
  totalMessages: number,
  sentEntries: number
): string {
  if (sentMessages === 0) {
    return `1通も送れませんでした(全${totalMessages}通)。まだ何も届いていません`
  }
  return (
    `${totalMessages}通のうち${sentMessages}通目まで(${sentEntries}件)が届きました。` +
    '残りは「前回の続き」を選んで送り直せます(届いた分は二度送りません)'
  )
}

/** いまの残高を全期間から出す。(残高の計算は必ず partnerBalance.ts を通す) */
export function backlogCurrentBalance(rows: readonly BacklogTxLike[]): number {
  return partnerBalance(rows)
}
