// ============================================================
// 書き出した CSV を端末に保存する (機能198)
//
// ---- なぜ保存方法を1つに決め打ちしないか ----
// 主な利用環境は iPhone の Safari で、しかも **ホーム画面に追加した PWA**
// (display: standalone) として開かれる。この2つで事情が違う:
//
//   * Safari のタブで開いているとき
//     `a[download]` + `blob:` URL がそのまま効く。Safari 13 以降は
//     ダウンロードとして扱われ、「ファイル」アプリの Downloads に入る。
//   * ホーム画面から起動した PWA のとき
//     ここが問題で、iOS のバージョンによっては `a[download]` を押しても
//     **何も起きない**(ダウンロードの UI がそもそも無い時期があった)。
//     バックアップの導線が「押しても無反応」なのは最悪なので、
//     この場合は先に **共有シート**(Web Share API の files)を使う。
//     共有シートからなら「"ファイル"に保存」で確実に端末へ残せるし、
//     そのまま iCloud や自分宛のメッセージにも送れる — 端末が壊れたときのことを
//     考えると、むしろ端末の外に出せるほうがバックアップとして望ましい。
//
// どちらも使えないときの最後の逃げ道として、新しいタブに中身を表示する。
// 「保存はできなかったが、本文は手元にある(選択してコピーできる)」状態にする —
// 何も出さずに終わるより、記録を救える見込みが残る。
//
// 判断そのもの(chooseSaveMethod)は純粋関数にしてテストする。
// 実際の保存は DOM とブラウザの UI に触るのでテストできない。
// ============================================================

/** CSV の MIME 型。charset を明示して、開いた側が UTF-8 として扱えるようにする */
const CSV_MIME = 'text/csv;charset=utf-8'

/** 保存のやり方 */
export type SaveMethod = 'share' | 'download' | 'newtab'

export interface SaveEnv {
  /** Web Share API でファイルを共有できるか */
  canShareFiles: boolean
  /** a[download] が使えるか */
  canDownload: boolean
  /** ホーム画面から起動した PWA (standalone) か */
  standalone: boolean
}

/**
 * どのやり方で保存するかを決める。(純粋関数)
 *
 * standalone のときだけ共有シートを先にするのは上のコメントのとおり。
 * ふつうのタブでは、共有シートより「押したら保存される」ほうが手数が少ない。
 */
export function chooseSaveMethod(env: SaveEnv): SaveMethod {
  if (env.standalone && env.canShareFiles) return 'share'
  if (env.canDownload) return 'download'
  if (env.canShareFiles) return 'share'
  return 'newtab'
}

/** 保存の結果。画面はこれを見て案内を出す */
export type SaveOutcome =
  | { kind: 'downloaded' }
  | { kind: 'shared' }
  /** 共有シートを閉じた(利用者の意思なので、失敗として扱わない) */
  | { kind: 'cancelled' }
  /** 新しいタブに表示した(手で保存/コピーしてもらう) */
  | { kind: 'opened' }
  | { kind: 'failed'; message: string }

/** a[download] が使えるか */
export function supportsDownload(): boolean {
  return typeof document !== 'undefined' && 'download' in document.createElement('a')
}

/** ホーム画面から起動した PWA か (iOS の Safari は navigator.standalone を持つ) */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true
  const displayMode =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  return iosStandalone || displayMode
}

/** そのファイルを共有できるか。canShare が無いブラウザでは false */
function canShareFile(file: File): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }
  if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false
  try {
    return nav.canShare({ files: [file] })
  } catch {
    return false
  }
}

/** 共有シートを閉じた(キャンセル)か */
function isAbort(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError'
}

/**
 * blob: URL を作って渡し、あとで確実に解放する。
 *
 * click した直後に revoke すると Safari ではダウンロードが始まらないことがあるので、
 * 少し待ってから解放する(解放が遅れても、そのタブを閉じれば消える程度の話)。
 */
function withObjectUrl(blob: Blob, use: (url: string) => void): void {
  const url = URL.createObjectURL(blob)
  try {
    use(url)
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}

/**
 * CSV を端末に保存する。
 *
 * text には BOM 付きの本文をそのまま渡すこと(csvExport.transactionsCsv の返り値)。
 * ここでは中身に一切手を触れない — 書き出す内容を決めるのは csvExport.ts の役目。
 */
export async function saveCsv(text: string, fileName: string): Promise<SaveOutcome> {
  const blob = new Blob([text], { type: CSV_MIME })
  // File が作れないブラウザ(かなり古い)では共有は諦めてダウンロードへ倒す
  let file: File | null = null
  try {
    file = new File([blob], fileName, { type: CSV_MIME })
  } catch {
    file = null
  }

  const method = chooseSaveMethod({
    canShareFiles: file !== null && canShareFile(file),
    canDownload: supportsDownload(),
    standalone: isStandaloneDisplay(),
  })

  if (method === 'share' && file) {
    try {
      await navigator.share({ files: [file] })
      return { kind: 'shared' }
    } catch (e) {
      if (isAbort(e)) return { kind: 'cancelled' }
      // 共有に失敗したときは黙って諦めず、ダウンロードで救う
    }
  }

  if (method === 'download' || supportsDownload()) {
    try {
      withObjectUrl(blob, (url) => {
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        // Safari では DOM に入っていない要素の click が無視されることがある
        a.style.display = 'none'
        document.body.appendChild(a)
        a.click()
        a.remove()
      })
      return { kind: 'downloaded' }
    } catch (e) {
      return {
        kind: 'failed',
        message: e instanceof Error ? e.message : '保存できませんでした',
      }
    }
  }

  // 最後の逃げ道: 新しいタブに表示して、手で保存/コピーしてもらう
  try {
    let opened: Window | null = null
    withObjectUrl(blob, (url) => {
      opened = window.open(url, '_blank')
    })
    if (!opened) {
      return {
        kind: 'failed',
        message: '新しいタブを開けませんでした。ブラウザのポップアップ設定を確認してください',
      }
    }
    return { kind: 'opened' }
  } catch (e) {
    return { kind: 'failed', message: e instanceof Error ? e.message : '保存できませんでした' }
  }
}
