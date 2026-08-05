// ============================================================
// 繰り返し入力の「生成台帳」(印だけ進んで取引が無い状態からの回復)
//
// なぜ必要か
// ----------
// 繰り返し入力は、取引をキューに積む **前に** サーバーの last_generated_date を
// 進める(recurringRules.ts のコメント参照)。これは「重複生成を生成漏れより
// 優先する」という意図的な判断で、**その優先順位はここでも変えない**。
// ただし副作用として、印だけが進んで取引が1件も残らない状態があり得る。
//   - 積んだ op が容量超過などで localStorage に書けなかった
//   - op が隔離箱へ移り、そこで破棄された
//   - キューを消す不具合・別バージョンでの取りこぼし
// この状態は last_generated_date が進んでいる以上、二度と生成されない。
//
// どう直すか
// ----------
// 生成のたびに「どのルールの・どの日の・どの行IDを作ったか」を端末に控えておき、
// 起動時にサーバーの一覧と突き合わせる。控えがあるのに行がどこにも無ければ
// 積み損ねたとみなして、**同じ行ID**でもう一度積む。
//
// 絶対に守ること: **利用者が消した記録を復活させない**
// ----------------------------------------------------
// 「行が無い」には2つの意味がある — 届かなかったのか、届いたあとで消されたのか。
// 見分けるために、控えには confirmed(サーバーに届いたことを確かめた)を持たせる。
//
//   confirmed = false で、キューにも隔離箱にも無い  → 届いていない = 積み損ね → 再生成する
//   confirmed = true だったのに一覧から消えた        → 届いたあとで消えた = 利用者が消した → 二度と作らない
//
// confirmed は「サーバーが insert を受け付けた瞬間」に立てる(取り込み直しを
// 待たない)。待つと、その隙に別の端末で消された記録を「届いていない」と
// 誤認する窓が開くため。
// さらに、利用者が明示的に消したとき(削除・隔離箱からの破棄)は、その場で
// 控えごと忘れる。控えが無ければ回復の対象にならない = 復活し得ない。
//
// 二重生成への最後の砦
// --------------------
// 回復のときは新しい行IDを採らず、**控えに残した行IDをそのまま使う**。
// 万一この判断が間違っても、同じIDの行は主キー制約でデータベースが弾く。
// 「同じ月の家賃が2件できる」ことは、ここの論理が壊れても起こらない。
//
// 判断はすべて純粋関数(reconcileMarks ほか)に閉じ込め、localStorage は
// その外側の薄い層に置く。
// ============================================================

import type { TransactionInput } from '../hooks/useTransactions'

/** 生成した1件の控え */
export interface GeneratedMark {
  /** どのルールが作ったか */
  ruleId: string
  /** 生成対象日 (YYYY-MM-DD) */
  date: string
  /** 作った取引の行ID。回復のときもこのIDをそのまま使う */
  txId: string
  /** 積んだ内容そのもの。ルールが後から編集・削除されても回復できるように控える */
  input: TransactionInput
  /** サーバーが受け付けたことを確かめたか */
  confirmed: boolean
  /** 回復を試みた回数(際限なく積み直さないための上限) */
  recoveries: number
  /** 控えを残した時刻 (ISO8601) */
  recordedAt: string
}

/**
 * 同じ控えを何回まで積み直すか。
 * 1回で足りるのが普通で、2回目以降は「積んでも消える」異常が起きている。
 * 無制限にすると、起動のたびに同じ失敗を繰り返して隔離箱が溢れる。
 */
export const MAX_RECOVERIES = 3

/**
 * 役目を終えた控えを捨てるまでの日数。
 * 生成日からこれだけ経った控えは、確認済み(または諦めたもの)なら捨てる。
 * 短すぎると「長く開いていなかった端末」で回復の機会を失い、
 * 長すぎると localStorage を無駄に食う。
 */
export const KEEP_DAYS = 120

// ---------- 純粋関数(ここに判断を集める) ----------

