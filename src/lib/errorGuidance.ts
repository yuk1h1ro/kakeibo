// ============================================================
// エラー文言に「原因」と「次の行動」を書く (機能161)
//
// これまで画面に出ていたのは Supabase / PostgREST が返した英語の原文
// (`column transactions.store does not exist` など) がほとんどで、
// 読んでも次に何をすればいいのか分からなかった。
// ここでエラーの種類から「何が起きたか」と「次にやること」を引く。
//
// 守っていること:
//   - 分かっていないことを断定しない。特定できた原因だけを言い切り、
//     怪しいだけのものは「〜の可能性があります」と書く
//   - 次の行動を必ず1つ以上出す(確認手順でもよい)。空にしない
//   - サーバーが返した原文は捨てずに detail に残す
//     (原因を特定できなかったときに、これが唯一の手がかりになる)
// ============================================================

import { isNetworkError, isSchemaError, type ServerErrorLike } from './serverErrors'

export type GuidanceKind =
  /** マイグレーション未実行(列・テーブルが無い) */
  | 'migration'
  /** 接続設定(Supabase の URL / anon キー)が違う */
  | 'connection'
  /** ログインの期限切れ・権限(RLS) */
  | 'auth'
  /** 通信できていない */
  | 'offline'
  /** サーバーに拒否された(制約違反など) */
  | 'rejected'
  /** 分類できなかった */
  | 'unknown'

export interface Guidance {
  kind: GuidanceKind
  /** 何が起きたか。断定できないものは「可能性があります」で書く */
  summary: string
  /** 次にやること。必ず1つ以上入れる */
  actions: string[]
  /** サーバーが返した原文(あれば) */
  detail: string | null
}

// ---------- マイグレーションの対応表 ----------

/**
 * 「この名前が出てきたら、このSQLを実行すればよい」の対応表。
 * supabase/ 配下のファイル名と README の案内に合わせている。
 * ここに無い名前を勝手に推測してファイル名を名指ししないこと
 * (存在しないファイルを案内するのが、いちばんたちの悪い間違い)。
 */
const MIGRATION_BY_TABLE: [name: string, file: string, what: string][] = [
  ['categories', 'migration-categories.sql', 'カテゴリ設定のテーブル'],
  ['store_categories', 'migration-store-categories.sql', 'お店ごとのカテゴリ記憶のテーブル'],
  ['recurring_rules', 'migration-recurring-rules.sql', '繰り返し入力のテーブル'],
  ['transaction_templates', 'migration-transaction-templates.sql', 'テンプレートのテーブル'],
  ['partner_share_links', 'migration-partner-share.sql', '共有リンクのテーブル'],
  ['partner_share_comments', 'migration-partner-share.sql', '共有ページのコメントのテーブル'],
  ['partner_summary_sends', 'migration-partner-share.sql', '月末サマリーの送信記録のテーブル'],
  ['transaction_changes', 'migration-change-log.sql', '変更履歴のテーブル'],
  ['assets', 'migration-assets.sql', '資産のテーブル'],
  ['asset_balances', 'migration-assets.sql', '資産残高のテーブル'],
  ['transactions', 'schema.sql', '取引のテーブル'],
]

const MIGRATION_BY_COLUMN: [name: string, file: string, what: string][] = [
  ['store', 'migration-store.sql', '取引の「お店」列'],
  ['source', 'migration-recurring-rules.sql', '取引の「自動生成」列'],
  ['satisfaction', 'migration-satisfaction.sql', '取引の「気分」列'],
]

export interface MigrationTarget {
  /** 足りていないもの(日本語) */
  what: string
  /** 実行すべき SQL ファイル名 */
  file: string
}

/** その名前が単語として出てくるか(store_categories の中の store に当てないため) */
function mentions(text: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(text)
}

/**
 * 「無いと言われたもの」の名前だけを取り出す。(純粋関数)
 *
 * 名前をただ拾い読みすると外す: `column transactions.store does not exist` には
 * transactions も store も出てくるが、足りていないのは列の store のほうで、
 * 案内すべきは schema.sql ではなく migration-store.sql。
 * PostgREST / PostgreSQL が返す4つの形から、対象そのものを取り出す。
 */
function extractMissing(text: string): { kind: 'column' | 'table'; name: string } | null {
  const column =
    /column\s+"?(?:[a-z_]+\.)?([a-z_]+)"?\s+does not exist/i.exec(text) ??
    /could not find the '([a-z_]+)' column/i.exec(text)
  if (column) return { kind: 'column', name: column[1] }

  const table =
    /relation\s+"?(?:public\.)?([a-z_]+)"?\s+does not exist/i.exec(text) ??
    /could not find the table '(?:public\.)?([a-z_]+)'/i.exec(text)
  if (table) return { kind: 'table', name: table[1] }

  return null
}

function lookup(
  list: [name: string, file: string, what: string][],
  name: string
): MigrationTarget | null {
  const hit = list.find(([n]) => n === name)
  return hit ? { what: hit[2], file: hit[1] } : null
}

