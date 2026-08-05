// ============================================================
// 同期できなかった記録の隔離箱
//
// 以前は、サーバーに「永続的に拒否された」と判断した書き込み操作(op)を
// キューから **黙って捨てて** いた。分割した会計は N 件の独立した insert なので、
// 途中の1件が拒否されると 3,000円の会計が 2,000円になり、しかも画面には
// 何も残らない(再読み込みで痕跡ゼロ)という壊れ方をしていた。
//
// このファイルの役目はただ1つ、**記録を1件も失わないこと**。
//   - 送れなかった op は捨てずに、この隔離箱(localStorage)へ移す
//   - 利用者が「破棄する」を押すまで、隔離箱の中身は絶対に消えない
//     (件数の上限も付けない。古い順に溢れさせたら、それは捨てているのと同じ)
//   - 分割 (split_group) は会計まるごと隔離する。1件でも落ちたら
//     「半分だけ保存された会計」を残さない
//
// キューを止めないための回数管理もここに置く。同じ op が何度断られたかを
// 端末に覚えておき、限度を超えたら隔離して先へ進む — 1件の異常が
// 後ろの記録すべてを永久に止めてしまうのを防ぐため。
// ============================================================

import { useSyncExternalStore } from 'react'
import type { PendingOp } from './offlineQueue'
import type { Guidance } from './errorGuidance'

/** なぜ隔離したか */
export type QuarantineReason =
  /** サーバーが受け付けない内容だった(制約違反など)。送り直しても同じ */
  | 'rejected'
  /** 同じ op が何度も断られ、後ろの記録を止めていた */
  | 'repeated'

export interface QuarantineEntry {
  /** 隔離した束のID */
  id: string
  /** 隔離した時刻 (ISO8601) */
  quarantinedAt: string
  reason: QuarantineReason
  /** サーバーが返した原文。原因を追うときの唯一の手がかりなので必ず残す */
  detail: string | null
  /** 隔離した書き込み操作。そのままキューへ戻せる形で持つ */
  ops: PendingOp[]
}

/**
 * 同じ op を何回まで送り直すか。
 * 少なすぎると、マイグレーションを実行すれば通る失敗まですぐ隔離してしまう。
 * 多すぎると、その間ずっと後ろの記録が送れない。
 */
export const SYNC_ATTEMPT_LIMIT = 5

// ---------- 純粋関数(ここに判断を集める) ----------

/** op が属する分割の束ID。分割でなければ null。(純粋関数) */
export function splitGroupOf(op: PendingOp): string | null {
  const g = op.payload?.split_group
  return typeof g === 'string' && g !== '' ? g : null
}

/**
 * 隔離の対象になる op を、キューから取り出す。(純粋関数)
 *
 * 分割した会計は「1行 = 1カテゴリ」の独立した op なので、1件だけ隔離すると
 * 残りが送られて **金額の一部だけがサーバーに残る**。会計まるごと隔離する。
 */
export function opsToQuarantine(queue: readonly PendingOp[], op: PendingOp): PendingOp[] {
  const group = splitGroupOf(op)
  if (group === null) return [op]
  const inGroup = queue.filter((o) => splitGroupOf(o) === group)
  // op 自身がキューに無い(すでに外したあと)ときも取りこぼさない
  return inGroup.some((o) => o.opId === op.opId) ? inGroup : [op, ...inGroup]
}

/**
 * すでにサーバーに入ってしまった「同じ会計の片割れ」を探す。(純粋関数)
 *
 * 分割の一部が先に成功したあとで残りが拒否されると、サーバーには
 * 中途半端な会計だけが残る。これを取り消して隔離箱へ入れるための一覧。
 * 隔離する op が指している行(まだ送れていない行)は当然除く。
 */
export function persistedSplitSiblings<T extends { id: string; split_group?: string | null }>(
  rows: readonly T[],
  group: string | null,
  quarantinedOps: readonly PendingOp[]
): T[] {
  if (group === null) return []
  const queuedIds = new Set(quarantinedOps.map((o) => o.id))
  return rows.filter((r) => r.split_group === group && !queuedIds.has(r.id))
}