/** 日付文字列 (YYYY-MM-DD) を n 日戻す。(純粋関数) */
function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const t = new Date(y, m - 1, d + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`
}

/**
 * 控えを1件足す。(純粋関数)
 *
 * 同じルール・同じ日の控えがすでにあれば **足さない**。
 * 印(last_generated_date)が何らかの理由で巻き戻っても、
 * ここで同じ日の生成が二度目にならないようにする。
 */
export function addMark(list: readonly GeneratedMark[], mark: GeneratedMark): GeneratedMark[] {
  if (list.some((m) => m.ruleId === mark.ruleId && m.date === mark.date)) return [...list]
  if (list.some((m) => m.txId === mark.txId)) return [...list]
  return [...list, mark]
}

/** 同じルール・同じ日の控えがあるか。(純粋関数) */
export function hasMark(
  list: readonly GeneratedMark[],
  ruleId: string,
  date: string
): boolean {
  return list.some((m) => m.ruleId === ruleId && m.date === date)
}

/** サーバーが受け付けたことを控えに記す。(純粋関数) */
export function confirmMarks(
  list: readonly GeneratedMark[],
  txIds: readonly string[]
): GeneratedMark[] {
  const ids = new Set(txIds)
  return list.map((m) => (ids.has(m.txId) && !m.confirmed ? { ...m, confirmed: true } : m))
}

/**
 * 控えを忘れる。(純粋関数)
 *
 * 利用者が自分で消したとき(削除・隔離箱からの破棄)に呼ぶ。
 * 控えが無くなれば回復の対象から外れる = 二度と復活しない。
 */
export function forgetMarks(
  list: readonly GeneratedMark[],
  txIds: readonly string[]
): GeneratedMark[] {
  const ids = new Set(txIds)
  return list.filter((m) => !ids.has(m.txId))
}

/** 突き合わせに必要な、いまの状態 */
export interface ReconcileContext {
  /** サーバーから取り込めた行のID。**取り込みに成功したときだけ**渡すこと */
  serverIds: ReadonlySet<string>
  /** まだ送っていないキューにある行のID */
  queuedIds: ReadonlySet<string>
  /** 隔離箱にある行のID */
  quarantinedIds: ReadonlySet<string>
  /** 今日 (YYYY-MM-DD)。古い控えを捨てる判断にだけ使う */
  today: string
  maxRecoveries?: number
  keepDays?: number
}

export interface ReconcileResult {
  /** 書き戻す控えの一覧 */
  marks: GeneratedMark[]
  /** 積み直すべき控え(= 印だけ進んで取引が無いもの) */
  lost: GeneratedMark[]
}

/**
 * 控えと現状を突き合わせ、積み直すべきものを選ぶ。(純粋関数)
 *
 * 判断の順序が意味そのもの:
 *   1. サーバーに在る            → 届いている。confirmed を立てる
 *   2. confirmed だったのに無い  → **利用者が消した**。控えごと忘れる(復活させない)
 *   3. キューに在る              → まだ送っていないだけ。待つ
 *   4. 隔離箱に在る              → 利用者が再送/破棄を決めるまで手を出さない
 *   5. どこにも無い              → 積み損ね。積み直す(上限まで)
 */
export function reconcileMarks(
  list: readonly GeneratedMark[],
  ctx: ReconcileContext
): ReconcileResult {
  const maxRecoveries = ctx.maxRecoveries ?? MAX_RECOVERIES
  const cutoff = shiftDays(ctx.today, -(ctx.keepDays ?? KEEP_DAYS))
  const marks: GeneratedMark[] = []
  const lost: GeneratedMark[] = []

  for (const m of list) {
    if (ctx.serverIds.has(m.txId)) {
      // 1. 届いている。古くなった控えはここで役目を終える
      if (m.date < cutoff) continue
      marks.push(m.confirmed ? m : { ...m, confirmed: true })
      continue
    }
    if (m.confirmed) {
      // 2. 一度は届いたのに一覧から消えている = 利用者(または別の端末)が消した。
      //    ここで積み直すと「消したはずの家賃」が翌朝よみがえる。絶対にしない
      continue
    }
    if (ctx.queuedIds.has(m.txId) || ctx.quarantinedIds.has(m.txId)) {
      // 3/4. まだ行き先が決まっていない。触らずに残す
      marks.push(m)
      continue
    }
    if (m.recoveries < maxRecoveries) {
      // 5. 積み損ね。同じ行IDのまま積み直す
      const next = { ...m, recoveries: m.recoveries + 1 }
      marks.push(next)
      lost.push(next)
      continue
    }
    // 上限まで試して駄目だったもの。古くなったら忘れる(いつまでも抱えない)
    if (m.date >= cutoff) marks.push(m)
  }

  return { marks, lost }
}

/** 壊れた/古い JSON を落として読む。(純粋関数) */
export function parseMarks(raw: unknown): GeneratedMark[] {
  if (!Array.isArray(raw)) return []
  const out: GeneratedMark[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Partial<GeneratedMark>
    if (typeof o.ruleId !== 'string' || typeof o.date !== 'string' || typeof o.txId !== 'string') {
      continue
    }
    // 内容が読めない控えは回復に使えない(積み直す中身が無い)ので落とす
    if (typeof o.input !== 'object' || o.input === null) continue
    out.push({
      ruleId: o.ruleId,
      date: o.date,
      txId: o.txId,
      input: o.input as TransactionInput,
      confirmed: o.confirmed === true,
      recoveries: typeof o.recoveries === 'number' && o.recoveries > 0 ? o.recoveries : 0,
      recordedAt: typeof o.recordedAt === 'string' ? o.recordedAt : '',
    })
  }
  return out
}

// ---------- localStorage(控えの実体) ----------

const LEDGER_KEY = 'kakeibo.recurringLedger'

let cache: GeneratedMark[] | null = null

export function loadMarks(): GeneratedMark[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(LEDGER_KEY)
    cache = raw ? parseMarks(JSON.parse(raw)) : []
  } catch {
    cache = []
  }
  return cache
}

/** 書き戻す。保存できたときだけ true(呼び出し側が生成を諦める判断に使う) */
function saveMarks(list: GeneratedMark[]): boolean {
  try {
    localStorage.setItem(LEDGER_KEY, JSON.stringify(list))
    cache = list
    return true
  } catch {
    // 容量超過など。キャッシュも書き換えない(嘘の状態を作らない)
    return false
  }
}

/**
 * 生成する取引の控えを残す。**取引をキューに積む前に**呼ぶこと。
 * 保存できたときだけ true。
 */
export function recordGeneratedMark(
  mark: { ruleId: string; date: string; txId: string; input: TransactionInput },
  now: Date = new Date()
): boolean {
  return saveMarks(
    addMark(loadMarks(), { ...mark, confirmed: false, recoveries: 0, recordedAt: now.toISOString() })
  )
}

/** すでに控えのある(ルール, 日付)か */
export function hasGeneratedMark(ruleId: string, date: string): boolean {
  return hasMark(loadMarks(), ruleId, date)
}

/** サーバーが受け付けた行を控えに記す(同期成功のたびに呼ぶ) */
export function confirmGeneratedMarks(txIds: readonly string[]): void {
  const list = loadMarks()
  if (!list.some((m) => txIds.includes(m.txId) && !m.confirmed)) return
  saveMarks(confirmMarks(list, txIds))
}

/**
 * 控えを忘れる。**利用者が自分で消したときだけ**呼ぶこと
 * (削除・隔離箱からの破棄)。ここを広げると、消した記録が復活する。
 */
export function forgetGeneratedMarks(txIds: readonly string[]): void {
  const list = loadMarks()
  if (!list.some((m) => txIds.includes(m.txId))) return
  saveMarks(forgetMarks(list, txIds))
}

/**
 * 控えと現状を突き合わせ、積み直すべき控えを返す。
 * 書き戻せなかったときは何も返さない — 回数を数えられないまま積むと、
 * 起動のたびに同じものを積み続けてしまうため。
 */
export function reconcileGeneratedMarks(ctx: ReconcileContext): GeneratedMark[] {
  const list = loadMarks()
  if (list.length === 0) return []
  const { marks, lost } = reconcileMarks(list, ctx)
  if (!saveMarks(marks)) return []
  return lost
}

/** テスト用: 端末の控えを空にする */
export function resetGeneratedMarks(): void {
  cache = null
  try {
    localStorage.removeItem(LEDGER_KEY)
  } catch {
    // 消せなくても実害は無い
  }
}
