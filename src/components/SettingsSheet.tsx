import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import CategorySettingsSheet from './CategorySettingsSheet'
import RecurringSettingsSheet from './RecurringSettingsSheet'
import { categoryLabel } from '../lib/categories'
import { yen } from '../lib/format'
import {
  setKeypadPreference,
  useKeypadPreference,
  type KeypadPreference,
} from '../lib/keypadSettings'
import { amountMaskStateLabel, setAmountMasked, useAmountMasked } from '../lib/amountMask'
import { privacyBlurStateLabel } from '../lib/privacyBlur'
import { setPrivacyBlurEnabled, usePrivacyBlurEnabled } from '../lib/privacyShield'
import { isRecurringUnavailable } from '../lib/recurringRules'
import {
  deleteTransactionTemplate,
  isTemplatesUnavailable,
  templateLabel,
  useTransactionTemplates,
} from '../lib/transactionTemplates'
import '../settings.css'

interface Props {
  supabase: SupabaseClient
  onClose: () => void
}

const KEYPAD_OPTIONS: { id: KeypadPreference; label: string }[] = [
  { id: 'auto', label: '自動' },
  { id: 'on', label: '使う' },
  { id: 'off', label: '使わない' },
]

// アプリ切替時の目隠し (機能208) の2択。オフにしたあともここから戻せる
const PRIVACY_OPTIONS: { enabled: boolean; label: string }[] = [
  { enabled: true, label: '隠す' },
  { enabled: false, label: '隠さない' },
]

// 金額の目隠し (機能169) の2択。ふだんの操作はヘッダーのボタンで、
// ここは「いまどちらなのか」を確かめ、機能208 との違いを読める場所として置く
const AMOUNT_MASK_OPTIONS: { masked: boolean; label: string }[] = [
  { masked: false, label: '表示する' },
  { masked: true, label: '伏字にする' },
]

/**
 * 設定のハブ。歯車から開き、各設定シートへの入口をまとめる。
 *
 * マイグレーション未実行のテーブルに依存する項目は、そもそも出さない
 * (押しても何もできない導線を見せない)。
 */
export default function SettingsSheet({ supabase, onClose }: Props) {
  const [child, setChild] = useState<'category' | 'recurring' | null>(null)
  const keypadPref = useKeypadPreference()
  const privacyBlur = usePrivacyBlurEnabled()
  const amountMasked = useAmountMasked()
  const templates = useTransactionTemplates()
  const [error, setError] = useState<string | null>(null)

  useBodyScrollLock()

  const removeTemplate = (id: string, label: string) => {
    if (!confirm(`テンプレート「${label}」を削除しますか?`)) return
    setError(null)
    void deleteTransactionTemplate(supabase, id).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e))
    })
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-header">
            <h2>設定</h2>
            <button className="btn-ghost" onClick={onClose}>
              閉じる
            </button>
          </div>

          {error && <p className="error-text">{error}</p>}

          <ul className="settings-menu">
            <li>
              <button className="settings-row" onClick={() => setChild('category')}>
                <span className="settings-row-title">カテゴリ設定</span>
                <span className="settings-row-sub">追加・名前の変更・並べ替え・削除</span>
              </button>
            </li>
            {!isRecurringUnavailable() && (
              <li>
                <button className="settings-row" onClick={() => setChild('recurring')}>
                  <span className="settings-row-title">繰り返し入力</span>
                  <span className="settings-row-sub">家賃・サブスクを自動で記録する</span>
                </button>
              </li>
            )}
          </ul>

          <div className="settings-section">
            <h3>金額のテンキー</h3>
            <p className="muted">
              「自動」ではスマホ・タブレットのときだけ自前のテンキーを使い、PC では
              キーボードで入力します
            </p>
            <div className="keypad-pref">
              {KEYPAD_OPTIONS.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`date-chip ${keypadPref === o.id ? 'selected' : ''}`}
                  onClick={() => setKeypadPreference(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* 金額の目隠し (機能169) の切り替え。
              ふだんはヘッダーの目のボタンで切り替える。ここに置いているのは
              「いまどちらか」を確かめるためと、すぐ下の機能208 と混同させないため */}
          <div className="settings-section">
            <h3>画面の金額を伏字にする</h3>
            <p className="muted">{amountMaskStateLabel(amountMasked)}</p>
            <div className="privacy-pref">
              {AMOUNT_MASK_OPTIONS.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  className={`date-chip ${amountMasked === o.masked ? 'selected' : ''}`}
                  aria-pressed={amountMasked === o.masked}
                  onClick={() => setAmountMasked(o.masked)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="muted">
              人前で開くときに、画面右上の目のボタンでいつでも切り替えられます(ここと同じ設定です)。
              伏字にすると金額は <code>¥•••••</code> になり、桁数も分かりません。
              入力中の金額欄と、レポートの予算の入力欄は、打っている本人が読めないと困るので伏せません。
            </p>
          </div>

          {/* 目隠し (機能208) の切り替え。
              覆いが出た直後のバーからも止められるが、そちらは数回で出なくなるので、
              戻す手段は必ずここに置いておく */}
          <div className="settings-section">
            <h3>アプリ切替時に画面を隠す</h3>
            <p className="muted">{privacyBlurStateLabel(privacyBlur)}</p>
            <div className="privacy-pref">
              {PRIVACY_OPTIONS.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  className={`date-chip ${privacyBlur === o.enabled ? 'selected' : ''}`}
                  aria-pressed={privacyBlur === o.enabled}
                  onClick={() => setPrivacyBlurEnabled(o.enabled)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="muted">
              こちらは<strong>自動</strong>で、アプリを離れている間だけ画面全体を覆います
              (見ている最中は何も変わりません)。開いたまま金額だけを隠したいときは、上の
              「画面の金額を伏字にする」を使ってください。
            </p>
            <p className="muted">
              ふとした瞬間ののぞき見を減らすためのものです。スクリーンショットや画面収録は
              防げません。端末によっては、アプリ切替の画面に金額が残ることがあります。
            </p>
          </div>

          {!isTemplatesUnavailable() && (
            <div className="settings-section">
              <h3>テンプレート</h3>
              {templates.length === 0 ? (
                <p className="muted">
                  履歴で記録を開き「テンプレートにする」を押すと、入力タブから1タップで呼び出せます
                </p>
              ) : (
                <ul className="cat-list">
                  {templates.map((t) => (
                    <li key={t.id} className="cat-row">
                      <span className="cat-name">{templateLabel(t)}</span>
                      <span className="muted">{yen(t.amount)}</span>
                      <span className="muted">{categoryLabel(t.category)}</span>
                      <button
                        className="btn-ghost cat-action cat-delete"
                        onClick={() => removeTemplate(t.id, templateLabel(t))}
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {child === 'category' && (
        <CategorySettingsSheet supabase={supabase} onClose={() => setChild(null)} />
      )}
      {child === 'recurring' && (
        <RecurringSettingsSheet supabase={supabase} onClose={() => setChild(null)} />
      )}
    </>
  )
}
