// ============================================================
// 共有ページのルーティング (機能179)
//
// なぜハッシュ(#)なのか:
//   GitHub Pages は静的配信だけで、サーバー側の書き換え(rewrite)ができない。
//   /kakeibo/share/xxxx のような「本物のパス」で開くと 404 になるため、
//   404.html を置いて index.html に流す、という定番の回避策があるが
//   (1) HTTP ステータスが 404 のまま返るので、まれに中身を出さない環境がある
//   (2) PWA の Service Worker のキャッシュ対象と二重管理になる
//   という不安が残る。
//   ハッシュなら「/kakeibo/index.html を開いて、あとはブラウザの中の話」に
//   なるので、どのホスティングでも確実に成立する。
//   おまけに **# より後ろはサーバーに送られない** ので、秘密のトークンが
//   アクセスログや Referer に残らないという実利もある。
// ============================================================

/** 共有リンクのトークンとして許す形(16進48文字を想定。念のため幅を持たせる) */
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/

/**
 * location.hash から共有トークンを取り出す。(純粋関数)
 * `#/share/<token>` と `#share/<token>` の両方を受ける。
 * 形式が違えば null(= 通常のアプリを表示する)。
 */
export function parseShareToken(hash: string): string | null {
  if (!hash) return null
  // 先頭の '#' と '/' を落とす
  const path = hash.replace(/^#/, '').replace(/^\/+/, '')
  const m = /^share\/([^/?#]+)/.exec(path)
  if (!m) return null
  let token: string
  try {
    token = decodeURIComponent(m[1])
  } catch {
    return null
  }
  return TOKEN_RE.test(token) ? token : null
}

/**
 * 彼女に渡す共有URLを組み立てる。(純粋関数)
 * base は Vite の import.meta.env.BASE_URL(既定 '/kakeibo/')を渡す。
 */
export function buildShareUrl(origin: string, base: string, token: string): string {
  const cleanOrigin = origin.replace(/\/+$/, '')
  const cleanBase = base.startsWith('/') ? base : `/${base}`
  const withSlash = cleanBase.endsWith('/') ? cleanBase : `${cleanBase}/`
  return `${cleanOrigin}${withSlash}#/share/${token}`
}
