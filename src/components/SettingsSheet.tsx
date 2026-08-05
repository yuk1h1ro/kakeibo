import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import CategorySettingsSheet from './CategorySettingsSheet'
import CsvExportSheet from './CsvExportSheet'
import RecurringSettingsSheet from './RecurringSettingsSheet'
import { categoryLabel } from '../lib/categories'
import { yen } from '../lib/format'
import {
  setKeypadPreference,
  useKeypadPreference,
  type KeypadPreference,
} from '../lib/keypadSettings'
import { amountMaskStateLabel, setAmountMasked, useAmountMasked } from '../lib/amountMask'
import { describeUnknownError, isOnlineNow } from '../lib/errorGuidance'
import { clearConfig, getConfiguredUrl, hasStoredConfig } from '../lib/supabaseClient'
import { privacyBlurStateLabel } from '../lib/privacyBlur'
import { setPrivacyBlurEnabled, usePrivacyBlurEnabled } from '../lib/privacyShield'
import { isRecurringUnavailable } from '../lib/recurringRules'
import type { Transaction } from '../lib/types'
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
  /**
   * CSV 書き出し (機能198) に渡す記録。未同期の分も含めた「いま画面に出ている全件」。
   * 省略できるようにしてあるのは、この設定シートを単体で描くとき(テストなど)に
   * 書き出し以外の設定だけを試せるようにするため。既定は0件 = 書き出せない状態。
   */
  transactions?: readonly Transaction[]
  /**
   * 同期できずに隔離された記録の件数と、その一覧を開く導線。
   * 0件のときは行ごと出さない(押しても何も無い導線を見せない)。
   */
  quarantinedCount?: number
  onOpenQuarantine?: () => void
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
export default function SettingsSheet({
  supabase,
  onClose,
  transactions = [],
  quarantinedCount = 0,
  onOpenQuarantine,
}: Props) {
  const [child, setChild] = useState<'category' | 'recurring' | 'csv' | null>(null)
  const keypadPref = useKeypadPreference()
  const privacyBlur = usePrivacyBlurEnabled()
  const amountMasked = useAmountMasked()
  const templates = useTransactionTemplates()
  const [error, setError] = useState<string | null>(null)
  // 接続設定の表示 (機能161)。描画のたびに読んでよい軽い値
  const configuredUrl = getConfiguredUrl()
  const storedConfig = hasStoredConfig()

  useBodyScrollLock()

  const removeTemplate = (id: string, label: string) => {
    if (!confirm(`テンプレート「${label}」を削除しますか?`)) return
    setError(null)
    void deleteTransactionTemplate(supabase, id).catch((e: unknown) => {
      // 原文をそのまま出しても次に何をすればいいか分からないので、
      // 原因と次の行動に置き換える (機能161)
      setError(describeUnknownError(e, isOnlineNow()))
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
            {/* CSV 書き出し (機能198)。
                Supabase の無料プランに自動バックアップが無いことへの備えなので、
                マイグレーションの有無に関係なく必ず出す(いつでも控えを取れること自体が要件) */}
            <li>
              <button className="settings-row" onClick={() => setChild('csv')}>
                <span className="settings-row-title">CSV で書き出す</span>
                <span className="settings-row-sub">
                  記録の控えを端末に保存する(バックアップ)
                </span>
              </button>
            </li>
            {/* サーバーに断られて端末に取り置いた記録。
                残っている間だけ出す = ふだんは存在しない行 */}
            {quarantinedCount > 0 && onOpenQuarantine && (
              <li>
                <button className="settings-row" onClick={onOpenQuarantine}>
                  <span className="settings-row-title">
                    同期できなかった記録({quarantinedCount}件)
                  </span>
                  <span className="settings-row-sub">
                    中身を確認して、もう一度送る・破棄する
                  </span>
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

          {/* Supabase の接続設定 (機能161)。
              「接続できない」ときのエラー文言から、ここへ来られるようにしてある。
              毎日触る設定ではないので、いちばん下に置く */}
          <div className="settings-section">
            <h3>Supabase の接続設定</h3>
            <p className="muted">
              接続先: <code className="settings-url">{configuredUrl ?? '(未設定)'}</code>
            </p>
            {storedConfig ? (
              <>
                <p className="muted">
                  「anonキーが無効」「接続できません」と出るときは、Supabase の Settings → API
                  にある Project URL と anon public
                  キーを見直してください。やり直すと、この端末に保存した接続情報を消して
                  最初の入力画面に戻ります(記録したデータは Supabase に残ります)。
                </p>
                <button
                  type="button"
                  className="btn-ghost settings-reset-config"
                  onClick={() => {
                    if (!confirm('この端末の接続設定を消して、入力からやり直しますか?')) return
                    clearConfig()
                    location.reload()
                  }}
                >
                  接続設定をやり直す
                </button>
              </>
            ) : (
              <p className="muted">
                この接続先は、ビルド時に埋め込まれた設定(リポジトリの secrets の
                VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)から来ています。変えるには
                GitHub 側の secrets を直してデプロイし直してください(この端末からは消せません)。
              </p>
            )}
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
      {child === 'csv' && (
        <CsvExportSheet transactions={transactions} onClose={() => setChild(null)} />
      )}
    </>
  )
}
