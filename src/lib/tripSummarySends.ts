// ============================================================
// 「この旅行はもう送った」の控え
//
// ---- 同じ旅行を二度送ったらどうするか ----
// **止めません。送れます。** ただし2回目からは、画面と Discord の本文の両方に
// 「送り直し」と出します。理由:
//   ・送り直したい場面が実際にある。金額を直した / 付け忘れた記録を足した /
//     彼女が通知を消してしまった。ここで止めると、直した内容を渡す手段が無くなる
//   ・一方、同じまとめが2通並ぶと「2回ぶん使ったのか」と読めてしまう。
//     読み違えを防ぐのに必要なのは禁止ではなく **印** なので、そちらを付ける
// 履歴のまとめ送信のカーソル(partnerBacklogSends)とは別物として扱う。
// あちらは「どこまで送ったかを進める」もので、戻してはいけない。こちらは
// 「同じ旅行をもう一度送ってよいか」の判断材料でしかない。
//
// ---- なぜ端末内(localStorage)なのか ----
//   1. **記録ではなく覚え書き** だから。消えても失われるのは注意書きだけで、
//      送信そのものは成立するし、彼女に届いたものも変わらない。
//   2. サーバーに置くにはテーブルか列が要る。この家計簿は「マイグレーション
//      未実行で入力が失われた」事故を起こしていて、tags 列すら無い環境が現に
//      想定されている。**注意書きのために移行の面を広げない**。
//   3. 二度送りの実害は「彼女の通知が1つ増える」ことで、送る前に必ず
//      件数と1通目の実物を見せて確認を取っている。端末をまたいで覚えていなくても、
//      押す瞬間には必ず気づける。
// ============================================================

import { useSyncExternalStore } from 'react'
import type { DateRange } from './report'

const STORAGE_KEY = 'kakeibo.tripSummarySends'

/** 覚えておく件数の上限。古いものから捨てる(端末の容量を無限に食わない) */
export const MAX_TRIP_SENDS = 50

export interface TripSendRecord {
  /** 旅行を指す鍵(タグ + 期間) */
  key: string
  /** 送った日時 (ISO) */
  sentAt: string
  /** 送った明細の件数 */
  entries: number
  /** 送った通数 */
  messages: number
}

/**
 * 旅行1回ぶんを指す鍵。(純粋関数)
 * タグと期間の両方を含める。同じ行き先に2回行った(= 回が2つある)ときに、
 * 片方を送っただけで両方が「送信済み」に見えてはいけないため。
 */
export function tripSendKey(tags: readonly string[], range: DateRange): string {
  return `${[...tags].join(' ')}|${range.start}|${range.end}`
}

/** 未知の形を安全に読む。(純粋関数。壊れていれば「まだ送っていない」に倒す) */
export function parseTripSends(value: unknown): TripSendRecord[] {
  if (!Array.isArray(value)) return []
  const out: TripSendRecord[] = []
  for (const raw of value) {
    if (raw === null || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    if (typeof o.key !== 'string' || typeof o.sentAt !== 'string') continue
    out.push({
      key: o.key,
      sentAt: o.sentAt,
      entries: typeof o.entries === 'number' ? o.entries : 0,
      messages: typeof o.messages === 'number' ? o.messages : 0,
    })
  }
  return out.slice(0, MAX_TRIP_SENDS)
}

/** 送った記録を足す。(純粋関数。同じ旅行は最新の1件だけ残す・新しい順) */
export function addTripSend(
  list: readonly TripSendRecord[],
  record: TripSendRecord
): TripSendRecord[] {
  return [record, ...list.filter((r) => r.key !== record.key)].slice(0, MAX_TRIP_SENDS)
}

/** その旅行を前に送っているか。(純粋関数。送っていなければ null) */
export function findTripSend(
  list: readonly TripSendRecord[],
  key: string
): TripSendRecord | null {
  return list.find((r) => r.key === key) ?? null
}

/**
 * 送信済みのときに画面へ出す一言。(純粋関数)
 * **禁止ではなく事実だけ**を書く。もう一度送るかどうかは利用者が決める。
 */
export function tripResendNotice(record: TripSendRecord, formatAt: (iso: string) => string): string {
  return `この旅行は ${formatAt(record.sentAt)} に送信済みです(${record.entries}件・${record.messages}通)。もう一度送ると、彼女には「送り直し」と分かる形で届きます`
}

// ---------- 端末内のストア ----------

function load(): TripSendRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return parseTripSends(JSON.parse(raw))
  } catch {
    return []
  }
}

// useSyncExternalStore に渡すスナップショットは参照を安定させる
let current: TripSendRecord[] = load()
const listeners = new Set<() => void>()

export function getTripSends(): TripSendRecord[] {
  return current
}

/** 送り終えたときに呼ぶ。保存できなくても送信は成立している */
export function rememberTripSend(record: TripSendRecord): void {
  current = addTripSend(current, record)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // 覚え書きが書けなくても、この起動中は画面に出る
  }
  for (const l of listeners) l()
}

/** テスト用に控えを空にする */
export function resetTripSendsForTest(): void {
  current = []
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // localStorage が無い環境でも続けられる
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 送信済みの控え。送るたびに再描画される */
export function useTripSends(): TripSendRecord[] {
  return useSyncExternalStore(subscribe, getTripSends, getTripSends)
}
