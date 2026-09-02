import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Satisfaction, Transaction, TransactionType } from '../lib/types'
import {
  appendOp,
  loadQueue,
  removeOp,
  type PendingOp,
} from '../lib/offlineQueue'
import {
  clearSyncFailures,
  discardQuarantineEntry,
  findQuarantineEntry,
  opsToQuarantine,
  persistedSplitSiblings,
  quarantineCount,
  quarantineGuidance,
  quarantineOps,
  quarantinedRowIds,
  reachedAttemptLimit,
  recordSyncFailure,
  splitGroupOf,
  useQuarantine,
  type QuarantineReason,
} from '../lib/quarantine'
import {
  confirmGeneratedMarks,
  forgetGeneratedMarks,
  reconcileGeneratedMarks,
} from '../lib/recurringLedger'
import {
  isSatisfactionUnavailable,
  markSatisfactionUnavailable,
  withoutSatisfaction,
} from '../lib/satisfaction'
import {
  buildPartnerOpMessage,
  notifyLowBalanceIfNeeded,
  sendDiscordMessage,
} from '../lib/discordNotify'
import { partnerBalance } from '../lib/partnerBalance'
import {
  initTxExtensions,
  isFavorAmountRejection,
  isLedgerTypeRejection,
  isTxFeatureAvailable,
  markTxFeatureUnavailable,
  stripUnavailableColumns,
} from '../lib/txExtensions'
import {
  isDuplicateRowError,
  isNetworkError,
  isRetryableServerError,
  isSchemaError,
  type ServerErrorLike,
} from '../lib/serverErrors'
import {
  favorRejectionGuidance,
  formatGuidance,
  guidanceForServerError,
  isOnlineNow,
  ledgerRejectionGuidance,
  syncRejectedGuidance,
  type Guidance,
} from '../lib/errorGuidance'
import { categoryLabel } from '../lib/categories'
import { todayISO } from '../lib/format'
import {
  diffTransaction,
  initChangeLog,
  newEntry,
  recordChange,
  transactionSummary,
} from '../lib/changeLog'
import { restoreInput } from '../lib/txActions'

export interface TransactionInput {
  date: string
  // 機能012 で partner_refund / partner_adjust が加わった
  type: TransactionType
  amount: number
  category: string | null
  memo: string
  store: string // お店(店名)。任意。支出でのみ使用(空文字 = 未入力)
  partner_amount: number
  // 繰り返し入力が自動生成した行の印。手入力では付けない。
  // (省略時は列自体を送らないので、source 列が無いDBでも手入力は通る)
  source?: 'recurring'
  // 感情スタンプ (機能219 + 143)。migration-satisfaction.sql 未実行の環境では
  // 送信直前にキーごと落とす(下の sendablePayload)
  satisfaction?: Satisfaction | null
  // 支出のうち彼女が実際に払った額 (機能018)
  partner_paid?: number
  // タグ (機能088)
  tags?: string[]
  // 分割した会計の束ねID (機能096)
  split_group?: string | null
  // おごり・値引き (favors.ts)。3つで1組(額・理由・相手)。
  // amount には足さない — 払っていないお金を支出の集計に混ぜないため
  favor_amount?: number
  favor_kind?: string | null
  favor_from?: string
  // 作成日時。ふだんは送らず DB の now() に任せるが、**元に戻す**ときだけは
  // 元の値を写す (機能159)。写さないと復元した瞬間が created_at になり、
  // 同じ日の中での並び順が変わり、レポートの「時間帯別」も復元時刻に付け替わる。
  created_at?: string
}

/**
 * 送信直前に、この環境に無い列を落とした内容を作る。
 * 列が無いと分かっている間はそのキーを送らないことで、
 * マイグレーション未実行でも記録そのものは必ず通る。
 */
function sendablePayload(payload: TransactionInput | undefined): Partial<TransactionInput> {
  if (!payload) return {}
  const base = isSatisfactionUnavailable() ? withoutSatisfaction(payload) : payload
  return stripUnavailableColumns(base)
}

// ---------- スナップショットキャッシュ(オフライン起動・高速起動用) ----------

const TX_CACHE_KEY = 'kakeibo.txCache'

// 後方互換: store カラム追加以前に保存された行(migration 未実行のサーバー・
// 旧バージョンの localStorage キャッシュ)には store が無い(undefined)。
// 表示側に `?? ''` を散らさず、読み込みの入口で一括して '' に正規化する。
function normalizeRows(rows: Transaction[]): Transaction[] {
  return rows.map((r) => (typeof r.store === 'string' ? r : { ...r, store: '' }))
}

