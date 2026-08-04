import { describe, expect, it } from 'vitest'
import {
  SYNC_REJECTED_PREFIX,
  describeUnknownError,
  formatGuidance,
  guidanceForMessage,
  guidanceForServerError,
  migrationTargetFor,
} from './errorGuidance'

describe('migrationTargetFor', () => {
  it('列が無いエラーから、実行すべきSQLを名指しできる', () => {
    expect(migrationTargetFor('column transactions.store does not exist')).toEqual({
      what: '取引の「お店」列',
      file: 'migration-store.sql',
    })
    expect(
      migrationTargetFor("Could not find the 'satisfaction' column of 'transactions'")?.file,
    ).toBe('migration-satisfaction.sql')
  })

  it('テーブルが無いエラーからも引ける', () => {
    expect(migrationTargetFor('relation "public.transaction_changes" does not exist')?.file).toBe(
      'migration-change-log.sql',
    )
    expect(migrationTargetFor("Could not find the table 'public.assets'")?.file).toBe(
      'migration-assets.sql',
    )
  })

  it('列名が他の名前の一部になっているだけのときは、そちらに引っ張られない', () => {
    // store_categories は「お店の列(migration-store.sql)」ではない
    expect(migrationTargetFor('relation "public.store_categories" does not exist')?.file).toBe(
      'migration-store-categories.sql',
    )
  })

  it('知らない名前には推測でファイル名を出さない', () => {
    expect(migrationTargetFor('column transactions.mystery does not exist')).toBeNull()
  })
})

describe('guidanceForServerError — マイグレーション未実行', () => {
  it('どのSQLを実行すればよいかを名指しし、記録が消えないことも伝える', () => {
    const g = guidanceForServerError({
      message: "Could not find the 'store' column of 'transactions' in the schema cache",
      code: 'PGRST204',
    })
    expect(g.kind).toBe('migration')
    expect(g.actions.join(' ')).toContain('supabase/migration-store.sql')
    expect(g.actions.join(' ')).toContain('自動で同期')
    expect(g.detail).toContain('store')
  })

  it('特定できないときは断定せず、探し方と原文を出す', () => {
    const g = guidanceForServerError({
      message: 'column transactions.unknown_thing does not exist',
      code: '42703',
    })
    expect(g.kind).toBe('migration')
    expect(g.summary).toContain('特定できませんでした')
    // 存在しないファイル名を作らない
    expect(g.summary).not.toMatch(/migration-[a-z-]+\.sql/)
    expect(g.actions.length).toBeGreaterThan(0)
    expect(g.detail).toContain('unknown_thing')
  })
})

describe('guidanceForServerError — 接続設定・ログイン', () => {
  it('anonキーが違うときは、どこを見直すかと設定のやり直し先を出す', () => {
    const g = guidanceForServerError({ message: 'Invalid API key' })
    expect(g.kind).toBe('connection')
    expect(g.actions.join(' ')).toContain('anon public')
    expect(g.actions.join(' ')).toContain('接続設定')
  })

  it('ログインの期限切れは、ログインし直す導線を出す', () => {
    const g = guidanceForServerError({ message: 'JWT expired' })
    expect(g.kind).toBe('auth')
    expect(g.actions.join(' ')).toContain('ログイン')
  })

  it('RLS で拒否されたときは、原因を1つに断定しない', () => {
    const g = guidanceForServerError({ message: 'permission denied for table transactions', code: '42501' })
    expect(g.kind).toBe('auth')
    expect(g.summary).toContain('可能性')
    expect(g.actions.length).toBeGreaterThan(1)
  })
})

describe('guidanceForServerError — ログイン設定', () => {
  it('Googleログインが有効化されていないときは、どこを有効にするか名指しする', () => {
    const g = guidanceForServerError({ message: 'Unsupported provider: provider is not enabled' })
    expect(g.kind).toBe('auth')
    expect(g.actions.join(' ')).toContain('Sign In / Providers')
    expect(g.summary).toContain('可能性')
  })
})

describe('guidanceForServerError — 通信', () => {
  it('オフラインが確定しているときは、記録が残っていることを伝える', () => {
    const g = guidanceForServerError({ message: 'Failed to fetch' }, false)
    expect(g.kind).toBe('offline')
    expect(g.summary).toContain('端末に保存')
  })

  it('オンラインなのに届かないときは、URLの誤りの可能性も併記する(断定しない)', () => {
    const g = guidanceForServerError({ message: 'TypeError: Failed to fetch' }, true)
    expect(g.kind).toBe('connection')
    expect(g.summary).toContain('可能性')
    expect(g.actions.join(' ')).toContain('Project URL')
  })
})

describe('guidanceForServerError — その他', () => {
  it('一意制約違反は言い切れるので言い切る', () => {
    const g = guidanceForServerError({ message: 'duplicate key value violates unique constraint', code: '23505' })
    expect(g.kind).toBe('rejected')
    expect(g.summary).not.toContain('可能性')
  })

  it('分類できないものは原因を作らず、確認手順と原文を出す', () => {
    const g = guidanceForServerError({ message: 'something went sideways' })
    expect(g.kind).toBe('unknown')
    expect(g.summary).toBe('原因を特定できませんでした。')
    expect(g.actions.length).toBeGreaterThan(0)
    expect(g.detail).toBe('something went sideways')
  })

  it('どの分類でも、次の行動が必ず1つ以上ある', () => {
    const samples = [
      { message: "Could not find the 'store' column", code: 'PGRST204' },
      { message: 'Invalid API key' },
      { message: 'JWT expired' },
      { message: 'permission denied', code: '42501' },
      { message: 'Failed to fetch' },
      { message: 'duplicate key', code: '23505' },
      { message: '謎' },
    ]
    for (const s of samples) {
      expect(guidanceForServerError(s).actions.length).toBeGreaterThan(0)
    }
  })
})

describe('guidanceForMessage', () => {
  it('同期に失敗した記録の前置きを剥がして中身で分類する', () => {
    const g = guidanceForMessage(`${SYNC_REJECTED_PREFIX}duplicate key value violates unique constraint`)
    expect(g.kind).toBe('rejected')
    expect(g.summary).toContain('送れなかった記録があります')
  })

  it('すでにSQLを名指ししている自前の文言は、書き換えずに活かす', () => {
    const original =
      'データベースの更新が必要です。SupabaseのSQL Editorで migration-store.sql を実行してください'
    const g = guidanceForMessage(original)
    expect(g.kind).toBe('migration')
    expect(g.summary).toBe(original)
    // 名指しされたファイルで直らなかったときの道も残す
    expect(g.actions.join(' ')).toContain('README')
  })

  it('生のサーバーメッセージからも同じ案内が引ける', () => {
    expect(guidanceForMessage('relation "public.recurring_rules" does not exist').actions.join(' ')).toContain(
      'migration-recurring-rules.sql',
    )
  })
})

describe('formatGuidance / describeUnknownError', () => {
  it('1行に畳んでも、原因・次の行動・原文がすべて残る', () => {
    const line = formatGuidance(
      guidanceForServerError({ message: 'column transactions.store does not exist', code: '42703' }),
    )
    expect(line).toContain('マイグレーション未実行')
    expect(line).toContain('migration-store.sql')
    expect(line).toContain('詳細:')
  })

  it('例外オブジェクトでも文字列でも同じ文言になる', () => {
    const a = describeUnknownError(new Error('Invalid API key'))
    const b = describeUnknownError('Invalid API key')
    expect(a).toBe(b)
    expect(a).toContain('anon public')
  })
})
