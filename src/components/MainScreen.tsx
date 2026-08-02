import { useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useTransactions } from '../hooks/useTransactions'
import type { Transaction } from '../lib/types'
import InputTab from './InputTab'
import HistoryTab from './HistoryTab'
import ReportTab from './ReportTab'
import PartnerTab from './PartnerTab'
import TransactionForm from './TransactionForm'

type Tab = 'input' | 'history' | 'report' | 'partner'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'input', label: '入力', icon: '✏️' },
  { id: 'history', label: '履歴', icon: '📋' },
  { id: 'report', label: 'レポート', icon: '📊' },
  { id: 'partner', label: '彼女', icon: '💰' },
]

export default function MainScreen({ supabase }: { supabase: SupabaseClient }) {
  const store = useTransactions(supabase)
  const [tab, setTab] = useState<Tab>('input')
  const [editing, setEditing] = useState<Transaction | null>(null)

  return (
    <>
      <header className="app-header">
        <h1>家計簿</h1>
        <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>
          ログアウト
        </button>
      </header>
      <main className="app-main">
        {store.error && <p className="error-text">データ取得エラー: {store.error}</p>}
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