function loadTxCache(): Transaction[] | null {
  try {
    const raw = localStorage.getItem(TX_CACHE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? normalizeRows(parsed as Transaction[]) : null
  } catch {
    return null
  }
}

function saveTxCache(rows: Transaction[]): void {
  try {
    localStorage.setItem(TX_CACHE_KEY, JSON.stringify(rows))
  } catch {
    // 容量超過等は無視(キャッシュはあくまで補助)
  }
}

// ---------- 最終同期時刻 (機能154) ----------
// 「いつのデータを見ているのか」は再起動しても引き継ぎたいので端末内に残す。
// 記録できるのは「サーバーから取り込みに成功した時刻」だけで、
// 通信できなかったときは前の値を保つ(嘘の更新時刻を出さないため)。

const LAST_SYNC_KEY = 'kakeibo.lastSyncedAt'

function loadLastSyncedAt(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_KEY)
  } catch {
    return null
  }
}

function saveLastSyncedAt(iso: string): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, iso)
  } catch {
    // 保存できなくても表示が出ないだけ
  }
}

// ---------- 再試行すべきエラーの判定 ----------
// 判定そのものは lib/serverErrors.ts に置き、他のテーブルからも同じ基準で使う。
// 従来この場所から import していた箇所のために再エクスポートする。
export type { ServerErrorLike }
export { isNetworkError, isSchemaError, isRetryableServerError }

/** 削除を取り消せる時間 (機能159)。短いと間に合わず、長いと画面を塞ぐ */
const UNDO_WINDOW_MS = 7000

// エラー文言は lib/errorGuidance.ts が組み立てる (機能161)。
// ここに固定文言を置いていた頃は migration-store.sql の決め打ちで、
// タグ・分割・返金など別の列が足りないときにも「store の SQL を実行してください」と
// 間違ったファイルを案内していた。サーバーの code / details / hint が生きているのは
// この場所だけなので、ここで分類すれば正しい SQL を名指しできる。

function sortRows(rows: Transaction[]): Transaction[] {
  return [...rows].sort(
    (a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)
  )
}

// サーバースナップショットに保留キューを順に適用した表示用リストを作る
function applyPendingOps(server: Transaction[], ops: PendingOp[]): Transaction[] {
  let rows = server
  for (const op of ops) {
    if (op.kind === 'insert') {
      if (op.payload && !rows.some((r) => r.id === op.id)) {
        rows = [...rows, { id: op.id, created_at: op.queuedAt, ...op.payload }]
      }
    } else if (op.kind === 'update') {
      if (op.payload) {
        const payload = op.payload
        rows = rows.map((r) => (r.id === op.id ? { ...r, ...payload } : r))
      }
    } else {
      rows = rows.filter((r) => r.id !== op.id)
    }
  }
  return sortRows(rows)
}

