import { describe, expect, it } from 'vitest'
import {
  SYNC_REJECTED_PREFIX,
  constraintMigrationTargetFor,
  describeUnknownError,
  formatGuidance,
  guidanceForMessage,
  guidanceForServerError,
  favorRejectionGuidance,
  ledgerRejectionGuidance,
  migrationTargetFor,
  syncRejectedGuidance,
  throwOnServerError,
} from './errorGuidance'

describe('migrationTargetFor', () => {
  it('おごり・値引きの列が無いエラーからも、実行すべきSQLを名指しできる', () => {
    expect(migrationTargetFor("Could not find the 'favor_amount' column of 'transactions'")).toEqual({
      what: '取引の「おごり・値引き」列',
      file: 'migration-favor.sql',
    })
    expect(migrationTargetFor('column transactions.favor_from does not exist')).toEqual({
      what: '取引の「おごってくれた人」列',
      file: 'migration-favor.sql',
    })
  })

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

  // 後から足した列。どの SQL が足しているかは supabase/ の中身と突き合わせて確認済み
  it('立替者・タグ・分割の列は、store ではなくそれぞれの SQL を名指しする', () => {
    expect(
      migrationTargetFor("Could not find the 'partner_paid' column of 'transactions'")?.file
    ).toBe('migration-partner-ledger.sql')
    expect(migrationTargetFor('column transactions.tags does not exist')?.file).toBe(
      'migration-tags-splits.sql'
    )
    expect(migrationTargetFor("Could not find the 'split_group' column of 'transactions'")?.file).toBe(
      'migration-tags-splits.sql'
    )
    // 気分は前から対応済み。取り違えていないことも一緒に固定する
    expect(migrationTargetFor('column transactions.satisfaction does not exist')?.file).toBe(
      'migration-satisfaction.sql'
    )
  })

  it('資産・変更履歴・共有まわりのテーブルも名指しできる', () => {
    expect(migrationTargetFor('relation "public.asset_balances" does not exist')?.file).toBe(
      'migration-assets.sql'
    )
    expect(migrationTargetFor('relation "public.partner_share_comments" does not exist')?.file).toBe(
      'migration-partner-share.sql'
    )
    expect(migrationTargetFor('relation "public.partner_summary_sends" does not exist')?.file).toBe(
      'migration-partner-share.sql'
    )
  })

  it('共有ページの関数が無いときも、共有のSQLを名指しする', () => {
    expect(
      migrationTargetFor(
        "Could not find the function public.partner_share_view(p_token) in the schema cache"
      )?.file
    ).toBe('migration-partner-share.sql')
    expect(
      migrationTargetFor('function public.partner_share_add_comment(text,uuid,text) does not exist')
        ?.file
    ).toBe('migration-partner-share.sql')
  })
})

