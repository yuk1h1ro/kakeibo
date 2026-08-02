import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'

export default function AuthScreen({ supabase }: { supabase: SupabaseClient }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const login = async () => {
    setBusy(true)
    setError(null)
    setInfo(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(`ログインに失敗しました: ${error.message}`)
    setBusy(false)
  }

  const loginWithGoogle = async () => {
    setBusy(true)
    setError(null)
    setInfo(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + import.meta.env.BASE_URL },
    })
    if (error) {
      setError(`Googleログインに失敗しました: ${error.message}`)
      setBusy(false)
    }
  }

  const signup = async () => {
    setBusy(true)
    setError(null)
    setInfo(null)
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) {
      setError(`登録に失敗しました: ${error.message}`)
    } else if (!data.session) {
      setInfo('確認メールを送信しました。メール内のリンクを開いてからログインしてください。')
    }
    setBusy(false)
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
      <div className="auth-divider">
        <span>または</span>
      </div>
      <div className="form-col">
        <label className="field">
          <span>メールアドレス</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>パスワード</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        {info && <p className="muted">{info}</p>}
        <button className="btn-primary" disabled={busy || !email || !password} onClick={login}>
          ログイン
        </button>
        <button className="btn-ghost" disabled={busy || !email || !password} onClick={signup}>
          初めての方はこちら(新規登録)
        </button>
      </div>
    </div>
  )
}