/**
 * エラー本文から「どの SQL を実行すればよいか」を引く。(純粋関数)
 * 特定できなければ null — 分からないときに適当なファイル名を出さない。
 */
export function migrationTargetFor(text: string): MigrationTarget | null {
  const missing = extractMissing(text)
  if (missing) {
    // 対象が読み取れたなら、対応表に無い = 知らないものなので推測しない
    return missing.kind === 'column'
      ? lookup(MIGRATION_BY_COLUMN, missing.name)
      : lookup(MIGRATION_BY_TABLE, missing.name)
  }

  // 形が読み取れなかったときだけ、名前の出現で当てにいく。
  // テーブル名を先に見る(列名は他の名前の一部になりやすい)
  for (const [name, file, what] of MIGRATION_BY_TABLE) {
    if (name !== 'transactions' && mentions(text, name)) return { what, file }
  }
  for (const [name, file, what] of MIGRATION_BY_COLUMN) {
    if (mentions(text, name)) return { what, file }
  }
  return null
}

// ---------- 分類 ----------

/** 接続設定(URL / anon キー)が疑わしいときの言い回し */
const CONNECTION_ACTIONS = [
  'Supabase の Settings → API にある Project URL と anon public キーを確かめてください。',
  'この端末に保存した接続情報は、設定(⚙️)の「Supabase の接続設定」からやり直せます。',
]

function joinText(err: ServerErrorLike): string {
  return [err.message, err.details, err.hint].filter(Boolean).join(' ')
}

/** anon キーそのものが受け付けられていない */
function isApiKeyError(text: string): boolean {
  return /invalid api key|no api key|apikey/i.test(text)
}

/** ログインの期限切れ・トークン不正 */
function isJwtError(text: string): boolean {
  return /jwt|jws|token is expired|invalid claim|not authenticated/i.test(text)
}

/** RLS で弾かれた(本人以外の行、またはポリシー未作成) */
function isRlsError(err: ServerErrorLike, text: string): boolean {
  return err.code === '42501' || /row-level security|permission denied/i.test(text)
}

/** 同じ行がすでにある(一意制約) */
function isDuplicateError(err: ServerErrorLike, text: string): boolean {
  return err.code === '23505' || /duplicate key|already exists/i.test(text)
}

/**
 * サーバーのエラーから、原因と次の行動を引く。(純粋関数)
 *
 * online は navigator.onLine の値を呼び出し側から渡す
 * (この関数をブラウザの状態から切り離してテストできるようにするため)。
 */
