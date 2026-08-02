import { useCallback, useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Transaction } from '../lib/types'

export interface TransactionInput {
  date: string
  type: 'expense' | 'partner_deposit'
  amount: number
  category: string | null
  memo: string
  partner_amount: number
}

export function useTransactions(supabase: SupabaseClient) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) {
      setError(error.message)
    } else {
      setTransactions(data as Transaction[])
      setError(null)
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    refresh()
  }, [refresh])

  const add = useCallback(
    async (input: TransactionInput) => {
      const { error } = await supabase.from('transactions').insert(input)
      if (error) throw new Error(error.message)
      await refresh()
    },
    [supabase, refresh]
  )

  const update = useCallback(
    async (id: string, input: TransactionInput) => {
      const { error } = await supabase.from('transactions').update(input).eq('id', id)
      if (error) throw new Error(error.message)
      await refresh()
    },
    [supabase, refresh]
  )

  const remove = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('transactions').delete().eq('id', id)
      if (error) throw new Error(error.message)
      await refresh()
    },
    [supabase, refresh]
  )

  return { transactions, loading, error, refresh, add, update, remove }
}
