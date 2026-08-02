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
