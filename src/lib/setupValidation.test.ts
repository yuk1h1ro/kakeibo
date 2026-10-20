import { describe, expect, it } from 'vitest'
import { setupProblem, withHttps } from './setupValidation'
import { normalizeUrl } from './supabaseClient'

const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.long-enough'

describe('withHttps / normalizeUrl', () => {
  it('https:// が無い URL には補う(そのまま保存すると二度とつながらない)', () => {
    expect(withHttps('xxxx.supabase.co')).toBe('https://xxxx.supabase.co')
    expect(normalizeUrl('xxxx.supabase.co')).toBe('https://xxxx.supabase.co')
    expect(normalizeUrl('  xxxx.supabase.co/  ')).toBe('https://xxxx.supabase.co')
  })

  it('すでに付いていれば触らない。パスは今までどおり落とす', () => {
    expect(normalizeUrl('https://xxxx.supabase.co/auth/v1/callback')).toBe('https://xxxx.supabase.co')
  })

  it('http:// など別の書き方は補わない(理由は setupProblem が言う)', () => {
    expect(withHttps('http://xxxx.supabase.co')).toBe('http://xxxx.supabase.co')
  })

  it('空は空のまま', () => {
    expect(withHttps('   ')).toBe('')
    expect(normalizeUrl('')).toBe('')
  })
})

describe('setupProblem — ボタンが押せない理由', () => {
  it('URL が空', () => {
    expect(setupProblem('', KEY)).toBe('Project URL を入れてください')
  })

  it('https で始まらない', () => {
    expect(setupProblem('http://xxxx.supabase.co', KEY)).toContain('https:// で始まる')
  })

  it('キーが空・短すぎる', () => {
    expect(setupProblem('https://xxxx.supabase.co', '')).toBe('anon public キーを入れてください')
    expect(setupProblem('https://xxxx.supabase.co', 'eyJabc')).toContain('途中で切れていないか')
  })

  it('https:// を付けずに貼った URL も、補ったあとの形で通る', () => {
    expect(setupProblem(normalizeUrl('xxxx.supabase.co'), KEY)).toBeNull()
  })

  it('新しい呼び名のキー(sb_publishable_)も長さで弾かない', () => {
    expect(setupProblem('https://xxxx.supabase.co', 'sb_publishable_AbCdEfGhIjKlMnOpQrStUv_123456')).toBeNull()
  })
})