/** 新しい隔離を先頭に積む。(純粋関数。上限は設けない = 勝手に捨てない) */
export function addEntry(
  list: readonly QuarantineEntry[],
  entry: QuarantineEntry
): QuarantineEntry[] {
  return [entry, ...list.filter((e) => e.id !== entry.id)]
}

/** 隔離を1件外す。(純粋関数。利用者が「破棄」または「再送」したときだけ呼ぶ) */
export function removeEntry(list: readonly QuarantineEntry[], id: string): QuarantineEntry[] {
  return list.filter((e) => e.id !== id)
}

/** 壊れた/古い JSON を落として読む。(純粋関数) */
export function parseEntries(raw: unknown): QuarantineEntry[] {
  if (!Array.isArray(raw)) return []
  const out: QuarantineEntry[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const o = item as Partial<QuarantineEntry>
    if (typeof o.id !== 'string' || !Array.isArray(o.ops)) continue
    const ops = o.ops.filter(
      (op): op is PendingOp =>
        typeof op === 'object' &&
        op !== null &&
        typeof (op as PendingOp).opId === 'string' &&
        typeof (op as PendingOp).id === 'string'
    )
    // op が1件も残らない箱は、見せても再送しても意味が無い
    if (ops.length === 0) continue
    out.push({
      id: o.id,
      quarantinedAt: typeof o.quarantinedAt === 'string' ? o.quarantinedAt : '',
      reason: o.reason === 'repeated' ? 'repeated' : 'rejected',
      detail: typeof o.detail === 'string' ? o.detail : null,
      ops,
    })
  }
  return out
}

/** 隔離された1件の見出し。(純粋関数。カテゴリ名の解決は呼び出し側から渡す) */
export interface QuarantinedOpSummary {
  /** 追加 / 修正 / 削除 */
  action: string
  date: string
  title: string
  /** 金額(円)。削除は内容を持っていないので null */
  amount: number | null
}

export function quarantinedOpSummary(
  op: PendingOp,
  labelOf: (category: string | null) => string
): QuarantinedOpSummary {
  const action = op.kind === 'insert' ? '追加' : op.kind === 'update' ? '修正' : '削除'
  const p = op.payload
  if (!p) return { action, date: '', title: 'この記録の削除', amount: null }
  const title =
    p.type === 'partner_deposit'
      ? '彼女から預かり'
      : p.type === 'partner_refund'
        ? '彼女に返金'
        : p.type === 'partner_adjust'
          ? '残高の調整'
          : p.store || p.memo || labelOf(p.category)
  return { action, date: p.date, title, amount: p.amount }
}

/** 隔離された束に入っている金額の合計。(純粋関数。削除の op は数えない) */
export function entryTotal(entry: QuarantineEntry): number {
  return entry.ops.reduce((sum, op) => sum + (op.payload?.amount ?? 0), 0)
}

/** なぜ隔離されたのかの1行。(純粋関数) */
export function reasonText(reason: QuarantineReason): string {
  return reason === 'rejected'
    ? 'サーバーがこの内容を受け付けませんでした'
    : `同じ記録を ${SYNC_ATTEMPT_LIMIT} 回送っても断られたため、後ろの記録を止めないように取り置きました`
}

/**
 * 隔離したことを画面に残すための案内。(純粋関数)
 *
 * 元の案内(サーバーのエラーから引いたもの)を活かしつつ、
 * 「記録は端末の中に残っている」「どこから確認できるか」を必ず先頭に置く。
 * ここを曖昧にすると、利用者は記録が消えたと思って同じものを打ち直してしまう。
 */
export function quarantineGuidance(base: Guidance, count: number): Guidance {
  return {
    kind: 'rejected',
    summary: `同期できなかった記録 ${count}件を、この端末の中に取り置きました(消えていません)。${base.summary}`,
    actions: [
      '設定 →「同期できなかった記録」で中身を確認し、直したうえで再送するか、いらなければ破棄してください。',
      ...base.actions,
    ],
    detail: base.detail,
  }
}

// ---------- localStorage(隔離箱の実体) ----------

const QUARANTINE_KEY = 'kakeibo.quarantine'

let cache: QuarantineEntry[] | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

export function loadQuarantine(): QuarantineEntry[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(QUARANTINE_KEY)
    cache = raw ? parseEntries(JSON.parse(raw)) : []
  } catch {
    cache = []
  }
  return cache
}

