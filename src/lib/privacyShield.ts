// ============================================================
// アプリ切替時に画面を隠す (機能208) — DOM 側の実装
//
// 判定と設定の読み書きは privacyBlur.ts の純粋関数に任せ、ここは
// 「いつ・どの要素にクラスを付けるか」だけを持つ。
//
// 速さを最優先している理由:
//   iOS はアプリを背面に送った直後にスクリーンショットを撮る。JS で要素を
//   作ってから被せると間に合わないので、目隠しは起動時に作って DOM に置きっぱなしにし、
//   離れた瞬間は opacity を 0 → 1 に変えるだけにしている。
//   opacity だけの変更は合成(コンポジット)だけで済むため、レイアウトや再ラスタライズを
//   伴う filter: blur() を後から掛けるより速く画面に出る。
//   同じ理由で、覆いはぼかしではなく不透明な面にしてある(styles.css の .privacy-shield)。
//   戻ったときも即座(トランジションなし)に消える。
// ============================================================

import { useSyncExternalStore } from 'react'
import {
  PRIVACY_BLUR_HINT_KEY,
  PRIVACY_BLUR_KEY,
  parseEnabled,
  parseHintCount,
  resolveEnabled,
  serializeEnabled,
  shouldShield,
  shouldShowHint,
} from './privacyBlur'

const SHOWN_CLASS = 'privacy-shield-shown'
const HINT_MS = 6000
/** バーから止めたあと、どこで戻せるかを伝える一言 (設定シートの見出しと同じ言い方にする) */
const RESTORE_NOTE = '設定の「アプリ切替時に画面を隠す」から戻せます'

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    // プライベートブラウズ等で localStorage が使えない環境では既定で動かす
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // 保存できなくても、このセッションの挙動は変わらない
  }
}

/** 目隠しの本体。起動時に1枚だけ作って使い回す */
function createShield(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'privacy-shield'
  // 表示中もスクリーンリーダーの読み上げ対象にはしない(内容は飾りのため)
  el.setAttribute('aria-hidden', 'true')

  const inner = document.createElement('div')
  inner.className = 'privacy-shield-inner'

  const title = document.createElement('div')
  title.className = 'privacy-shield-title'
  title.textContent = '家計簿'

  const note = document.createElement('div')
  note.className = 'privacy-shield-note'
  note.textContent = '画面を隠しています'

  inner.append(title, note)
  el.append(inner)
  return el
}

/**
 * 「もう隠さない」への近道。目隠しが出たあとの数回だけ小さく出す。
 *
 * 設定シートに恒久的な行ができたあとも残しているのは、止めたいと思うのが
 * 「いま覆いが出た直後」だからで、そのときに設定を探しに行かせないため。
 * 押すと localStorage に off が入る。戻し方は下の showRestoreNote で必ず伝える。
 */
function createHint(onDisable: () => void): HTMLElement {
  const el = document.createElement('div')
  el.className = 'privacy-hint'

  const text = document.createElement('span')
  text.className = 'privacy-hint-text'
  text.textContent = '離れている間、画面を隠しました'

  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = 'privacy-hint-btn'
  btn.textContent = 'もう隠さない'
  btn.addEventListener('click', onDisable)

  el.append(text, btn)
  return el
}

/**
 * バーの中身を「設定から戻せます」に差し替える。
 * 押したその場で戻し方を見せないと、バーが出なくなったあとに詰まってしまう。
 */
function fillRestoreNote(el: HTMLElement): void {
  const text = document.createElement('span')
  text.className = 'privacy-hint-text'
  text.textContent = RESTORE_NOTE
  el.replaceChildren(text)
}

export type PrivacyShieldHandle = {
  isEnabled: () => boolean
  setEnabled: (enabled: boolean) => void
  /** テストや開発時に手で外すため */
  destroy: () => void
}

/**
 * 目隠しを取り付ける。ブラウザ以外(テスト等)では何もしない。
 * 二重に呼ばれても1枚しか作らない。
 */
