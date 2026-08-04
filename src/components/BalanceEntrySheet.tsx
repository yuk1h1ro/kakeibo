import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordBalances, assetCategoryEmoji, type BalanceEntry } from '../lib/assets'
import { formatBalanceInput, parseBalanceInput, type AssetRow } from '../lib/netWorth'
import { todayISO, yen } from '../lib/format'
import useBodyScrollLock from '../hooks/useBodyScrollLock'

interface Props {
  supabase: SupabaseClient
  /** 記録対象(アーカイブ済みを除いた資産・負債と、その現在残高) */
  rows: AssetRow[]
  onClose: () => void
  onSaved: () => void
}

/**
 * 残高をまとめて記録するシート (機能101)。
 *
 * 月1回程度の記録を想定しているので、1件ずつではなく
 * 「その日の残高をまとめて1枚で書く」形にしている。
 * 前回の残高を初期値に入れてあるので、変わったものだけ直せば済む。
 */
export default function BalanceEntrySheet({ supabase, rows, onClose, onSaved }: Props) {
  useBodyScrollLock()

  const [asOf, setAsOf] = useState(todayISO())
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.asset.id, formatBalanceInput(r.balance)]))
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 入力途中の文字列はそのまま保持し、確定(blur)のときだけ整形する。
  // 打っている最中に桁区切りを入れるとキャレットが飛ぶため。
  const normalize = (id: string) => {
    setTexts((prev) => ({ ...prev, [id]: formatBalanceInput(parseBalanceInput(prev[id] ?? '')) }))
  }

  const entries: BalanceEntry[] = rows
    .map((r) => ({ assetId: r.asset.id, balance: parseBalanceInput(texts[r.asset.id] ?? '') }))
    .filter((e): e is BalanceEntry => e.balance !== null)

  const preview = rows.reduce((sum, r) => {
    const v = parseBalanceInput(texts[r.asset.id] ?? '')
    if (v === null) return sum
    return r.asset.kind === 'liability' ? sum - v : sum + v
  }, 0)

  const handleSave = async () => {
    if (busy || entries.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await recordBalances(supabase, asOf, entries)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '残高を保存できませんでした')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <h2>残高を記録</h2>
          <button className="btn-ghost" onClick={onClose}>
            閉じる
          </button>
        </div>

        <p className="asset-note">
          この日の残高をまとめて記録します。変わっていないものはそのままで構いません。
        </p>

        <label className="field asset-date-field">
          <span>いつ時点の残高か</span>
          <input
            type="date"
            value={asOf}
            max={todayISO()}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>

        <div className="balance-entry-list">
          {rows.map((r) => (
            <label key={r.asset.id} className="balance-entry-row">
              <span className="balance-entry-name">
                <span className="asset-emoji" aria-hidden="true">
                  {assetCategoryEmoji(r.asset.kind, r.asset.category)}
                </span>
                <span className="balance-entry-text">
                  <span className="asset-name">{r.asset.name}</span>
                  <span className="asset-sub">
                    {r.asset.kind === 'liability' ? '負債(残債)' : '資産'}
                    {r.balance !== null && ` ・ 前回 ${yen(r.balance)}`}
                  </span>
                </span>
              </span>
              <input
                className="balance-entry-input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                aria-label={`${r.asset.name}の残高`}
                value={texts[r.asset.id] ?? ''}
                onChange={(e) => setTexts((prev) => ({ ...prev, [r.asset.id]: e.target.value }))}
                onBlur={() => normalize(r.asset.id)}
              />
            </label>
          ))}
        </div>

        <div className="balance-preview">
          <span>この記録での純資産</span>
          <strong className={preview < 0 ? 'negative' : ''}>
            {preview < 0 ? `-${yen(Math.abs(preview))}` : yen(preview)}
          </strong>
        </div>

        {error && <p className="error-text">{error}</p>}

        <button
          className="btn-primary"
          onClick={() => void handleSave()}
          disabled={busy || entries.length === 0}
        >
          {busy ? '保存中…' : `${entries.length}件の残高を記録する`}
        </button>
      </div>
    </div>
  )
}
