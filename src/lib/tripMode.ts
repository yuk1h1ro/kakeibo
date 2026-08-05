// ============================================================
// 旅行モード(入力側) — 「いま旅行中」を押している間、記録に自動でタグを付ける
//
// ---- なぜ必要か ----
// レポートは タグ(機能088)を軸に「普段の支出 / 特別な支出」を分けられる
// (reportTags.ts)。ただし入力側はタグを1件ずつ手で付ける作りなので、
// **3泊4日の旅行の全支出に毎回タグを打つ運用は続かない**。
// 続かない前提の入力に依存した集計は、いずれ意味を失う。
// そこで「モードを1回押したら、それ以降の入力に自動で付く」形にした。
//
// ---- なぜ端末内(localStorage)なのか ----
//   1. これは **記録ではなく、いま入力中の文脈** だから。保存された取引は
//      1件も変わらないし、モードが消えても失われるのは「これから付くはずの
//      タグ」だけで、記録は残る。
//   2. 保存先を Supabase にすると列かテーブルを1つ増やすことになる。この
//      家計簿は「マイグレーション未実行で入力が失われた」事故を起こしていて、
//      tags 列すら無い環境が現に想定されている。入力の主線に関わるものの
//      ために、その面を広げたくない。
//   3. 端末をまたぐ利点が薄い。旅行に持って行くのはスマホで、PC を触るのは
//      帰ってからの整理。**同期させるほうがむしろ危ない** — スマホで切り忘れた
//      モードが、帰宅後に PC で打つ普段の支出にまで「旅行」を付けてしまう。
//      端末ごとに別々でいられるほうが、事故の範囲が狭い。
//   4. 目隠し(機能169)・テンキー(機能052)・特別タグの選択
//      (reportTagSettings.ts)と同じ「端末ごとの状態」の仲間なので、
//      置き場所をそろえたほうが探しやすい。
//
// ---- 勝手に解除しないこと ----
// 日数が延びても、このモジュールは **自動では絶対に終わらせない**。
// 途中で勝手に切れると「タグが付いている記録と付いていない記録」が
// 1回の旅行の中で混ざり、あとから見分けがつかなくなる。
// 付きすぎているのは履歴で1件ずつ外せるが、付いていないものは気づけない。
// 代わりに 日数を常に出し、長引いたら気づかせる(tripReminderText)。
//
// ここは純粋関数 + 小さなストアだけ。Supabase には依存しない。
// ============================================================

import { useSyncExternalStore } from 'react'
import { DEFAULT_SPECIAL_TAGS } from './reportTagSettings'
import { todayISO } from './format'
import { normalizeTag, sanitizeTags } from './tags'

const STORAGE_KEY = 'kakeibo.tripMode'

export interface TripMode {
  /** これ以降の入力に自動で付けるタグ(正規化済み) */
  tag: string
  /** 開始した日 'YYYY-MM-DD'。経過日数の表示と「切り忘れ」の気づきに使う */
  startedOn: string
}

/**
 * 何日目から「切り忘れかもしれない」と声をかけるか。
 *
 * レポートは記録が 7日(EVENT_GAP_DAYS)以上空くと「別の回」として切るので、
 * 7日を超えて続くモードは、レポートから見ても1回の出来事として大きすぎる。
 * 3泊4日の旅行も1週間の出張も 7日以内に収まるため、そこを越えたら
 * 「まだ続いていますか」と聞くのが妥当なところ。
 * **越えても解除はしない** — 判断するのは利用者。
 */
export const TRIP_REMINDER_DAYS = 8

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ---------- 純粋関数(保存値の読み書き) ----------

/**
 * 保存されている文字列を旅行モードに読み直す。(純粋関数)
 * 読めない値・タグが空になる値・日付の形をしていない値は「オフ」に倒す。
 * ここで倒しておかないと、壊れた保存値のせいで意図しないタグが
 * 記録に混ざり続けることになる(記録に効く設定なので厳しめに見る)。
 */
