import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import SharePage from './components/SharePage'
import { parseShareToken } from './lib/shareRoute'
import { installPrivacyShield } from './lib/privacyShield'
import './styles.css'
// 広い画面(PC)向けの上乗せ。狭い画面には一切効かないよう、
// 中身はすべて min-width のメディアクエリか、タッチ端末では発火しない指定にしてある
import './desktop.css'

// 彼女に渡す閲覧専用の共有ページ (機能179) は、URL のハッシュだけで分岐する。
// ここで分けているのは、共有ページがアプリ本体(App)を一切マウントしないため。
// App をマウントすると Supabase のログイン処理が走ってしまい、
// 「ログイン不要で開ける」「本体のログイン状態に影響しない」が守れなくなる。
const shareToken = parseShareToken(window.location.hash)

// アプリ切替時の目隠し (機能208)。React の外側に置くのは、
// 描画の都合(再レンダリング待ち)に左右されず、離れた瞬間に必ず被せるため。
// 共有ページも金額を出すので、同じ扱いにする。
installPrivacyShield()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{shareToken ? <SharePage token={shareToken} /> : <App />}</React.StrictMode>
)