export function installPrivacyShield(): PrivacyShieldHandle | null {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null
  if (document.querySelector('.privacy-shield')) return null

  let enabled = parseEnabled(readStorage(PRIVACY_BLUR_KEY))
  let shown = false
  let hintTimer: number | undefined
  // 読み込み直後(バックグラウンドのタブで開かれた等)は「離れて戻ってきた」ではないので、
  // 導線を出さないための目印
  let primed = false

  const shield = createShield()
  document.body.append(shield)

  let hint: HTMLElement | null = null

  const hideHint = () => {
    if (hintTimer !== undefined) {
      window.clearTimeout(hintTimer)
      hintTimer = undefined
    }
    hint?.remove()
    hint = null
  }

  const disable = () => {
    enabled = false
    writeStorage(PRIVACY_BLUR_KEY, serializeEnabled(false))
    setShown(false)
    notify()
    // バーは消さずに中身だけ差し替える。開いている設定シートがあれば
    // そちらの表示も notify() で「隠さない」に切り替わる
    if (hint) {
      fillRestoreNote(hint)
      if (hintTimer !== undefined) window.clearTimeout(hintTimer)
      hintTimer = window.setTimeout(hideHint, HINT_MS)
    }
  }

  const showHint = () => {
    const count = parseHintCount(readStorage(PRIVACY_BLUR_HINT_KEY))
    writeStorage(PRIVACY_BLUR_HINT_KEY, String(count + 1))
    if (!shouldShowHint(count)) return
    hideHint()
    hint = createHint(disable)
    document.body.append(hint)
    hintTimer = window.setTimeout(hideHint, HINT_MS)
  }

  function setShown(next: boolean): void {
    if (shown === next) return
    shown = next
    document.documentElement.classList.toggle(SHOWN_CLASS, next)
  }

  // フォーカスの有無はイベントそのものから持つ。
  // blur が飛んだ瞬間に document.hasFocus() がまだ true を返すブラウザがあり、
  // 問い合わせに頼ると「離れたのに隠れない」が起きるため。
  let focused = document.hasFocus()

  const update = () => {
    if (!enabled) {
      setShown(false)
      return
    }
    const away = shouldShield({ hidden: document.hidden, focused })
    if (!away && shown) {
      // 戻ってきた直後にだけ、オフにする導線を出す(数回で止まる)
      setShown(false)
      if (primed) showHint()
      return
    }
    setShown(away)
  }

  const onBlur = () => {
    focused = false
    update()
  }
  const onFocus = () => {
    focused = true
    update()
  }
  const onPageShow = () => {
    // bfcache から戻ったときは状態を取り直す
    focused = document.hasFocus()
    update()
  }
  const onVisibility = () => {
    // 画面が戻ったのに focus イベントが飛んでこないブラウザがあるため、
    // 見えるようになった時点で実際の状態を取り直す(取りこぼすと目隠しが残ってしまう)
    if (!document.hidden) focused = document.hasFocus()
    update()
  }
  // 最後の保険。操作できている = 本人が画面を見ている以上、目隠しは残していてはいけない。
  // 上のどのイベントも来ない環境に当たっても、ここで必ず解ける。
  // pointerdown ではなく click を見るのは、押し始めで目隠しを外すと
  // そのタップが下のボタンに届いてしまう可能性があるため
  // (click の時点では、対象は最前面にいた目隠し自身に確定している)。
  const onUserActivity = () => {
    if (!shown) return
    focused = true
    update()
  }

  // visibilitychange だけでは iOS のタブ一覧に間に合わないことがあるため blur も見る。
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('blur', onBlur)
  window.addEventListener('focus', onFocus)
  window.addEventListener('pageshow', onPageShow)
  document.addEventListener('click', onUserActivity, true)
  document.addEventListener('keydown', onUserActivity, true)
  update()
  primed = true

  const handle: PrivacyShieldHandle = {
    isEnabled: () => enabled,
    setEnabled: (next: boolean) => {
      enabled = next
      writeStorage(PRIVACY_BLUR_KEY, serializeEnabled(next))
      // オンに戻したときは、いま覆いが要る状態かどうかをその場で計算し直す。
      // 再読み込みを待たせない (設定シートは覆いの上には出ないので、
      // 実際にはこの場で被さることはなく、次に離れたときから効く)
      update()
      notify()
    },
    destroy: () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('click', onUserActivity, true)
      document.removeEventListener('keydown', onUserActivity, true)
      hideHint()
      shield.remove()
      document.documentElement.classList.remove(SHOWN_CLASS)
      if (installed === handle) installed = null
      notify()
    },
  }

  installed = handle
  notify()
  return handle
}

// ============================================================
// 設定画面から触るための口
//
// 以前は window.kakeiboPrivacyShield に生やしていたが、
// グローバル変数はどこからでも差し替えられて型も付かないので、
// 設置済みのハンドルはこのモジュールの中だけで持ち回る。
// 画面側はこの下の関数とフックだけを使う。
// ============================================================

let installed: PrivacyShieldHandle | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

/** 設置済みの目隠し。まだ設置されていなければ null */
export function getPrivacyShield(): PrivacyShieldHandle | null {
  return installed
}

/**
 * いまオンかどうか。
 * 目隠しが設置されていない場面 (テスト等) でも設定は表示できるべきなので、
 * そのときは保存値から答える。
 */
export function getPrivacyBlurEnabled(): boolean {
  return resolveEnabled(installed?.isEnabled() ?? null, readStorage(PRIVACY_BLUR_KEY))
}

/**
 * オン・オフを切り替える。設置済みならその場で挙動まで変わる (再読み込みは要らない)。
 * 設置されていなければ保存だけしておき、次の起動から効かせる。
 */
export function setPrivacyBlurEnabled(enabled: boolean): void {
  if (installed) {
    installed.setEnabled(enabled) // 保存・反映・通知はハンドル側で済む
    return
  }
  writeStorage(PRIVACY_BLUR_KEY, serializeEnabled(enabled))
  notify()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * 現在の設定値。設定シートでの切り替えにも、目隠しのバーの「もう隠さない」にも追従する。
 * (両方から変わりうるので、React の state に写し取らず購読で受ける)
 */
export function usePrivacyBlurEnabled(): boolean {
  return useSyncExternalStore(subscribe, getPrivacyBlurEnabled, getPrivacyBlurEnabled)
}
