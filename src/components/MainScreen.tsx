import { useEffect, useState, type ReactNode } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useTransactions } from '../hooks/useTransactions'
import { initCategories } from '../lib/categories'
import type { Transaction } from '../lib/types'
import InputTab from './InputTab'
import HistoryTab from './HistoryTab'
import ReportTab from './ReportTab'
import PartnerTab from './PartnerTab'
import TransactionForm from './TransactionForm'
import CategorySettingsSheet from './CategorySettingsSheet'
import { IconCalendar, IconChart, IconGear, IconHeart, IconLogout, IconPen } from './icons'
import useBodyScrollLock from '../hooks/useBodyScrollLock'
import '../offline.css'
import '../settings.css'

type Tab = 'input' | 'history' | 'report' | 'partner'

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'input', label: '入力', icon: <IconPen /> },
  { id: 'history', label: '履歴', icon: <IconCalendar /> },
  { id: 'report', label: 'レポート', icon: <IconChart /> },
  { id: 'partner', label: '彼女', icon: <IconHeart /> },
]

export default function MainScreen({ supabase }: { supabase: SupabaseClient }) {
  const store = useTransactions(supabase)
  const [tab, setTab] = useState<Tab>('input')
  const [editing, setEditing] = useState<Transaction | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  // 取引編集モーダルを開いている間は背面ページを固定する
  // (カテゴリ設定/Geminiキーの各シートは自前でロックを取得する)
  useBodyScrollLock(editing !== null)

  // カテゴリをSupabaseから読み込む(初回は既定カテゴリを移行)。失敗時はキャッシュで継続
  useEffect(() => {
    void initCategories(supabase)
  }, [supabase])

  // オンラインなのに同期が詰まっている(= 記録は保持されているが送れていない)状態。
  // 放置すると「履歴に反映されない」ように見えるので、対処法とあわせて明示する
  const stalled =
    store.isOnline && store.pendingCount > 0 && !store.syncing && store.error !== null

  return (
    <>
      <header className="app-header">
        <h1>家計簿</h1>
        <div className="header-actions">
          <button
            className="icon-btn"
            aria-label="カテゴリ設定"
            onClick={() => setShowSettings(true)}
          >
            <IconGear />
          </button>
          <button
            className="icon-btn"
            aria-label="ログアウト"
            onClick={() => supabase.auth.signOut()}
          >
            <IconLogout />
          </button>
        </div>
      </header>
      {!store.isOnline ? (
        <div className="sync-banner offline">
          オフライン — 記録は保存され、通信回復時に自動同期されます
          {store.pendingCount > 0 && `(保留 ${store.pendingCount}件)`}
        </div>
      ) : store.pendingCount > 0 && store.syncing ? (
        <div className="sync-banner syncing">同期中… ({store.pendingCount}件)</div>
      ) : stalled ? (
        <div className="sync-banner warning">
          ⚠ 未同期の記録が {store.pendingCount}件あります
          <span className="banner-detail">{store.error}</span>
        </div>
      ) : null}
      <main className="app-main">
        {/* 未同期バナーに同じ内容を出しているときは重複表示しない */}
        {store.error && !stalled && <p className="error-text">データ取得エラー: {store.error}</p>}
        {tab === 'input' && <InputTab store={store} />}
        {tab === 'history' && <HistoryTab store={store} onEdit={setEditing} />}
        {tab === 'report' && <ReportTab transactions={store.transactions} />}
        {tab === 'partner' && <PartnerTab store={store} onEdit={setEditing} />}
      </main>
      <nav className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            <span className="tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
      {showSettings && (
        <CategorySettingsSheet supabase={supabase} onClose={() => setShowSettings(false)} />
      )}
      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-header">
              <h2>{editing.type === 'expense' ? '支出を編集' : '預かりを編集'}</h2>
              <button className="btn-ghost" onClick={() => setEditing(null)}>
                閉じる
              </button>
            </div>
            <TransactionForm
              initial={editing}
              submitLabel="更新する"
              onSubmit={async (input) => {
                await store.update(editing.id, input)
                setEditing(null)
              }}
              onDelete={async () => {
                if (confirm('この記録を削除しますか?')) {
                  await store.remove(editing.id)
                  setEditing(null)
                }
              }}
            />
          </div>
        </div>
      )}
    </>
  )
}
