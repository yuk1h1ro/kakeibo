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

import {
  PRIVACY_BLUR_HINT_KEY,
  PRIVACY_BLUR_KEY,
  parseEnabled,
  parseHintCount,
  serializeEnabled,
  shouldShield,
  shouldShowHint,
} from './privacyBlur'

const SHOWN_CLASS = 'privacy-shield-shown'
const HINT_MS = 6000

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
 * 「もう隠さない」への導線。
 * 設定シート(components 配下)に行を足せないため、目隠しが出たあとの数回だけ
 * 小さく出す。押すと localStorage に off が入り、以後この機能は動かない。
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
    hideHint()
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
      update()
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
    },
  }

  // 設定シートに行を足せていないため、オフにしたあと戻す手段として
  // コンソールから触れる口だけ用意しておく (window.kakeiboPrivacyShield.setEnabled(true))
  ;(window as unknown as Record<string, unknown>).kakeiboPrivacyShield = handle

  return handle
}
