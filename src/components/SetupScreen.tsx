import { useState } from 'react'
import { saveConfig } from '../lib/supabaseClient'

export default function SetupScreen({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState('')
  const [anonKey, setAnonKey] = useState('')

  const valid = url.trim().startsWith('https://') && anonKey.trim().length > 20

  return (
    <div className="auth-screen">
      <h1>家計簿 — 初期設定</h1>
      <p className="muted">
        Supabase プロジェクトの接続情報を入力してください。この端末のブラウザにのみ保存されます。
        (Supabase ダッシュボード → Settings → API で確認できます)
      </p>
      <div className="form-col">
        <label className="field">
          <span>Project URL</span>
          <input
            type="url"
            placeholder="https://xxxx.supabase.co"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <label className="field">
          <span>anon public キー</span>
          <textarea
            rows={4}
            placeholder="eyJhbGciOi..."
            value={anonKey}
            onChange={(e) => setAnonKey(e.target.value)}
          />
        </label>
        <button
          className="btn-primary"
          disabled={!valid}
          onClick={() => {
            saveConfig(url, anonKey)
            onSaved()
          }}
        >
          保存して始める
        </button>
      </div>
    </div>
  )
}