describe('constraintMigrationTargetFor', () => {
  it('マイグレーションが条件をゆるめている制約だけ、SQLを名指しする', () => {
    const text =
      'new row for relation "transactions" violates check constraint "transactions_type_check"'
    expect(constraintMigrationTargetFor(text)?.file).toBe('migration-partner-ledger.sql')
    expect(
      constraintMigrationTargetFor(
        'new row for relation "transactions" violates check constraint "transactions_amount_check"'
      )?.file
    ).toBe('migration-partner-ledger.sql')
  })

  it('列を足したSQLが同時に作る制約には、SQLを案内しない(実行済みのはずなので)', () => {
    // tags 列と一緒に入る制約 = 違反した時点で migration-tags-splits.sql は実行済み。
    // ここでファイル名を出すと「実行済みのSQLを実行してください」と嘘をつくことになる
    expect(
      constraintMigrationTargetFor(
        'new row for relation "transactions" violates check constraint "transactions_tags_check"'
      )
    ).toBeNull()
    expect(
      constraintMigrationTargetFor(
        'new row for relation "transactions" violates check constraint "transactions_partner_paid_check"'
      )
    ).toBeNull()
  })

  it('制約名が読み取れないときは推測しない', () => {
    expect(constraintMigrationTargetFor('violates check constraint')).toBeNull()
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

describe('guidanceForServerError — チェック制約', () => {
  it('返金・調整が弾かれたら、預かり台帳のSQLを案内する(断定はしない)', () => {
    const g = guidanceForServerError({
      message:
        'new row for relation "transactions" violates check constraint "transactions_type_check"',
      code: '23514',
    })
    expect(g.kind).toBe('migration')
    expect(g.actions.join(' ')).toContain('supabase/migration-partner-ledger.sql')
    expect(g.summary).toContain('可能性')
  })

  it('対応表に無い制約では、SQLを案内せず入力の見直しを促す', () => {
    const g = guidanceForServerError({
      message:
        'new row for relation "transactions" violates check constraint "transactions_partner_paid_check"',
      code: '23514',
    })
    expect(g.kind).toBe('rejected')
    expect(formatGuidance(g)).not.toMatch(/migration-[a-z-]+\.sql/)
    expect(g.actions.length).toBeGreaterThan(0)
  })
})

describe('ledgerRejectionGuidance', () => {
  it('返金・調整を保存できないときは、実行すべきSQLと記録が残ることを伝える', () => {
    const g = ledgerRejectionGuidance({ message: 'violates check constraint', code: '23514' })
    expect(g.kind).toBe('migration')
    expect(g.actions.join(' ')).toContain('supabase/migration-partner-ledger.sql')
    expect(g.actions.join(' ')).toContain('記録は端末に残っています')
  })
})

describe('favorRejectionGuidance', () => {
  it('支払い 0円 を保存できないときは、実行すべきSQLと記録が残ることを伝える', () => {
    const g = favorRejectionGuidance({
      message: 'new row violates check constraint "transactions_amount_check"',
      code: '23514',
    })
    expect(g.kind).toBe('migration')
    expect(g.actions.join(' ')).toContain('supabase/migration-favor.sql')
    expect(g.actions.join(' ')).toContain('記録は端末に残っています')
    // 「あとから ledger を実行し直すと制約が上書きされる」道も案内に含める
    expect(g.actions.join(' ')).toContain('migration-partner-ledger.sql')
  })
})

describe('syncRejectedGuidance', () => {
  it('送れなかったことを頭に置き、理由は通常どおり分類する', () => {
    const g = syncRejectedGuidance({ message: 'duplicate key value violates unique constraint', code: '23505' })
    expect(g.kind).toBe('rejected')
    expect(g.summary).toContain('送れなかった記録があります')
    expect(g.summary).toContain('すでにあるため')
  })

  it('畳んだ文言を、もう一度案内で包み直さない(二重表示の防止)', () => {
    const err = { message: "Could not find the 'tags' column of 'transactions'", code: 'PGRST204' }
    const folded = formatGuidance(guidanceForServerError(err))
    // フックはこの文字列ではなく Guidance をそのまま画面へ渡す。
    // 万一もう一度通しても、案内が入れ子にならないことを確かめる
    expect(describeUnknownError(folded)).toBe(folded)
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

  it('すでに日本語で書かれた自前の文言は言い換えない', () => {
    // レシート読み取り・Gemini の上限・「オンライン時のみ可能です」など、
    // ここに来る前にもっと具体的なことが書けている文言を上書きしないこと
    const parse = 'レシートを読み取れませんでした。明るい場所でもう一度撮影してください'
    expect(describeUnknownError(new Error(parse))).toBe(parse)
    const quota =
      'Gemini の1分あたりの上限に達しました。1分ほど待ってからもう一度お試しください'
    expect(describeUnknownError(new Error(quota))).toBe(quota)
    expect(describeUnknownError(new Error('カテゴリの編集はオンライン時のみ可能です'))).toBe(
      'カテゴリの編集はオンライン時のみ可能です'
    )
  })

  it('サーバーの原文(英語)はきちんと言い換える', () => {
    const line = describeUnknownError(new Error("Could not find the 'tags' column of 'transactions'"))
    expect(line).toContain('migration-tags-splits.sql')
  })
})

describe('throwOnServerError', () => {
  it('エラーが無ければ何も投げない', () => {
    expect(() => throwOnServerError(null)).not.toThrow()
    expect(() => throwOnServerError(undefined)).not.toThrow()
  })

  it('画面がそのまま出せるよう、原因と次の行動まで畳んだ文言で投げる', () => {
    // 移す前の各 lib の throwOn と同じ式であることを、出力そのもので確かめる
    const error = { message: 'column transactions.store does not exist', code: '42703' }
    expect(() => throwOnServerError(error)).toThrow(
      formatGuidance(guidanceForServerError(error, true)),
    )
  })

  it('code の無い素の Error からも同じ案内が引ける', () => {
    expect(() => throwOnServerError(new Error('Invalid API key'))).toThrow(/anon public/)
  })

  it('onSchemaError を渡さなければ、テーブルが無いときも通常の案内になる', () => {
    expect(() => throwOnServerError({ message: 'relation "public.assets" does not exist' })).toThrow(
      /migration-assets\.sql/,
    )
  })

  it('onSchemaError は、スキーマエラーのときだけ後始末を走らせて文言を差し替える', () => {
    const seen: string[] = []
    expect(() =>
      throwOnServerError({ message: 'relation "public.assets" does not exist' }, {
        onSchemaError: () => {
          seen.push('called')
          return '資産のテーブルがありません'
        },
      }),
    ).toThrow('資産のテーブルがありません')
    expect(seen).toEqual(['called'])

    // スキーマ以外の失敗では呼ばれず、通常の案内に落ちる
    seen.length = 0
    expect(() =>
      throwOnServerError({ message: 'Invalid API key' }, {
        onSchemaError: () => {
          seen.push('called')
          return 'こちらは出ないはず'
        },
      }),
    ).toThrow(/anon public/)
    expect(seen).toEqual([])
  })

  it('onSchemaError が文言を返さなければ、後始末だけして通常の案内に落ちる', () => {
    let cleaned = false
    expect(() =>
      throwOnServerError({ message: 'relation "public.assets" does not exist' }, {
        onSchemaError: () => {
          cleaned = true
        },
      }),
    ).toThrow(/migration-assets\.sql/)
    expect(cleaned).toBe(true)
  })
})