export function guidanceForServerError(err: ServerErrorLike, online = true): Guidance {
  const text = joinText(err)
  const detail = err.message.trim() === '' ? null : err.message.trim()

  // 1. マイグレーション未実行。実行すれば必ず直るので最優先で見分ける
  if (isSchemaError(err)) {
    const target = migrationTargetFor(text)
    if (target) {
      return {
        kind: 'migration',
        summary: `${target.what}が Supabase にまだありません(マイグレーション未実行)。`,
        actions: [
          `Supabase の SQL Editor で supabase/${target.file} の中身を貼り付けて実行してください(何回実行しても安全です)。`,
          '実行が済めば、入力した記録はそのまま自動で同期されます(記録は端末に残っています)。',
        ],
        detail,
      }
    }
    return {
      kind: 'migration',
      summary:
        'データベースに必要な列またはテーブルがありません(マイグレーション未実行)。どのSQLが要るかは、この画面からは特定できませんでした。',
      actions: [
        '下の「詳細」に出ている名前を、README の「すでに以前のバージョンで schema.sql を実行済みの方へ」の表から探し、対応する supabase/migration-*.sql を SQL Editor で実行してください。',
        '見つからないときは、supabase/schema.sql を最初から実行し直しても構いません(何回実行しても安全な内容です)。',
        '実行が済めば、入力した記録はそのまま自動で同期されます。',
      ],
      detail,
    }
  }

  // 2. anon キーが受け付けられていない = 接続設定の誤り(待っても直らない)
  if (isApiKeyError(text)) {
    return {
      kind: 'connection',
      summary: 'Supabase の anon キーが受け付けられませんでした。キーの貼り間違いか、プロジェクトの取り違えの可能性があります。',
      actions: CONNECTION_ACTIONS,
      detail,
    }
  }

  // 3. ログインの期限切れ・トークン不正
  if (isJwtError(text)) {
    return {
      kind: 'auth',
      summary: 'ログインの有効期限が切れているようです。',
      actions: [
        '右上のログアウトを押してから、もう一度 Google でログインし直してください。',
        'ログインし直しても直らないときは、Supabase の Authentication → URL Configuration の Site URL / Redirect URLs がこのアプリの URL になっているか確かめてください。',
      ],
      detail,
    }
  }

  // 4. RLS。原因が2通り(他人の行 / ポリシー未作成)あるので断定しない
  if (isRlsError(err, text)) {
    return {
      kind: 'auth',
      summary:
        'データベースに拒否されました。ログインが切れているか、Supabase 側の行レベルセキュリティ(RLS)の設定が入っていない可能性があります。',
      actions: [
        'いったんログアウトして、もう一度 Google でログインし直してください。',
        'それでも直らないときは、supabase/schema.sql を SQL Editor で実行し直して、RLS のポリシーが作られているか確かめてください。',
      ],
      detail,
    }
  }

  // 5. Google ログインが Supabase 側で有効になっていない
  if (/provider is not enabled|unsupported provider/i.test(text)) {
    return {
      kind: 'auth',
      summary: 'Supabase 側で Google ログインが有効になっていない可能性があります。',
      actions: [
        'Supabase の Authentication → Sign In / Providers → Google に、Google Cloud で作った クライアントID とシークレットを入れて有効(Enable)にしてください。',
        'あわせて Authentication → URL Configuration の Site URL / Redirect URLs に、このアプリの URL が入っているか確かめてください(README の手順2)。',
      ],
      detail,
    }
  }

  // 6. 通信できていない。オフラインが確定しているときと、そうでないときで書き分ける
  if (isNetworkError(err.message) || /failed to fetch|load failed|networkerror/i.test(text)) {
    if (!online) {
      return {
        kind: 'offline',
        summary: 'いまオフラインです。入力した記録は端末に保存されています。',
        actions: ['電波の届く場所に移るか Wi-Fi につなぐと、自動で同期されます。'],
        detail,
      }
    }
    return {
      kind: 'connection',
      summary:
        'Supabase に接続できませんでした。通信が不安定か、接続設定の Project URL が違う可能性があります。',
      actions: [
        'しばらく待ってから、履歴タブを引き下げて更新してください。',
        ...CONNECTION_ACTIONS,
      ],
      detail,
    }
  }

  // 7. 一意制約。ここは断定できる
  if (isDuplicateError(err, text)) {
    return {
      kind: 'rejected',
      summary: '同じ内容の記録がすでにあるため、追加されませんでした。',
      actions: ['履歴タブで同じ記録がすでに入っていないか確かめてください。'],
      detail,
    }
  }

  // 8. 分からないもの。ここで原因を作り話にしないことが、この機能でいちばん大事
  return {
    kind: 'unknown',
    summary: '原因を特定できませんでした。',
    actions: [
      'もう一度試してください(一時的な不調であればこれで直ります)。',
      '繰り返し失敗するときは、下の「詳細」の文言をそのまま控えて、Supabase の状態(SQL Editor でテーブルが見えるか・ログインできているか)を確かめてください。',
    ],
    detail,
  }
}

/** 同期に失敗して破棄された記録の知らせ(useTransactions が付ける前置き) */
export const SYNC_REJECTED_PREFIX = '同期できなかった記録があります: '

/**
 * すでに文字列になってしまったエラーから、原因と次の行動を引く。(純粋関数)
 *
 * 画面に届くころには Error.message の文字列しか残っていないことが多いので、
 * その形からも同じ案内を出せるようにしている。
 */
export function guidanceForMessage(message: string, online = true): Guidance {
  const text = message.trim()

  if (text.startsWith(SYNC_REJECTED_PREFIX)) {
    const inner = text.slice(SYNC_REJECTED_PREFIX.length)
    const g = guidanceForServerError({ message: inner }, online)
    return { ...g, kind: 'rejected', summary: `サーバーに送れなかった記録があります。${g.summary}` }
  }

  // すでに実行すべき SQL を名指ししている自前のメッセージは、書き換えずにそのまま活かす。
  // ただし「そのファイルで直る」と言い切れる保証は無いので、外れたときの道も添える。
  if (/SQL Editor/i.test(text) && /\.sql/i.test(text)) {
    return {
      kind: 'migration',
      summary: text,
      actions: [
        'それでも直らないときは、README の「すでに以前のバージョンで schema.sql を実行済みの方へ」の表を見て、まだ実行していない supabase/migration-*.sql が無いか確かめてください。',
      ],
      detail: null,
    }
  }

  return guidanceForServerError({ message: text }, online)
}

/**
 * 1行の文字列しか置けない場所(既存の .error-text など)向けに畳む。(純粋関数)
 * 構造を出せる画面では、畳まずに summary と actions を分けて出すほうがよい。
 */
export function formatGuidance(g: Guidance): string {
  const head = [g.summary, ...g.actions].join(' ')
  return g.detail ? `${head}(詳細: ${g.detail})` : head
}

/** 例外(unknown)を、そのまま画面に出せる文言にする */
export function describeUnknownError(e: unknown, online = true): string {
  const message = e instanceof Error ? e.message : String(e)
  return formatGuidance(guidanceForMessage(message, online))
}

/** navigator.onLine を安全に読む(非ブラウザ環境では「オンライン」とみなす) */
export function isOnlineNow(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}
