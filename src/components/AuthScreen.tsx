import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { clearConfig, getConfiguredUrl, hasStoredConfig } from '../lib/supabaseClient'
import { unsyncedCount, unsyncedWarningText } from '../lib/localData'
import { describeUnknownError, isOnlineNow } from '../lib/errorGuidance'

export default function AuthScreen({ supabase }: { supabase: SupabaseClient }) {
  const configuredUrl = getConfiguredUrl()
  const canReset = hasStoredConfig()

  const resetConfig = () => {
    // 何が消えるかを具体的に書く。未同期の記録はこの端末にしか無いので、
    // 残っているときは消させない (機能: 端末を貸す・売るときの後始末)
    const pending = unsyncedCount()
    if (pending > 0) {
      window.alert(unsyncedWarningText(pending))
      return
    }
    const ok = window.confirm(
      'Supabaseの接続設定を消して初期設定からやり直しますか?\n' +
        'この端末に残っている接続情報・ログイン状態・明細のキャッシュ・' +
        'APIキー等も消えます(サーバー上の家計簿のデータは消えません)',
    )
    if (!ok) return
    clearConfig()
    window.location.reload()
  }

  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loginWithGoogle = async () => {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    if (error) {
      // 原文だけでは何をすればいいか分からないので、原因と次の行動を添える (機能161)
      setError(`Googleでログインできませんでした。${describeUnknownError(error, isOnlineNow())}`)
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen">
      <h1>家計簿</h1>
      <button className="btn-google" disabled={busy} onClick={loginWithGoogle}>
        <svg className="google-logo" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          />
        </svg>
        Googleでログイン
      </button>
      <p className="muted auth-note">このアプリはGoogleアカウントでのみログインできます</p>
      {error && <p className="error-text auth-note">{error}</p>}
      {(configuredUrl || canReset) && (
        <div className="auth-footer">
          {configuredUrl && <span className="muted">接続先: {configuredUrl}</span>}
          {canReset && (
            <button className="btn-ghost" onClick={resetConfig}>
              接続設定をやり直す
            </button>
          )}
        </div>
      )}
    </div>
  )
}
