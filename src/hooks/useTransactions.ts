import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Transaction, TransactionInput } from '../lib/types'
import {
  appendOps,
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
import { createSyncNotifier } from '../lib/syncNotifier'
import {
  featureToDrop,
  initTxExtensions,
  markTxFeatureUnavailable,
  stripUnavailableColumns,
} from '../lib/txExtensions'
import {
  isDuplicateRowError,
  isNetworkError,
  isOnlineNow,
  isSchemaError,
  type ServerErrorLike,
} from '../lib/serverErrors'
import { guidanceForServerError, type Guidance } from '../lib/errorGuidance'
import { judgeRejection } from '../lib/syncRejection'
import {
  applyPendingOps,
  loadLastSyncedAt,
  loadTxCache,
  normalizeRows,
  saveLastSyncedAt,
  saveTxCache,
} from '../lib/txSnapshot'
import { useUndoableDeletes } from './useUndoableDeletes'
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

// 送る1件の形は lib/types.ts に置いてある(lib のモジュールも使うので、
// hooks に置くと lib から hooks へ逆向きに依存することになる)。
// 画面やテストが従来どおりここから読めるよう、型だけ再エクスポートする
export type { TransactionInput }

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

// エラー文言は lib/errorGuidance.ts が組み立てる (機能161)。
// ここに固定文言を置いていた頃は migration-store.sql の決め打ちで、
// タグ・分割・返金など別の列が足りないときにも「store の SQL を実行してください」と
// 間違ったファイルを案内していた。サーバーの code / details / hint が生きているのは
// この場所だけなので、ここで分類すれば正しい SQL を名指しできる。
//
// 端末に持つ写し(キャッシュ・最終同期時刻・キューを重ねた一覧)は lib/txSnapshot.ts、
// 断られた1件の見分けは lib/syncRejection.ts、同期中の Discord 通知は lib/syncNotifier.ts。

export function useTransactions(supabase: SupabaseClient) {
  const [serverTx, setServerTx] = useState<Transaction[]>(() => loadTxCache() ?? [])
  const [pendingOps, setPendingOps] = useState<PendingOp[]>(() => loadQueue())
  // キャッシュがあれば即表示できるので loading にしない
  const [loading, setLoading] = useState(() => loadTxCache() === null)
  // エラーは「原因 + 次の行動」の構造のまま持つ (機能161)。
  // 文字列にしてから画面側で分類し直すと、畳んだ文言をもう一度ほどくことになり、
  // 案内が二重に出てしまうため(MainScreen は errorGuide をそのまま描く)。
  const [errorGuide, setErrorGuide] = useState<Guidance | null>(null)
  const [isOnline, setIsOnline] = useState(isOnlineNow)
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
    if (!isOnlineNow()) {
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
      // flush の最中に呼ばれるので、ここでは送りに行かない(積むだけ)
      if (siblings.length > 0) {
        ops = appendOps(
          siblings.map((row) => ({ opId: crypto.randomUUID(), kind: 'delete' as const, id: row.id, queuedAt: now }))
        )
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
    // 彼女への通知(分割は内訳が揃ってから1通にまとめる)。同期1回ごとに作り直す
    const notifier = createSyncNotifier(localRows)
    try {
      for (;;) {
        const queue = loadQueue()
        if (queue.length === 0) break
        const op = queue[0]
        notifier.beforeOp(op)
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
            // 彼女が払った額・タグ・分割・おごりの列も「無くても記録の本体は
            // 成り立つ」ので、その列だけ諦めてやり直す(どの列がどの機能かは
            // txExtensions.ts の表 1つ)。partner_paid が落ちれば自分が全額払った扱い、
            // split_group が落ちれば束ねだけが消え、tags が落ちればタグだけ、
            // favor_* が落ちれば「誰にご馳走になったか」だけが付かない — 金額は必ず残る。
            // ただし全額おごりの 0円 は、列を落としても金額の制約に弾かれる —
            // それは下の isFavorAmountRejection が見分けて案内する
            const feature = featureToDrop(op.payload ?? {})
            if (feature !== null) {
              markTxFeatureUnavailable(feature)
              continue
            }
          }
          // ここから先は「サーバーに届いたうえで断られた」失敗。
          // 直せる失敗(migration 未実行)か、直しようのない拒否(制約違反)かで
          // 扱いを変えるが、**どちらでも op を捨てない** のは共通の約束。
          // 見分け方と案内の文言は syncRejection.ts
          const { guide, retryable, ledgerRejected } = judgeRejection(err, op.payload, isOnlineNow())
          if (ledgerRejected) {
            // 返金・調整の種別が DB のチェック制約に無い = migration 未実行。
            // 導線を閉じて、これ以上同じ失敗を増やさない
            markTxFeatureUnavailable('settlement')
          }
          const attempts = recordSyncFailure(op.opId)
          // 送り直せば通る見込みがあるのは migration 系だけ(retryable)。
          // それ以外(制約違反など)は何度送っても同じなので、すぐ隔離する
          if (!retryable || reachedAttemptLimit(attempts)) {
            // 同じ op が何度も断られると、その後ろの記録がすべて送れなくなる。
            // 記録は隔離箱(localStorage)に移して必ず残したうえで、先へ進む
            // 断られた内訳の会計は、先に入った内訳ごと取り消される。
            // まとめていた通知は送らずに捨て、取り消しの削除も知らせない
            notifier.cancelled(op)
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
          notifier.sent(op, localRows, nextRows)
          localRows = nextRows
          // 進めた手元のスナップショットは、この flush を抜けても引き継ぐ。
          // ここを flush の中の変数だけに留めていたころは、serverTxRef が
          // 「キューが空になったときの refresh()」でしか進まず、圏外で送信が
          // 途中で切れると、次の flush が **成功済みの op を含まない古い写し** から
          // 残高を計算し直していた(彼女の Discord に古い残高が届く原因)。
          // 同じ理由で、隔離するときの「すでにサーバーへ入った分割の片割れ」も
          // 見つけられなかった。通信を増やさずに直せるよう、手元の写しを進める。
          serverTxRef.current = nextRows
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
      // 圏外で途中まで送れた会計も、送れた分だけで1通にして出す
      notifier.finish()
      flushingRef.current = false
      setSyncing(false)
    }
    // 全部さばけたらサーバーの真の状態を取り直す
    if (flushedSomething && loadQueue().length === 0) {
      await refresh()
    }
  }, [supabase, refresh, quarantineFromQueue])

  /**
   * キューに積んで、すぐ送りに行く。追加・更新・削除・取り消し・取りこぼしの
   * 回復はみなここを通す(以前は同じ手順を10か所で書いていた)。
   * opId と積んだ時刻はここで決める。積む順番がそのまま送る順番。
   * flush の中(quarantineFromQueue)からは呼ばないこと — 送信中に送信を重ねない
   */
  const enqueue = useCallback(
    (ops: readonly Omit<PendingOp, 'opId' | 'queuedAt'>[]) => {
      if (ops.length === 0) return
      const queuedAt = new Date().toISOString()
      setPendingOps(appendOps(ops.map((op) => ({ ...op, opId: crypto.randomUUID(), queuedAt }))))
      void flush()
    },
    [flush]
  )

  // マウント時: まずキャッシュ表示 → サーバーから取得 → 保留分を再送
  useEffect(() => {
    void refresh().then(() => flush())
  }, [refresh, flush])

  // 変更履歴 (機能163)。テーブルが無ければ静かに無効化されるだけで、
  // 記録・入力・同期には一切影響しない。貯まっていた履歴もここで送る
  useEffect(() => {
    void initChangeLog(supabase)
  }, [supabase])

  // 後から足した列 (partner_paid / tags / split_group / favor_*) がこの環境にあるか。
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
    // 控えに残した行IDをそのまま使う。二重になっても主キーが弾く
    enqueue(lost.map((m) => ({ kind: 'insert', id: m.txId, payload: m.input })))
  }, [loading, serverSynced, pendingOps.length, serverTx, enqueue])

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
  const { undoableDeletes, armUndo, dismissUndo } = useUndoableDeletes()

  /**
   * 1件追加する。
   *
   * `id` は通常渡さない。繰り返し入力だけは「どの行を作ったか」を端末に控えて
   * あとから積み直せるようにするため、呼び出し側が採ったIDを渡してくる
   * (積み直しでも同じIDを使うので、二重に入っても主キーが弾く)。
   */
  const add = useCallback(
    async (input: TransactionInput, id?: string) => {
      // 行IDをクライアント側で採番することで、未同期の行への
      // update/delete も同じIDで一貫して扱える
      enqueue([{ kind: 'insert', id: id ?? crypto.randomUUID(), payload: input }])
    },
    [enqueue]
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
      enqueue(inputs.map((input) => ({ kind: 'insert', id: crypto.randomUUID(), payload: input })))
    },
    [enqueue]
  )

  const update = useCallback(
    async (id: string, input: TransactionInput) => {
      logUpdate(id, input)
      enqueue([{ kind: 'update', id, payload: input }])
    },
    [enqueue, logUpdate]
  )

  /**
   * 複数行をまとめて更新する。1件ずつ update と同じ op をキューに積むだけなので、
   * オフラインでも未同期のまま失われない(「過去にも適用」の一括変更で使う)。
   */
  const updateMany = useCallback(
    async (updates: { id: string; input: TransactionInput }[]) => {
      for (const u of updates) logUpdate(u.id, u.input)
      enqueue(updates.map((u) => ({ kind: 'update', id: u.id, payload: u.input })))
    },
    [enqueue, logUpdate]
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
      // 手元に見当たらない行でも delete は積む(サーバーにだけ残っている行のため)
      enqueue([{ kind: 'delete', id }])
    },
    [enqueue, logRemoved, armUndo]
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
      for (const t of txs) logRemoved(t)
      armUndo(txs)
      enqueue(txs.map((t) => ({ kind: 'delete', id: t.id })))
    },
    [enqueue, logRemoved, armUndo]
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
      for (const t of txs) {
        recordChange(newEntry(t.id, 'restore', transactionSummary(t, categoryLabel), []))
      }
      dismissUndo()
      enqueue(
        txs.map((t) => ({
          kind: 'insert',
          id: t.id,
          payload: restoreInput(t),
          // 彼女への通知を「元に戻しました」にする(新しい支出に見せない)
          restore: true,
        }))
      )
    },
    [enqueue, dismissUndo]
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
      setPendingOps(appendOps(entry.ops.map((op) => ({ ...op, opId: crypto.randomUUID(), queuedAt }))))
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
  const pendingIds = useMemo(
    () => new Set(pendingOps.filter((op) => op.kind !== 'delete').map((op) => op.id)) as ReadonlySet<string>,
    [pendingOps]
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

  // 画面が使うものだけを返す。refresh・restoreMany・dismissUndo は中で使うだけ
  // (取り込み直しは syncNow、取り消しは undoDelete を通す)
  return {
    transactions,
    loading,
    errorGuide,
    syncNow,
    add,
    addMany,
    update,
    updateMany,
    remove,
    removeMany,
    // 機能159: 直前の削除(数秒だけ取り消せる)
    undoableDeletes,
    undoDelete,
    // 同期できずに隔離した記録(中身の確認・再送・破棄)
    quarantined,
    retryQuarantined,
    discardQuarantined,
    pendingCount: pendingOps.length,
    // まだサーバーに送れていない記録の行ID(履歴の行に「未同期」の印を付ける)
    pendingIds,
    isOnline,
    syncing,
    lastSyncedAt,
  }
}