/**
 * 隔離箱を書き戻す。**保存できたときだけ true**。
 *
 * 呼び出し側は、true を確かめてからキューの op を外すこと。
 * (保存できていないのに外したら、それは「捨てた」のと同じ)
 */
function saveQuarantine(list: QuarantineEntry[]): boolean {
  try {
    localStorage.setItem(QUARANTINE_KEY, JSON.stringify(list))
    cache = list
    notify()
    return true
  } catch {
    // 容量超過など。キャッシュも書き換えない(嘘の状態を作らない)
    return false
  }
}

/**
 * op をまとめて隔離する。保存できたときだけ true を返す。
 * 保存できなければ何も変わらない = 呼び出し側はキューに残したままにできる。
 */
export function quarantineOps(
  ops: readonly PendingOp[],
  reason: QuarantineReason,
  detail: string | null,
  now: Date = new Date()
): boolean {
  if (ops.length === 0) return true
  const entry: QuarantineEntry = {
    id: crypto.randomUUID(),
    quarantinedAt: now.toISOString(),
    reason,
    detail,
    ops: [...ops],
  }
  return saveQuarantine(addEntry(loadQuarantine(), entry))
}

/** 隔離を1件取り出す(まだ消さない)。再送のために中身を読む用 */
export function findQuarantineEntry(id: string): QuarantineEntry | null {
  return loadQuarantine().find((e) => e.id === id) ?? null
}

/** 隔離を1件消す。利用者が破棄したとき、または再送でキューに戻せたときだけ呼ぶ */
export function discardQuarantineEntry(id: string): boolean {
  return saveQuarantine(removeEntry(loadQuarantine(), id))
}

export function quarantineCount(): number {
  return loadQuarantine().length
}

/**
 * 隔離箱に入っている行のID。
 * 繰り返し入力の生成台帳との突き合わせで「まだ行き先が決まっていない行」を
 * 見分けるために使う(隔離中のものを積み直すと二重になる)。
 */
export function quarantinedRowIds(): string[] {
  return loadQuarantine().flatMap((e) => e.ops.map((o) => o.id))
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 画面から隔離箱を購読する。中身が変わればその場で描き直る */
export function useQuarantine(): QuarantineEntry[] {
  return useSyncExternalStore(subscribe, loadQuarantine, loadQuarantine)
}

// ---------- 断られた回数(キューを詰まらせないため) ----------

const ATTEMPTS_KEY = 'kakeibo.syncAttempts'

/** 回数を1つ増やした表を返す。(純粋関数) */
export function bumpAttempt(
  counts: Readonly<Record<string, number>>,
  opId: string
): Record<string, number> {
  return { ...counts, [opId]: (counts[opId] ?? 0) + 1 }
}

/** 回数を忘れる。(純粋関数。成功した op と、隔離し終えた op に使う) */
export function forgetAttempts(
  counts: Readonly<Record<string, number>>,
  opIds: readonly string[]
): Record<string, number> {
  const out = { ...counts }
  for (const id of opIds) delete out[id]
  return out
}

/** 限度に達したか。(純粋関数) */
export function reachedAttemptLimit(count: number, limit: number = SYNC_ATTEMPT_LIMIT): boolean {
  return count >= limit
}

function loadAttempts(): Record<string, number> {
  try {
    const raw = localStorage.getItem(ATTEMPTS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function saveAttempts(counts: Record<string, number>): void {
  try {
    localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(counts))
  } catch {
    // 保存できなくても、この起動中の回数だけで判断できる(記録は失わない)
  }
}

/**
 * 「サーバーに届いたうえで断られた」ときに呼ぶ。通算の回数を返す。
 * 端末に残すのは、アプリを開き直しても同じ op が同じだけ数えられるようにするため
 * (再起動のたびに 0 に戻ると、詰まったキューがいつまでも進まない)。
 */
export function recordSyncFailure(opId: string): number {
  const counts = bumpAttempt(loadAttempts(), opId)
  saveAttempts(counts)
  return counts[opId]
}

/** 成功した / 隔離し終えた op の回数を忘れる */
export function clearSyncFailures(opIds: readonly string[]): void {
  const counts = loadAttempts()
  if (!opIds.some((id) => id in counts)) return
  saveAttempts(forgetAttempts(counts, opIds))
}