export function parseTripMode(raw: string | null): TripMode | null {
  if (raw === null || raw === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as { tag?: unknown; startedOn?: unknown }
  if (typeof o.tag !== 'string' || typeof o.startedOn !== 'string') return null
  const tag = normalizeTag(o.tag)
  if (tag === null || !DATE_RE.test(o.startedOn)) return null
  return { tag, startedOn: o.startedOn }
}

/** 保存する形にする。(純粋関数) */
export function serializeTripMode(mode: TripMode): string {
  return JSON.stringify({ tag: mode.tag, startedOn: mode.startedOn })
}

/**
 * 打たれた文字列から旅行モードを作る。(純粋関数)
 * タグの正規化は入力欄(tags.ts)とまったく同じ規則を通すので、
 * 「#旅行」と「旅行」は同じタグになる。空になるものでは始められない。
 */
export function beginTripMode(tagInput: string, today: string): TripMode | null {
  const tag = normalizeTag(tagInput)
  if (tag === null) return null
  return { tag, startedOn: today }
}

// ---------- 純粋関数(表示と判断) ----------

function toUTCms(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/**
 * 開始日を1日目とした経過日数。(純粋関数)
 * 端末の日付が戻されている等で開始日が未来になっていても 1 を下回らせない
 * (「-3日目」という表示のほうが、ずれそのものより不安にさせる)。
 */
export function tripDayCount(mode: TripMode, today: string): number {
  const diff = Math.round((toUTCms(today) - toUTCms(mode.startedOn)) / 86_400_000)
  return diff < 0 ? 1 : diff + 1
}

/** 声をかける日数に達したか。(純粋関数。達しても解除はしない) */
export function isTripOverdue(mode: TripMode, today: string): boolean {
  return tripDayCount(mode, today) >= TRIP_REMINDER_DAYS
}

/** オンの間ずっと出す短い表示。「何が付くか」と「何日目か」だけ。(純粋関数) */
export function tripBadgeText(mode: TripMode, today: string): string {
  return `#${mode.tag} ・ ${tripDayCount(mode, today)}日目`
}

/**
 * 長引いたときの一言。(純粋関数。短いあいだは null = 何も出さない)
 * 「解除してください」ではなく「終わっていませんか」と聞くだけにする —
 * 本当に長い出張の最中に、毎回とがめられる画面にはしたくない。
 */
export function tripReminderText(mode: TripMode, today: string): string | null {
  if (!isTripOverdue(mode, today)) return null
  return `旅行モードが${tripDayCount(mode, today)}日目です。もう終わっていませんか? 続いている間は、普段の支出にも「${mode.tag}」が付きます`
}

/**
 * この1件に実際に付ける自動タグ。(純粋関数)
 * オフのとき・タグ列が無い環境・この1件だけ外したときは null(= 何も付けない)。
 * 判断をここ1か所に集めているのは、画面の表示(何が付くか)と保存内容が
 * 必ず一致するようにするため。
 */
export function tripAutoTag(
  mode: TripMode | null,
  opts: { taggingAvailable: boolean; skippedForThisEntry: boolean }
): string | null {
  if (mode === null) return null
  if (!opts.taggingAvailable) return null
  if (opts.skippedForThisEntry) return null
  return mode.tag
}

/**
 * 手で付けたタグと自動タグを合わせる。(純粋関数)
 *
 * 自動タグを **先頭** に置くのは、1件あたりの上限(MAX_TAGS_PER_TX)で
 * 打ち切られる側に回さないため。手で5つ付けた回だけ旅行タグが静かに
 * 落ちると、その1件だけ集計から抜けて理由が分からなくなる。
 * 重複は sanitizeTags が落とすので、手で「旅行」と打っていても二重にならない。
 */
export function mergeTripTag(manual: readonly string[], autoTag: string | null): string[] {
  return sanitizeTags(autoTag === null ? manual : [autoTag, ...manual])
}

/**
 * 開始するときに並べるタグの候補。(純粋関数)
 *
 * レポートで「特別な支出」として集計されるタグ(reportTagSettings.ts)を
 * そのまま出す — ここで選んだタグがレポートで特別扱いされないと、
 * 付けた意味が無くなるため。全部外している人には既定の3つを出す
 * (候補が1つも無いと、そもそもモードを始められない)。
 */
export function tripTagOptions(specialTags: readonly string[]): string[] {
  const base = specialTags.length > 0 ? specialTags : DEFAULT_SPECIAL_TAGS
  const out: string[] = []
  for (const raw of base) {
    const tag = normalizeTag(raw)
    if (tag === null || out.includes(tag)) continue
    out.push(tag)
  }
  return out
}

// ---------- 端末内のストア ----------

function load(): TripMode | null {
  try {
    return parseTripMode(localStorage.getItem(STORAGE_KEY))
  } catch {
    // プライベートブラウズ等で localStorage が使えない環境ではオフで動かす
    return null
  }
}

// useSyncExternalStore に渡すスナップショットは参照を安定させる
// (毎回新しいオブジェクトを返すと再描画が止まらなくなる)
let current: TripMode | null = load()
const listeners = new Set<() => void>()

export function getTripMode(): TripMode | null {
  return current
}

function commit(next: TripMode | null): void {
  current = next
  try {
    if (next === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, serializeTripMode(next))
  } catch {
    // 保存できなくても、この起動中は選んだとおりに動く
  }
  for (const l of listeners) l()
}

/**
 * 旅行モードを始める。始められたら true。
 * 開始日は「今日」— 過去に遡って付け直すことはしない(モードは
 * 「これ以降の入力」だけを変える。すでに保存された記録には触れない)。
 */
export function startTripMode(tagInput: string): boolean {
  const next = beginTripMode(tagInput, todayISO())
  if (next === null) return false
  commit(next)
  return true
}

/** 旅行モードを終える。利用者が押したときだけ呼ばれる(自動では呼ばない) */
export function endTripMode(): void {
  commit(null)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 現在の旅行モード。開始・終了に追従する */
export function useTripMode(): TripMode | null {
  return useSyncExternalStore(subscribe, getTripMode, getTripMode)
}
