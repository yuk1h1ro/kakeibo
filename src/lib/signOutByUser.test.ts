// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { signOutByUser } from './supabaseClient'
import { takeSignOutRequest } from './localData'

/** signOut だけを持つ最小のクライアント */
function stubSupabase(error: { message: string } | null = null) {
  const signOut = vi.fn(async () => ({ error }))
  return { client: { auth: { signOut } } as unknown as SupabaseClient, signOut }
}

describe('signOutByUser — 確認は二段', () => {
  beforeEach(() => {
    localStorage.clear()
    takeSignOutRequest() // 前のテストが立てた意図を倒しておく
  })

  it('1段目でキャンセルすれば、ログアウトもしない(セッションに触らない)', async () => {
    const { client, signOut } = stubSupabase()
    const confirm = vi.fn((_message: string) => false)

    await expect(signOutByUser(client, { confirm })).resolves.toBe('cancelled')
    expect(confirm).toHaveBeenCalledOnce()
    expect(signOut).not.toHaveBeenCalled()
    // 意図が立ったままだと、次に来た SIGNED_OUT で消去の確認が誤発火する
    expect(takeSignOutRequest()).toBe(false)
  })

  it('1段目で聞かれるのは「ログアウトするか」だけ(消すかどうかではない)', async () => {
    const { client } = stubSupabase()
    const asked: string[] = []
    const confirm = (message: string) => {
      asked.push(message)
      return false
    }

    await signOutByUser(client, { confirm })
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('ログアウトしますか')
    expect(asked[0]).not.toContain('消しますか')
  })

  it('1段目で OK ならログアウトし、2段目(消去の確認)へ意図を渡す', async () => {
    const { client, signOut } = stubSupabase()

    await expect(signOutByUser(client, { confirm: () => true })).resolves.toBe('signed-out')
    expect(signOut).toHaveBeenCalledOnce()
    expect(takeSignOutRequest()).toBe(true)
  })

  it('ログアウトに失敗したら意図を倒す(あとで消去の確認が誤発火しない)', async () => {
    const { client } = stubSupabase({ message: 'network' })

    await signOutByUser(client, { confirm: () => true })
    expect(takeSignOutRequest()).toBe(false)
  })
})
