import { useState } from 'react'
import {
  clearGeminiKey,
  getGeminiKey,
  looksLikeGeminiKey,
  saveGeminiKey,
  testGeminiKey,
  type GeminiTestResult,
} from '../lib/receiptScan'
import useBodyScrollLock from '../hooks/useBodyScrollLock'

interface Props {
  onClose: () => void
  // 保存が完了したとき(閉じる処理は親が行う)
  onSaved?: () => void
}

// 表示用にキーを伏せる(先頭6文字+末尾4文字のみ)
function maskKey(key: string): string {
  if (key.length <= 10) return `${key.slice(0, 2)}…`
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

export default function GeminiKeySheet({ onClose, onSaved }: Props) {
  const [savedKey, setSavedKey] = useState<string | null>(() => getGeminiKey())
  const [input, setInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<GeminiTestResult | null>(null)

  // シートを開いている間は背面ページを固定する
  useBodyScrollLock()

  const trimmed = input.trim()
  const formatWarning = trimmed !== '' && !looksLikeGeminiKey(trimmed)

  const runTest = async (): Promise<GeminiTestResult> => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testGeminiKey()
      setTestResult(result)
      return result
    } finally {
      setTesting(false)
    }
  }

  // 保存は必ず成立させたうえで、続けて接続テストを走らせる。
  // 成功したらそのまま閉じ、失敗したらシートに原因を出して切り分けてもらう。
  const handleSave = async () => {
    if (!trimmed) return
    saveGeminiKey(trimmed)
    setSavedKey(trimmed)
    setInput('')
    const result = await runTest()
    if (result.ok) onSaved?.()
  }

  const handleClear = () => {
    clearGeminiKey()
    setSavedKey(null)
    setTestResult(null)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>レシート読み取りの設定</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <p className="muted gemini-desc">
          レシート読み取りにはGoogleの無料AI(Gemini)を使います。無料のAPIキーが必要です(クレジットカード不要)。
        </p>

        <ol className="gemini-steps">
          <li>
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              aistudio.google.com/apikey
            </a>{' '}
            を開く
          </li>
          <li>Googleアカウントでログイン</li>
          <li>
            「Create API key」を押してキーをコピー(コピーする値は <code>AIza</code> で始まります)
          </li>
        </ol>

        {savedKey ? (
          <>
            <p className="gemini-status">✓ APIキーは設定済みです</p>
            <p className="muted gemini-masked">{maskKey(savedKey)}</p>
            <div className="gemini-actions">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void runTest()}
                disabled={testing}
              >
                {testing ? 'テスト中…' : '接続テスト'}
              </button>
              <button type="button" className="btn-ghost" onClick={handleClear} disabled={testing}>
                解除
              </button>
            </div>
            {testResult && (
              <p
                className={
                  testResult.ok
                    ? 'gemini-test-result gemini-test-ok'
                    : 'error-text gemini-test-result'
                }
              >
                {testResult.ok ? `✅ ${testResult.message}` : testResult.message}
              </p>
            )}
          </>
        ) : (
          <div className="gemini-form">
            <label className="field">
              <span>APIキー</span>
              <div className="gemini-key-row">
                <input
                  type={showKey ? 'text' : 'password'}
                  placeholder="AIza..."
                  autoComplete="off"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-ghost gemini-eye"
                  aria-label={showKey ? 'キーを隠す' : 'キーを表示'}
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? '隠す' : '表示'}
                </button>
              </div>
            </label>
            {formatWarning && (
              <p className="gemini-warn" role="alert">
                ⚠ これはGemini APIキーではない可能性があります。Gemini APIキーは <code>AIza</code>{' '}
                で始まる39文字前後の文字列です。AI Studio のAPIキー一覧で <code>AIza…</code>{' '}
                と表示されている値をコピーしてください。
              </p>
            )}
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleSave()}
              disabled={!trimmed || testing}
            >
              {formatWarning ? 'このまま保存する' : '保存'}
            </button>
          </div>
        )}

        <div className="gemini-notes">
          <p className="muted">・キーはこの端末のブラウザにのみ保存されます</p>
          <p className="muted">・読み取り時、レシート画像はGoogleのAPIに送信されます</p>
        </div>
      </div>
    </div>
  )
}
