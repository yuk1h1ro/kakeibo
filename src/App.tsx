import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, isConfigured } from './lib/supabaseClient'
import SetupScreen from './components/SetupScreen'
import AuthScreen from './components/AuthScreen'
import MainScreen from './components/MainScreen'

export default function App() {
  const [configured, setConfigured] = useState(isConfigured())
  const supabase = configured ? getSupabase() : null
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => sub.subscription.unsubscribe()
  }, [supabase])

  if (!configured || !supabase) {
    return <SetupScreen onSaved={() => setConfigured(true)} />
  }

  if (!authReady) {
    return <div className="auth-screen muted">読み込み中…</div>
  }

  if (!session) {
    return <AuthScreen supabase={supabase} />
  }

  return <MainScreen supabase={supabase} />
}
