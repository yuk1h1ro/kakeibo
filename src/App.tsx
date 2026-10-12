import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, isConfigured } from './lib/supabaseClient'
import { authViewFor, hasVault, restoreFromVault, type RestoreResult } from './lib/sessionVault'
import SetupScreen from './components/SetupScreen'
import AuthScreen from './components/AuthScreen'
import MainScreen from './components/MainScreen'

export default function App() {
  const [configured, setConfigured] = useState(isConfigured())
  const supabase = configured ? getSupabase() : null
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  // セッションが無いときに、控えから戻せたか (sessionVault.ts)
  const [restore, setRestore] = useState<RestoreResult | 'pending'>('pending')

  // 控えからログインを戻す。控えが無ければすぐログイン画面へ。
  //
  // onAuthStateChange の知らせは supabase-js の内部ロックの中から届くので、
  // そこで auth の操作を待つと詰まる。いったん手を離してから呼ぶ。
  const tryRestore = useCallback(() => {
    if (!supabase) return
    if (!hasVault()) {
      setRestore('no-backup')
      return
    }
    setRestore('pending')
    setTimeout(() => {
      void restoreFromVault(supabase.auth).then(async (r) => {
        setRestore(r)
        // 戻ったら TOKEN_REFRESHED でも届くが、取りこぼしに備えて自分でも読む
        if (r === 'restored') {
          const { data } = await supabase.auth.getSession()
          if (data.session) setSession(data.session)
        }
      })
    }, 0)
  }, [supabase])

  useEffect(() => {
    if (!supabase) return
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setSession(data.session)
      if (!data.session) tryRestore()
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (next) {
        setRestore('pending')
      } else if (event === 'SIGNED_OUT') {
        // 利用者が押したログアウトなら控えはもう消えている (signOutByUser)
        // → no-backup でそのままログイン画面。押していなければ控えから戻す
        tryRestore()
      }
      // OAuthリダイレクト復帰後にURLへ残る ?code= 等のクエリを除去
      if (event === 'SIGNED_IN' && window.location.search) {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash)
      }
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [supabase, tryRestore])

  const view = authViewFor({ ready: authReady, hasSession: session !== null, restore })

  // 通信できずに待っている間は、電波が戻った・画面に戻ってきたところで試し直す
  useEffect(() => {
    if (view !== 'waiting') return
    const retry = () => {
      if (document.visibilityState === 'visible') tryRestore()
    }
    window.addEventListener('online', retry)
    document.addEventListener('visibilitychange', retry)
    return () => {
      window.removeEventListener('online', retry)
      document.removeEventListener('visibilitychange', retry)
    }
  }, [view, tryRestore])

  if (!configured || !supabase) {
    return <SetupScreen onSaved={() => setConfigured(true)} />
  }

  switch (view) {
    case 'loading':
      return <div className="auth-screen muted">読み込み中…</div>
    case 'restoring':
      return <div className="auth-screen muted">ログインを復帰しています…</div>
    case 'waiting':
      return (
        <div className="auth-screen">
          <h1>家計簿</h1>
          <p className="muted auth-note">
            通信できないため、ログインの復帰を待っています。
            <br />
            電波が戻れば、ログインし直さずにそのまま再開します。
          </p>
          <button className="btn-ghost" onClick={tryRestore}>
            もう一度試す
          </button>
          {/* 待っても戻らないときの逃げ道。押さなければ出てこない */}
          <button className="btn-ghost" onClick={() => setRestore('no-backup')}>
            Google でログインし直す
          </button>
        </div>
      )
    case 'login':
      return <AuthScreen supabase={supabase} />
    case 'app':
      return <MainScreen supabase={supabase} />
  }
}
