// ============================================================
// 「後から足したテーブルが、このサーバーに在るか」の実行時判定
//
// store_categories / recurring_rules / transaction_templates …… は
// supabase/migration-*.sql を実行するまで存在しない。未実行のまま読み書きすると
// PostgREST が 42P01 などで弾くので、各モジュールは「無い」と分かった時点で
// サーバーへ行くのをやめ、その機能の導線を隠す。
//
// その **見分け方と覚え方** だけをここに集めている。同じ判定が9モジュールに
// 散っていて、直すときに1つ書き漏らすと「マイグレーション未実行が原因で
// 入力が失われる」に戻ってしまうため。
//   ・どのエラーをテーブル未作成と見なすかは serverErrors.ts の isSchemaError 1箇所
//   ・例外(catch した unknown)も同じ基準で見る。呼ぶ側で toServerError を
//     書き忘れると、そこだけ判定が甘くなるので noteError に吸わせている
//
// 判定結果は localStorage にも残す(remember: true が既定)。
// オフライン起動でも前回の答えを使えるので、通らないと分かっている書き込みを
// 試さずに済み、テーブルが無い機能の導線が一瞬出てから消えることもない。
// (取引の「列」を見る txExtensions.ts と同じ考え方を、テーブルに広げたもの)
//
// **検知したあとにどう振る舞うかは、ここには持ち込まない。**
// キャッシュを捨てるか残すかは各モジュールの設計判断で、
// recurringRules / transactionTemplates はテーブルが無いとき手元を空にするが、
// storeCategories は残す(学習は端末内で続く)。揃えてはいけない差分。
// ============================================================

import { isSchemaError, toServerError } from './serverErrors'

const KEY_PREFIX = 'kakeibo.tableMissing.'

export interface TableAvailability {
  /** テーブルが無いと分かっているか */
  isMissing(): boolean
  /** 「無い」と分かったときに呼ぶ。判定が変わったときだけ true */
  markMissing(): boolean
  /** 読み書きが通ったときに呼ぶ。判定が変わったときだけ true */
  markPresent(): boolean
  /**
   * エラー・例外を見て、テーブル未作成なら「無い」に倒す。
   * 戻り値は「そのエラーがテーブル未作成を意味するか」。
   * 寄せる前の各モジュールが書いていた isSchemaError(error) と同じ意味なので、
   * 「無いと分かったときだけ手元を空にする」といった後始末をそのまま書ける。
   */
  noteError(error: unknown): boolean
  subscribe(listener: () => void): () => void
  /** useSyncExternalStore 用。true = この機能を出してよい */
  getAvailableSnapshot(): boolean
  /** テスト用に、覚えている答え(localStorage を含む)を捨てる */
  resetForTest(): void
}

function readRemembered(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    // localStorage が使えない環境。既定は「在る」— 使えないと決めつけると、
    // 通信できないときに機能が消えてしまう(txExtensions.ts と同じ既定)
    return false
  }
}

function remember(key: string, missing: boolean): void {
  try {
    localStorage.setItem(key, missing ? '1' : '0')
  } catch {
    // 保存できなくても、この起動中は正しく動く
  }
}

/**
 * テーブル1つぶんの判定を作る。
 *
 * @param table 実際のテーブル名。localStorage のキーに使うので、
 *              モジュールごとに必ず違う名前にすること
 * @param options.remember 判定を localStorage に残すか(既定 true)。
 *              **起動のたびに必ず読みに行く経路が無いモジュールは false にする** —
 *              「無い」を覚えたまま誰も確かめ直さないと、マイグレーションを
 *              実行しても機能が戻らなくなるため
 */
export function createTableAvailability(
  table: string,
  options: { remember?: boolean } = {}
): TableAvailability {
  const persist = options.remember ?? true
  const key = KEY_PREFIX + table
  let missing = persist ? readRemembered(key) : false
  const listeners = new Set<() => void>()

  function set(next: boolean): boolean {
    if (missing === next) return false
    missing = next
    if (persist) remember(key, next)
    for (const l of listeners) l()
    return true
  }

  return {
    isMissing: () => missing,
    markMissing: () => set(true),
    markPresent: () => set(false),
    noteError(error) {
      if (!isSchemaError(toServerError(error))) return false
      set(true)
      return true
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    // 真偽値なので参照は常に安定する(スナップショットを作り直さない)
    getAvailableSnapshot: () => !missing,
    resetForTest() {
      missing = false
      try {
        localStorage.removeItem(key)
      } catch {
        // 使えない環境では何もしない
      }
    },
  }
}
