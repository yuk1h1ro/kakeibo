import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import SharePage from './components/SharePage'
import { parseShareToken } from './lib/shareRoute'
import './styles.css'

// 彼女に渡す閲覧専用の共有ページ (機能179) は、URL のハッシュだけで分岐する。
// ここで分けているのは、共有ページがアプリ本体(App)を一切マウントしないため。
// App をマウントすると Supabase のログイン処理が走ってしまい、
// 「ログイン不要で開ける」「本体のログイン状態に影響しない」が守れなくなる。
const shareToken = parseShareToken(window.location.hash)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{shareToken ? <SharePage token={shareToken} /> : <App />}</React.StrictMode>
)
