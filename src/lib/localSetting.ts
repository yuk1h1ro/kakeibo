// ============================================================
// 端末ごとの設定を1つ、localStorage に持つためのストア
//
// テンキーの設定・金額の目隠し・月の予算 …… のように
// 「サーバーには置かない、この端末だけの見え方」の置き場が同じ形になるように
// まとめたもの。集めているのは **入れ物の作法だけ** で、
// 何を既定にするか・どう読むか・どう書くかは呼ぶ側が spec で渡す。
// (テーブルの有無を覚える tableAvailability.ts と同じ作り方)
//
// **既定値と直列化はここに持ち込まないこと。**
// 例えば金額の目隠し(機能169)は既定オフ、アプリ切替時の目隠し(機能208)は
// 既定オン ——「金額を隠す」に見えて意味が逆で、既定を1つに揃えると
// その判断が消える。だから既定は必ず引数で受け、ここでは触らない。
//
// ---- localStorage が使えない / 値が壊れているとき ----
// **例外は絶対に外へ出さない。** プライベートブラウズや容量超過で
// 起動そのものが止まるのを避けるため、読めなければ既定で、
// 書けなければ「この起動中だけ反映される」形で動かす。
// これは寄せる前の14モジュールが1つ残らずそう書いていた振る舞いで、
// 変えずにそのまま持ってきている。
// ============================================================

export interface LocalSetting<T> {
  /**
   * いまの値。useSyncExternalStore のスナップショットとしてそのまま使えるよう、
   * set / clear を呼ぶまで同じ参照を返す(毎回作り直すと再描画が止まらなくなる)。
   */
  get(): T
  /** 値を変えて保存し、購読者に知らせる。保存できなくてもこの起動中は反映される */
  set(next: T): void
  /** 既定に戻し、保存値そのものを消す(「まだ触っていない」状態に戻す) */
  clear(): void
  subscribe(listener: () => void): () => void
}

export interface LocalSettingSpec<T> {
  /** localStorage のキー。**既存端末のデータを読めなくするので変えないこと** */
  key: string
  /** 保存値が無い / 読めないときの値 */
  fallback: T
  /**
   * 保存されている文字列から値を読む。
   * 読めない値は null を返す(= fallback)。例外を投げても fallback に倒れる。
   */
  parse: (raw: string | null) => T | null
  /**
   * 保存する文字列。**null を返すとキーごと消す**
   * (「未設定」と「その値」を区別する設定のため。月の予算の 0 と未設定の違いなど)
   */
  serialize: (value: T) => string | null
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // プライベートブラウズ等で localStorage が使えない環境では既定で動かす
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // 保存できなくても、この起動中は設定したとおりに動く
  }
}

/**
 * 設定1つぶんのストアを作る。**読み込みはこの場で1回だけ**行う
 * (モジュールの読み込み時に決まり、以後はこのストアが持つ値が正)。
 */
export function createLocalSetting<T>(spec: LocalSettingSpec<T>): LocalSetting<T> {
  const load = (): T => {
    try {
      return spec.parse(readRaw(spec.key)) ?? spec.fallback
    } catch {
      // 壊れた JSON など。既定に戻るだけで、起動は止めない
      return spec.fallback
    }
  }

  let current: T = load()
  const listeners = new Set<() => void>()

  function notify(): void {
    for (const l of listeners) l()
  }

  return {
    get: () => current,
    set(next) {
      current = next
      write(spec.key, spec.serialize(next))
      notify()
    },
    clear() {
      current = spec.fallback
      write(spec.key, null)
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