export function useTransactions(supabase: SupabaseClient) {
  const [serverTx, setServerTx] = useState<Transaction[]>(() => loadTxCache() ?? [])
  const [pendingOps, setPendingOps] = useState<PendingOp[]>(() => loadQueue())
  // キャッシュがあれば即表示できるので loading にしない
  const [loading, setLoading] = useState(() => loadTxCache() === null)
  // エラーは「原因 + 次の行動」の構造のまま持つ (機能161)。
  // 文字列にしてから画面側で分類し直すと、畳んだ文言をもう一度ほどくことになり、
  // 案内が二重に出てしまうため(MainScreen は errorGuide をそのまま描く)。
  const [errorGuide, setErrorGuide] = useState<Guidance | null>(null)
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [syncing, setSyncing] = useState(false)
  // この起動でサーバーから一度でも取り込めたか。
  // 「サーバーに無い」を根拠に判断してよいのは、取り込めたときだけ
  // (端末に残っている lastSyncedAt は前回の起動のものなので使えない)
  const [serverSynced, setServerSynced] = useState(false)
  // サーバーから取り込みに成功した最後の時刻 (機能154)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => loadLastSyncedAt())

  // StrictMode の二重実行や 'online' イベント連打での flush 多重起動を防ぐ
  const flushingRef = useRef(false)

  // Discord通知の残高計算用に、flush 内から最新のサーバースナップショットを
  // 同期的に参照できるようにしておく(state だけだと閉じ込めが古くなる)
  const serverTxRef = useRef<Transaction[]>(serverTx)

  const refresh = useCallback(async () => {
    // 明らかにオフラインなら何もしない(キャッシュ表示を維持)
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setLoading(false)
      return
    }
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
      if (error) {
        // ネットワーク起因の失敗は「オフライン」扱いで静かに戻る
        if (!isNetworkError(error.message)) {
          setErrorGuide(guidanceForServerError(error, isOnlineNow()))
        }
      } else {
        const rows = normalizeRows(data as Transaction[])
        setServerTx(rows)
        serverTxRef.current = rows
        saveTxCache(rows)
        setServerSynced(true)
        // 「サーバーから取り込めた」ことは、送れなかった記録が片付いたことを意味しない。
        // ここで一律に消していたせいで、隔離の案内が画面から1文字も残らず、
        // 再読み込みすると痕跡がゼロになっていた。
        // 隔離箱が空になるまでは、拒否の案内を消さない
        setErrorGuide((prev) => (prev?.kind === 'rejected' && quarantineCount() > 0 ? prev : null))
        // 取り込めたときだけ更新時刻を進める(機能154)
        const now = new Date().toISOString()
        setLastSyncedAt(now)
        saveLastSyncedAt(now)
      }
    } catch {
      // fetch 例外もオフライン扱い。error state は汚さない
    }
    setLoading(false)
  }, [supabase])

  /**
   * 送れなかった op を隔離箱へ移す。移せた件数を返し、移せなければ null。
   *
   * ここが「記録を失わない」ための最後の砦なので、順番を必ず守る:
   *   1. 隔離箱に **保存できたことを確かめて** から
   *   2. キューから外す
   * 逆順にすると、保存に失敗した瞬間に記録が消える。
   *
   * 分割 (split_group) は会計まるごと扱う。すでにサーバーへ入ってしまった
   * 片割れがあれば削除の op を積み、その内容も隔離箱に入れておく —
   * 「3,000円の会計が 2,000円だけ残る」という中途半端な状態を作らないため。
   */
  const quarantineFromQueue = useCallback(
    (
      op: PendingOp,
      reason: QuarantineReason,
      err: ServerErrorLike,
      rows: readonly Transaction[]
    ): number | null => {
      const group = opsToQuarantine(loadQueue(), op)
      // 取り消す相手は「手元で内容が分かっている行」だけに限る。
      // split_group でまとめてサーバーから消す手もあるが、それだと中身を
      // 隔離箱に持っていけない = 記録を失う。見えている範囲だけを丁寧に扱う
      const siblings = persistedSplitSiblings(rows, splitGroupOf(op), group)
      // 消す前に、同じ内容で入れ直せる形にして隔離箱へ持っていく
      const undoOps: PendingOp[] = siblings.map((row) => ({
        opId: crypto.randomUUID(),
        kind: 'insert',
        id: row.id,
        // 元に戻すのと同じ内容(created_at も含む)。再送すれば元どおりになる
        payload: restoreInput(row),
        queuedAt: row.created_at,
      }))
      if (!quarantineOps([...group, ...undoOps], reason, err.message || null)) return null
      let ops = loadQueue()
      for (const o of group) ops = removeOp(o.opId)
      const now = new Date().toISOString()
      for (const row of siblings) {
        ops = appendOp({ opId: crypto.randomUUID(), kind: 'delete', id: row.id, queuedAt: now })
      }
      setPendingOps(ops)
      clearSyncFailures(group.map((o) => o.opId))
      return group.length + undoOps.length
    },
    []
  )

  // 保留キューを先頭から順に Supabase へ送る
  const flush = useCallback(async () => {
    if (flushingRef.current) return
    if (loadQueue().length === 0) return
    flushingRef.current = true
    setSyncing(true)
    let flushedSomething = false
    // Discord通知用: この flush 中に成功した op を順に適用したローカル状態。
    // update/delete の旧行の検索と「op適用後の残高」の計算に使う
    // (厳密な整合性より、通知が記録を止めないことを優先する)
    let localRows = serverTxRef.current
    try {
      for (;;) {
        const queue = loadQueue()
        if (queue.length === 0) break
        const op = queue[0]
        // code/details/hint まで保持する(スキーマ関連エラーの判定に使う)
        let err: ServerErrorLike | null = null
        try {
          if (op.kind === 'insert') {
            const { error } = await supabase
              .from('transactions')
              .insert({ id: op.id, ...sendablePayload(op.payload) })
            err = error
          } else if (op.kind === 'update') {
            const { error } = await supabase
              .from('transactions')
              .update({ ...sendablePayload(op.payload) })
              .eq('id', op.id)
            err = error
          } else {
            const { error } = await supabase.from('transactions').delete().eq('id', op.id)
            err = error
          }
        } catch (e) {
          err = { message: e instanceof Error ? e.message : String(e) }
        }
        // 「その行はもう入っている」と断られた = 前回の送信は実は成功していて、
        // 応答だけが返ってこなかった(圏外に入る瞬間に起きる)。
        // 行IDは端末側で採番しているので、その id がサーバーに在るなら、それは
        // 自分が前に送った行そのもの。失敗ではなく **すでに終わっている** ので、
        // 下の成功の道へそのまま合流させ、キューから外す(同期を冪等にする)。
        // ここを拒否のまま扱っていたころは、分割が会計まるごと隔離されたうえ、
        // 隔離箱から送り直しても同じ行IDでまた 23505 になり、永久に復旧できなかった。
        // 判定の根拠(details の "Key (id)=(…)")は serverErrors.ts に書いてある。
        // update / delete に同じ手当ては要らない: PATCH も DELETE も同じ内容を
        // 送り直すだけで成功して返る(対象が消えていても 0件更新の成功)ので、
        // 「実は成功していたのに永久に断られ続ける」という形にはならない。
        if (err && op.kind === 'insert' && isDuplicateRowError(err, op.id)) {
          err = null
        }
        if (err) {
          if (isNetworkError(err.message)) {
            // 通信起因 — 届いてすらいないので、キューは保持したまま静かに中断する。
            // 「断られた回数」にも数えない(圏外を何度も通っただけで隔離しないため)
            break
          }
          if (isSchemaError(err)) {
            // satisfaction(感情スタンプ)は「無くても記録は成り立つ」項目なので、
            // その列が無いだけなら諦めて同じ op をやり直す。ここで中断すると
            // 後続の記録まで送れなくなり、入力が滞留してしまうため。
            // 一度落としたあとは sendablePayload が送らないので無限には回らない。
            if (!isSatisfactionUnavailable() && op.payload?.satisfaction !== undefined) {
              markSatisfactionUnavailable()
              continue
            }
            // 機能018(彼女が払った額)・088(タグ)・096(分割)の列も、
            // 「無くても記録の本体は成り立つ」ので、その列だけ諦めてやり直す。
            // partner_paid が落ちれば自分が全額払った扱い、split_group が落ちれば
            // 束ねだけが消え、tags が落ちればタグだけが付かない — 金額は必ず残る。
            if (isTxFeatureAvailable('settlement') && op.payload?.partner_paid !== undefined) {
              markTxFeatureUnavailable('settlement')
              continue
            }
            if (
              isTxFeatureAvailable('tagging') &&
              (op.payload?.tags !== undefined || op.payload?.split_group !== undefined)
            ) {
              markTxFeatureUnavailable('tagging')
              continue
            }
            // おごり・値引き(favors.ts)の3列も同じ扱い。落ちても
            // 「誰にご馳走になったか」が付かないだけで、金額と日付は必ず残る。
            // ただし全額おごりの 0円 は、列を落としても金額の制約に弾かれる —
            // それは下の isFavorAmountRejection が見分けて案内する
            if (isTxFeatureAvailable('favor') && op.payload?.favor_amount !== undefined) {
              markTxFeatureUnavailable('favor')
              continue
            }
          }
          // ここから先は「サーバーに届いたうえで断られた」失敗。
          // 直せる失敗(migration 未実行)か、直しようのない拒否(制約違反)かで
          // 扱いを変えるが、**どちらでも op を捨てない** のは共通の約束。
          // 支払い 0円 の記録が金額の制約に弾かれた = migration-favor.sql 未実行。
          // 種別の拒否より先に見る(こちらは支出、あちらは返金・調整なので重ならないが、
          // 判定の順番を固定しておくほうが後から読んで迷わない)
          const favorRejected = isFavorAmountRejection(err, op.payload)
          const ledgerRejected = !favorRejected && isLedgerTypeRejection(err, op.payload?.type)
          if (ledgerRejected) {
            // 返金・調整の種別が DB のチェック制約に無い = migration 未実行。
            // 導線を閉じて、これ以上同じ失敗を増やさない
            markTxFeatureUnavailable('settlement')
          }
          const guide = isSchemaError(err)
            ? // どの SQL を実行すればよいかは、code / details / hint が残っている
              // ここでしか分からない。決め打ちの文言ではなく、必ず err から引く
              guidanceForServerError(err, isOnlineNow())
            : favorRejected
              ? // 制約名 (transactions_amount_check) だけでは「調整のマイナス」と
                // 区別が付かないので、中身まで見たここでファイル名を決める
                favorRejectionGuidance(err)
              : ledgerRejected
                ? ledgerRejectionGuidance(err)
                : syncRejectedGuidance(err, isOnlineNow())
          // 送り直せば通る見込みがあるのは migration 系だけ。
          // それ以外(制約違反など)は何度送っても同じなので、すぐ隔離する
          const retryable = isSchemaError(err) || ledgerRejected || favorRejected
          const attempts = recordSyncFailure(op.opId)
          if (!retryable || reachedAttemptLimit(attempts)) {
            // 同じ op が何度も断られると、その後ろの記録がすべて送れなくなる。
            // 記録は隔離箱(localStorage)に移して必ず残したうえで、先へ進む
            const moved = quarantineFromQueue(
              op,
              retryable ? 'repeated' : 'rejected',
              err,
              localRows
            )
            if (moved !== null) {
              setErrorGuide(quarantineGuidance(guide, moved))
              flushedSomething = true
              continue
            }
            // 隔離箱に保存できなかった(容量超過など)。
            // 捨てるくらいなら、キューに残したまま止まるほうがまし
            setErrorGuide(guide)
            break
          }
          setErrorGuide(guide)
          break
        } else {
          // 同期成功 — 彼女残高に影響する op なら Discord に通知する。
          // 旧行の参照(localRows)は「キューから op を消す前」に確保する
          const nextRows = applyPendingOps(localRows, [op])
          const message = buildPartnerOpMessage(op, localRows, nextRows)
          if (message) void sendDiscordMessage(message) // 投げっぱなし。失敗しても記録は止めない
          // 機能010: 残高がしきい値をまたいだときだけ低下アラートを送る。
          // 個々の op の通知とは別に、確定した残高そのものを見て判断する
          if (message) notifyLowBalanceIfNeeded(partnerBalance(nextRows))
          localRows = nextRows
          // 繰り返し入力が作った行なら、「サーバーが受け付けた」ことをここで控えに記す。
          // 取り込み直しを待たずにこの瞬間に記すのが肝心 — 待つと、その隙に
          // 別の端末で消された記録を「届いていない」と誤認して復活させてしまう
          if (op.kind === 'insert') confirmGeneratedMarks([op.id])
          setPendingOps(removeOp(op.opId))
          // 断られた回数は「連続で」数えたいので、通った時点で忘れる
          clearSyncFailures([op.opId])
          flushedSomething = true
        }
      }
    } finally {
      flushingRef.current = false
      setSyncing(false)
    }
    // 全部さばけたらサーバーの真の状態を取り直す
    if (flushedSomething && loadQueue().length === 0) {
      await refresh()
    }
  }, [supabase, refresh, quarantineFromQueue])

  // マウント時: まずキャッシュ表示 → サーバーから取得 → 保留分を再送
  useEffect(() => {
    void refresh().then(() => flush())
  }, [refresh, flush])

  // 変更履歴 (機能163)。テーブルが無ければ静かに無効化されるだけで、
  // 記録・入力・同期には一切影響しない。貯まっていた履歴もここで送る
  useEffect(() => {
    void initChangeLog(supabase)
  }, [supabase])

  // 後から足した列 (partner_paid / tags / split_group) がこの環境にあるか。
  // 取引を読み書きするのはこのフックなので、確認もここで一度だけ行う。
  // 無ければ該当機能の導線が消えるだけで、記録・入力・同期は今までどおり動く
  useEffect(() => {
    void initTxExtensions(supabase)
  }, [supabase])

  // ---------- 繰り返し入力の取りこぼしの回復 ----------
  /**
   * 「生成済みの印だけ進んで、取引がどこにも無い」状態を起動時に見つけて積み直す。
   *
   * 判断できるのは **サーバーから取り込めて、かつ送信待ちが1件も無い** ときだけ。
   * どちらかが欠けていると「サーバーに無い」が「まだ届いていない」と区別できず、
   * 送信中の記録をもう一度積んでしまう。
   *
   * 積み直す中身と行IDは控え(recurringLedger)がそのまま持っているので、
   * ルールが編集・削除されていても、当時の内容のまま戻る。
   * 利用者が消した記録は控えごと忘れているため、ここには絶対に現れない。
   */
  const recoveredRef = useRef(false)
  useEffect(() => {
    if (recoveredRef.current) return
    if (loading || !serverSynced || pendingOps.length > 0) return
    recoveredRef.current = true
    const lost = reconcileGeneratedMarks({
      serverIds: new Set(serverTx.map((t) => t.id)),
      queuedIds: new Set(loadQueue().map((o) => o.id)),
      quarantinedIds: new Set(quarantinedRowIds()),
      today: todayISO(),
    })
    if (lost.length === 0) return
    const queuedAt = new Date().toISOString()
    let ops: PendingOp[] = loadQueue()
    for (const m of lost) {
      ops = appendOp({
        opId: crypto.randomUUID(),
        kind: 'insert',
        // 控えに残した行IDをそのまま使う。二重になっても主キーが弾く
        id: m.txId,
        payload: m.input,
        queuedAt,
      })
    }
    setPendingOps(ops)
    void flush()
  }, [loading, serverSynced, pendingOps.length, serverTx, flush])

  // オンライン/オフラインの追跡。復帰時は自動で再同期
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      void flush()
    }
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [flush])

  // ---------- 変更履歴 (機能163) ----------
  // 記録の書き換えは必ずこのフックを通るので、履歴もここで一括して残す。
  // 画面ごとに書くと必ずどこかが漏れる(編集シート・一括編集・スワイプ削除…)。
  // 履歴は投げっぱなしで、失敗しても取引の保存・同期は一切止めない。

  // 差分を取るための「変更前」の行。保留キューを適用した表示中の内容を見る
  const txRef = useRef<Transaction[]>([])

  const logUpdate = useCallback((id: string, input: TransactionInput) => {
    const before = txRef.current.find((t) => t.id === id)
    if (!before) return
    recordChange(
      newEntry(
        id,
        'update',
        transactionSummary(before, categoryLabel),
        diffTransaction(before, input, categoryLabel)
      )
    )
  }, [])

  const logRemoved = useCallback((tx: Transaction) => {
    recordChange(newEntry(tx.id, 'delete', transactionSummary(tx, categoryLabel), []))
  }, [])

  // ---------- 削除の取り消し (機能159) ----------
  // 「削除を取り消せる状態」はフック側に持たせる。
  // どの画面から消しても(編集シート・スワイプ・長押し・一括)同じように
  // 取り消せるようにするため、そして画面を離れても数秒で必ず期限切れになるため
  // (取り消しバーの寿命を画面の寿命に紐付けると、あとから古いバーが出てしまう)。
  const [undoableDeletes, setUndoableDeletes] = useState<Transaction[] | null>(null)
  const undoTimerRef = useRef<number | null>(null)

  const clearUndoTimer = () => {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current)
      undoTimerRef.current = null
    }
  }

  const armUndo = useCallback((txs: readonly Transaction[]) => {
    clearUndoTimer()
    setUndoableDeletes(txs.length > 0 ? [...txs] : null)
    undoTimerRef.current = window.setTimeout(() => {
      undoTimerRef.current = null
      setUndoableDeletes(null)
    }, UNDO_WINDOW_MS)
  }, [])

  const dismissUndo = useCallback(() => {
    clearUndoTimer()
    setUndoableDeletes(null)
  }, [])

  useEffect(() => clearUndoTimer, [])

  /**
   * 1件追加する。
   *
   * `id` は通常渡さない。繰り返し入力だけは「どの行を作ったか」を端末に控えて
   * あとから積み直せるようにするため、呼び出し側が採ったIDを渡してくる
   * (積み直しでも同じIDを使うので、二重に入っても主キーが弾く)。
   */
  const add = useCallback(
    async (input: TransactionInput, id?: string) => {
      const op: PendingOp = {
        opId: crypto.randomUUID(),
        kind: 'insert',
        // 行IDをクライアント側で採番することで、未同期の行への
        // update/delete も同じIDで一貫して扱える
        id: id ?? crypto.randomUUID(),
        payload: input,
        queuedAt: new Date().toISOString(),
      }
      setPendingOps(appendOp(op))
      void flush()
    },
    [flush]
  )

  /**
   * 複数件をまとめて追加する (機能096 の分割保存で使う)。
   * 1件ずつ insert op を積むだけなので、オフラインでも失われない。
   * 途中で切れてもキューは順に必ず送られるので、最終的には全件そろう。
   * 1件がサーバーに拒否されたときは、flush が split_group 単位で隔離し、
   * 先に入っていた片割れも取り消す — 金額の一部だけが残ることはない。
   */
  const addMany = useCallback(
    async (inputs: readonly TransactionInput[]) => {
      if (inputs.length === 0) return
      const queuedAt = new Date().toISOString()
      let ops: PendingOp[] = loadQueue()
      for (const input of inputs) {
        ops = appendOp({
          opId: crypto.randomUUID(),
          kind: 'insert',
          id: crypto.randomUUID(),
          payload: input,
          queuedAt,
        })
      }
      setPendingOps(ops)
      void flush()
    },
    [flush]
  )

  const update = useCallback(
    async (id: string, input: TransactionInput) => {
      logUpdate(id, input)
      const op: PendingOp = {
        opId: crypto.randomUUID(),
        kind: 'update',
        id,
        payload: input,
        queuedAt: new Date().toISOString(),
      }
      setPendingOps(appendOp(op))
      void flush()
    },
    [flush, logUpdate]
  )

  /**
   * 複数行をまとめて更新する。1件ずつ update と同じ op をキューに積むだけなので、
   * オフラインでも未同期のまま失われない(「過去にも適用」の一括変更で使う)。
   */
  const updateMany = useCallback(
    async (updates: { id: string; input: TransactionInput }[]) => {
      if (updates.length === 0) return
      const queuedAt = new Date().toISOString()
      let ops: PendingOp[] = loadQueue()
      for (const u of updates) {
        logUpdate(u.id, u.input)
        ops = appendOp({
          opId: crypto.randomUUID(),
          kind: 'update',
          id: u.id,
          payload: u.input,
          queuedAt,
        })
      }
      setPendingOps(ops)
      void flush()
    },
    [flush, logUpdate]
  )

  const remove = useCallback(
    async (id: string) => {
      // 利用者が自分で消した記録は、繰り返し入力の回復対象から必ず外す。
      // ここを忘れると「消したはずの家賃」が次の起動でよみがえる
      forgetGeneratedMarks([id])
      const before = txRef.current.find((t) => t.id === id)
      if (before) {
        logRemoved(before)
        // 編集シートからの削除も取り消せるようにする(機能159)
        armUndo([before])
      }
      const op: PendingOp = {
        opId: crypto.randomUUID(),
        kind: 'delete',
        id,
        queuedAt: new Date().toISOString(),
      }
      setPendingOps(appendOp(op))
      void flush()
    },
    [flush, logRemoved, armUndo]
  )

  /**
   * 複数行をまとめて削除する (機能146 / 149 / 151 からの削除)。
   * 1件ずつ delete op をキューに積むだけなので、オフラインでも失われない。
   * 削除した行はそのまま取り消し用に持っておく(機能159)。
   */
  const removeMany = useCallback(
    async (txs: readonly Transaction[]) => {
      if (txs.length === 0) return
      // まとめての削除も「利用者が自分で消した」ことに変わりはない(remove と同じ)
      forgetGeneratedMarks(txs.map((t) => t.id))
      const queuedAt = new Date().toISOString()
      let ops: PendingOp[] = loadQueue()
      for (const t of txs) {
        logRemoved(t)
        ops = appendOp({ opId: crypto.randomUUID(), kind: 'delete', id: t.id, queuedAt })
      }
      setPendingOps(ops)
      armUndo(txs)
      void flush()
    },
    [flush, logRemoved, armUndo]
  )

  /**
   * 削除の取り消し (機能159)。同じ行IDで入れ直す。
   *
   * キューから delete op を抜き取るのではなく、あとに insert op を積む方式にしている。
   * 抜き取る方式だと「まさに送信中だった delete」と競合し、
   * サーバー上は消えたのに取り消せたつもりになる = データを失う恐れがあるため。
   * delete → insert の順で送れば、どちらのタイミングでも最後は「在る」に落ち着く。
   *
   * 共有ページのコメントとの結び付きも、行IDを変えないことで戻る。
   * ただし「縁が切れない」わけではない — delete がサーバーに届いた瞬間、
   * コメントは *見えなくなる*(共有ページの関数が transactions と join しているため)。
   * 以前は partner_share_comments の外部キーが on delete cascade で、
   * この瞬間にコメントが **物理削除** され、同じIDで入れ直しても戻らなかった。
   * 外部キーを外して orphan を許すようにしたので、いまは行を戻せば
   * コメントもそのまま戻る(supabase/migration-partner-share.sql)。
   */
  const restoreMany = useCallback(
    async (txs: readonly Transaction[]) => {
      if (txs.length === 0) return
      const queuedAt = new Date().toISOString()
      let ops: PendingOp[] = loadQueue()
      for (const t of txs) {
        ops = appendOp({
          opId: crypto.randomUUID(),
          kind: 'insert',
          id: t.id,
          payload: restoreInput(t),
          queuedAt,
        })
        recordChange(newEntry(t.id, 'restore', transactionSummary(t, categoryLabel), []))
      }
      setPendingOps(ops)
      dismissUndo()
      void flush()
    },
    [flush, dismissUndo]
  )

  // ---------- 隔離した記録の再送・破棄 ----------

  /**
   * 隔離した記録をもう一度キューに積む(設定シートの「再送する」)。
   *
   * キューに積めたことを確かめてから隔離箱を空にする。順番を逆にすると、
   * 積み損ねた瞬間に記録が消える。
   * op はそのままの行ID・内容で積み直すので、同じ会計が二重に増えることはない。
   */
  const retryQuarantined = useCallback(
    async (entryId: string) => {
      const entry = findQuarantineEntry(entryId)
      if (!entry) return
      const queuedAt = new Date().toISOString()
      let ops: PendingOp[] = loadQueue()
      for (const op of entry.ops) {
        ops = appendOp({ ...op, opId: crypto.randomUUID(), queuedAt })
      }
      setPendingOps(ops)
      const queued = loadQueue()
      if (entry.ops.every((op) => queued.some((q) => q.id === op.id && q.kind === op.kind))) {
        discardQuarantineEntry(entryId)
      }
      await flush()
    },
    [flush]
  )

  /** 隔離した記録を捨てる(設定シートの「破棄する」)。利用者の明示操作だけで呼ぶこと */
  const discardQuarantined = useCallback((entryId: string) => {
    // 「破棄する」も利用者の明示操作。繰り返し入力の控えも一緒に忘れないと、
    // 破棄したはずの記録が次の起動で積み直されてしまう
    const entry = findQuarantineEntry(entryId)
    if (entry) forgetGeneratedMarks(entry.ops.map((o) => o.id))
    discardQuarantineEntry(entryId)
    // 隔離箱が空になったら、残っていた拒否の案内も役目を終える
    if (quarantineCount() === 0) setErrorGuide((prev) => (prev?.kind === 'rejected' ? null : prev))
  }, [])

  /** 取り消しバーの「元に戻す」。直前に削除した行をまとめて戻す (機能159) */
  const undoDelete = useCallback(async () => {
    if (!undoableDeletes) return
    await restoreMany(undoableDeletes)
  }, [undoableDeletes, restoreMany])

  // 表示用: サーバースナップショット + 保留キューの楽観的マージ
  const transactions = useMemo(
    () => applyPendingOps(serverTx, pendingOps),
    [serverTx, pendingOps]
  )

  // 変更履歴の「変更前」を引くための参照を最新に保つ
  useEffect(() => {
    txRef.current = transactions
  }, [transactions])

  /**
   * 引き下げて更新 (機能154)。取り込みと保留分の再送をまとめて行う。
   * 「更新した気になったのに未同期のまま」を防ぐため、順番は flush → refresh。
   */
  const syncNow = useCallback(async () => {
    await flush()
    await refresh()
  }, [flush, refresh])

  // 同期できずに隔離した記録。0件でない限り画面に出し続ける
  // (利用者が中身を確かめて再送/破棄するまで、勝手に消えない)
  const quarantined = useQuarantine()

  // 1行しか置けない場所(テストや将来の呼び出し側)のために畳んだ形も返す。
  // 画面に出すのは errorGuide のほう — 畳んだ文字列を分類し直させないこと
  const error = errorGuide ? formatGuidance(errorGuide) : null

  return {
    transactions,
    loading,
    error,
    errorGuide,
    refresh,
    syncNow,
    add,
    addMany,
    update,
    updateMany,
    remove,
    removeMany,
    restoreMany,
    // 機能159: 直前の削除(数秒だけ取り消せる)
    undoableDeletes,
    undoDelete,
    dismissUndo,
    // 同期できずに隔離した記録(中身の確認・再送・破棄)
    quarantined,
    retryQuarantined,
    discardQuarantined,
    pendingCount: pendingOps.length,
    isOnline,
    syncing,
    lastSyncedAt,
  }
}
