import { useState } from 'react'
import { saveConfig, normalizeUrl } from '../lib/supabaseClient'

export default function SetupScreen({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState('')
  const [anonKey, setAnonKey] = useState('')

  const valid = url.trim().startsWith('https://') && anonKey.trim().length > 20

  // パス付きURL(Callback URL など)や見慣れないホストが貼られた場合に、
  // 保存時の自動調整結果をプレビュー表示する(エラーにはしない)
  const trimmedUrl = url.trim()
  const normalizedUrl = normalizeUrl(url)
  const needsAdjustHint =
    trimmedUrl.length > 0 &&
    (!trimmedUrl.includes('.supabase.co') || normalizedUrl !== trimmedUrl.replace(/\/+$/, ''))

  return (
    <div className="auth-screen">
      <h1>家計簿 — 初期設定</h1>
      <p className="muted">
        Supabase プロジェクトの接続情報を入力してください。この端末のブラウザにのみ保存されます。
        (Supabase ダッシュボード → Settings → API で確認できます)
      </p>
      <p className="muted">
        Settings → API の <strong>Project URL</strong> を貼り付けてください(Callback URL や API
        Keys ページのURLではありません)。
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
          {needsAdjustHint && (
            <span className="muted">
              保存時に <code>https://xxxx.supabase.co</code> の形に自動調整されます(保存される値:{' '}
              {normalizedUrl})
            </span>
          )}
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
