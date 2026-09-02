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

import { isNetworkError, isSchemaError, toServerError, type ServerErrorLike } from './serverErrors'

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
  // 以下の3列は、どの SQL が足しているかを supabase/ の中身で確かめて書いている:
  //   partner_paid            … migration-partner-ledger.sql の「4. 彼女が実際に払った額の列」
  //   tags / split_group      … migration-tags-splits.sql の「1. タグ」「2. 分割の束ねID」
  // (どちらも schema.sql には無い = 新規に作った人にも後から足す必要がある列)
  ['partner_paid', 'migration-partner-ledger.sql', '取引の「彼女が払った額」列'],
  ['tags', 'migration-tags-splits.sql', '取引の「タグ」列'],
  ['split_group', 'migration-tags-splits.sql', '取引の「分割の束ね」列'],
  //   favor_amount / favor_kind / favor_from … migration-favor.sql の「1. 列を足す」
  ['favor_amount', 'migration-favor.sql', '取引の「おごり・値引き」列'],
  ['favor_kind', 'migration-favor.sql', '取引の「おごり・値引きの別」列'],
  ['favor_from', 'migration-favor.sql', '取引の「おごってくれた人」列'],
]

/**
 * PostgREST 経由で呼ぶ関数 (RPC)。共有ページは anon から関数だけを叩くので、
 * 関数が無いときは列・テーブルではなく関数名でエラーが返る。
 * いずれも supabase/migration-partner-share.sql が作っている
 * (schema.sql にも同じ定義があるので、新規に作った人は実行済み)。
 */
const MIGRATION_BY_FUNCTION: [name: string, file: string, what: string][] = [
  ['partner_share_view', 'migration-partner-share.sql', '共有ページを読み出す関数'],
  ['partner_share_add_comment', 'migration-partner-share.sql', '共有ページにコメントする関数'],
  ['partner_share_new_token', 'migration-partner-share.sql', '共有リンクのトークンを作る関数'],
]

/**
 * 「マイグレーションが条件をゆるめている」チェック制約の対応表。
 *
 * ここに載せてよいのは、**古いスキーマのままだと必ず弾かれ、SQL を実行すれば通る**
 * ものだけ。supabase/schema.sql と各 migration の制約定義を突き合わせて確かめた:
 *   transactions_type_check
 *     schema.sql は type in ('expense','partner_deposit') のみ。
 *     migration-partner-ledger.sql が partner_refund / partner_adjust を足す。
 *   transactions_amount_check
 *     schema.sql は amount > 0。ledger が partner_adjust だけ amount <> 0 に広げる
 *     (調整はマイナスもあり得るため)。
 *   transactions_partner_amount_check
 *     schema.sql は partner_amount <= amount を全種別に課す。ledger が支出のときだけに限る
 *     (調整行は amount がマイナスになり得るため)。
 *
 * 逆に transactions_partner_paid_check / transactions_tags_check /
 * transactions_satisfaction_check は「列を足した migration が同時に作る制約」なので、
 * 違反した時点でその migration は実行済み = 原因は値のほう。ここには載せない
 * (載せると「実行済みの SQL をもう一度実行してください」と嘘を案内することになる)。
 */
const MIGRATION_BY_CONSTRAINT: [name: string, file: string, what: string][] = [
  ['transactions_type_check', 'migration-partner-ledger.sql', '返金・調整の種別'],
  ['transactions_amount_check', 'migration-partner-ledger.sql', '調整のマイナス金額'],
  ['transactions_partner_amount_check', 'migration-partner-ledger.sql', '返金・調整の行'],
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
function extractMissing(
  text: string
): { kind: 'column' | 'table' | 'function'; name: string } | null {
  // 関数を先に見る。「function public.partner_share_view(text) does not exist」は
  // 下の table の形にも一部似ているため、取り違えないように順番で守る
  const fn =
    /could not find the function\s+(?:public\.)?([a-z_]+)/i.exec(text) ??
    /function\s+(?:public\.)?([a-z_]+)\([^)]*\)\s+does not exist/i.exec(text)
  if (fn) return { kind: 'function', name: fn[1] }

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
    if (missing.kind === 'column') return lookup(MIGRATION_BY_COLUMN, missing.name)
    if (missing.kind === 'function') return lookup(MIGRATION_BY_FUNCTION, missing.name)
    return lookup(MIGRATION_BY_TABLE, missing.name)
  }

  // 形が読み取れなかったときだけ、名前の出現で当てにいく。
  // 関数名・テーブル名を先に見る(列名は他の名前の一部になりやすい)
  for (const [name, file, what] of MIGRATION_BY_FUNCTION) {
    if (mentions(text, name)) return { what, file }
  }
  for (const [name, file, what] of MIGRATION_BY_TABLE) {
    if (name !== 'transactions' && mentions(text, name)) return { what, file }
  }
  for (const [name, file, what] of MIGRATION_BY_COLUMN) {
    if (mentions(text, name)) return { what, file }
  }
  return null
}

/**
 * チェック制約違反の本文から「その制約をゆるめる SQL」を引く。(純粋関数)
 * 対応表に無い制約は null — 値そのものが不正なだけの可能性が高く、
 * SQL を案内すると的外れになるため。
 */
export function constraintMigrationTargetFor(text: string): MigrationTarget | null {
  const m = /violates check constraint\s+"([a-z_]+)"/i.exec(text)
  const name = m ? m[1] : null
  if (name) return lookup(MIGRATION_BY_CONSTRAINT, name)
  // 制約名が読み取れないときは推測しない
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

/** チェック制約に弾かれた (23514) */
function isCheckConstraintError(err: ServerErrorLike, text: string): boolean {
  return err.code === '23514' || /violates check constraint/i.test(text)
}

/** 「実行すればこの記録は通る」ことまで言い切れるマイグレーション案内 */
function migrationGuidance(target: MigrationTarget, detail: string | null): Guidance {
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

/**
 * 「返金・調整をこのサーバーがまだ知らない」ときの案内。(純粋関数)
 *
 * 列不足ではなくチェック制約違反 (23514) で返ってくるため、上の migrationGuidance とは
 * 別に持っている。呼び出し側 (useTransactions) は保存しようとした種別まで見て
 * この形だと判断しているので、ここでは原因を言い切ってよい。
 */
/**
 * 「支払い 0円 の記録を、このサーバーがまだ受け付けない」ときの案内。(純粋関数)
 *
 * 全額おごってもらった回・割引券で無料になった回は amount が 0 になる。
 * これを通すのは supabase/migration-favor.sql が付け直す transactions_amount_check
 * だけなので、未実行なら 23514 で弾かれる。
 *
 * 制約名だけでは「調整のマイナス金額(ledger)」と見分けが付かない
 * (どちらも transactions_amount_check)。どちらなのかは **保存しようとした中身**
 * を知っている呼び出し側 (useTransactions) にしか分からないので、
 * そこで見分けてからこの関数を呼ぶ。
 */
export function favorRejectionGuidance(err: ServerErrorLike): Guidance {
  const detail = err.message.trim() === '' ? null : err.message.trim()
  return {
    kind: 'migration',
    summary:
      '支払い 0円 の記録(全額おごり・割引券で無料)を、いまの Supabase がまだ受け付けられません(マイグレーション未実行)。',
    actions: [
      'Supabase の SQL Editor で supabase/migration-favor.sql の中身を貼り付けて実行してください(何回実行しても安全です)。',
      'すでに実行済みの場合は、そのあとで migration-partner-ledger.sql を実行し直していないか確かめてください(金額の制約が上書きされます。migration-favor.sql をもう一度実行すれば直ります)。',
      '実行が済めば、入力した記録はそのまま自動で同期されます(記録は端末に残っています)。',
    ],
    detail,
  }
}

export function ledgerRejectionGuidance(err: ServerErrorLike): Guidance {
  const detail = err.message.trim() === '' ? null : err.message.trim()
  return {
    kind: 'migration',
    summary:
      '預かりの「返金」「調整」を、いまの Supabase がまだ受け付けられません(マイグレーション未実行)。',
    actions: [
      'Supabase の SQL Editor で supabase/migration-partner-ledger.sql の中身を貼り付けて実行してください(何回実行しても安全です)。',
      '実行が済めば、入力した記録はそのまま自動で同期されます(記録は端末に残っています)。',
    ],
    detail,
  }
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
    if (target) return migrationGuidance(target, detail)
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

  // 8. チェック制約違反。原因は2通り(古いスキーマ / 値そのものが不正)あるので、
  //    「その制約をゆるめる SQL が存在する」と確かめた制約のときだけファイル名を出す
  if (isCheckConstraintError(err, text)) {
    const target = constraintMigrationTargetFor(text)
    if (target) {
      return {
        kind: 'migration',
        summary: `${target.what}を、いまの Supabase がまだ受け付けられません(マイグレーション未実行の可能性があります)。`,
        actions: [
          `Supabase の SQL Editor で supabase/${target.file} の中身を貼り付けて実行してください(何回実行しても安全です)。`,
          '実行しても直らないときは、下の「詳細」の制約名をそのまま控えてください(入力した値のほうが条件に合っていない可能性があります)。',
        ],
        detail,
      }
    }
    return {
      kind: 'rejected',
      summary: '入力した内容がデータベースの条件に合わず、拒否されました。',
      actions: [
        '金額・日付・カテゴリを見直して、もう一度保存してください。',
        '下の「詳細」に出ている制約名が、どの項目のことかの手がかりになります。',
      ],
      detail,
    }
  }

  // 9. 分からないもの。ここで原因を作り話にしないことが、この機能でいちばん大事
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

/** 同期に失敗して破棄された記録の知らせ(古い形式の文字列に付いていた前置き) */
export const SYNC_REJECTED_PREFIX = '同期できなかった記録があります: '

/**
 * サーバーに送れず破棄した記録の案内。(純粋関数)
 *
 * 「送れなかった」ことと「なぜ送れなかったか」は別の話なので、
 * 前者を頭に足したうえで、後者は通常の分類をそのまま使う。
 * 文言を1か所に集めるため、useTransactions からも下の guidanceForMessage からも
 * この関数を通す(以前は前置き付きの文字列を組み立てていて、
 * 受け取った側がもう一度ほどく必要があった)。
 */
export function syncRejectedGuidance(err: ServerErrorLike, online = true): Guidance {
  const g = guidanceForServerError(err, online)
  return { ...g, kind: 'rejected', summary: `サーバーに送れなかった記録があります。${g.summary}` }
}

/**
 * すでに文字列になってしまったエラーから、原因と次の行動を引く。(純粋関数)
 *
 * 画面に届くころには Error.message の文字列しか残っていないことが多いので、
 * その形からも同じ案内を出せるようにしている。
 */
export function guidanceForMessage(message: string, online = true): Guidance {
  const text = message.trim()

  if (text.startsWith(SYNC_REJECTED_PREFIX)) {
    return syncRejectedGuidance({ message: text.slice(SYNC_REJECTED_PREFIX.length) }, online)
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

/**
 * すでに人に向けて書かれた文言か。(純粋関数)
 *
 * 日本語が含まれていれば、それはサーバーの原文ではなく、このアプリの誰かが
 * 人のために書いた文言(レシートが読めない・Gemini の上限・オンライン限定・
 * 他の lib が formatGuidance で畳んだ案内…)。
 * そこに「原因を特定できませんでした」を被せると、せっかくの具体的な案内が
 * 一般論に上書きされてしまうので、そのまま通す。
 * PostgREST / Supabase / fetch の原文は英語なので、これで取り違えない。
 */
function looksAlreadyWrittenForHumans(message: string): boolean {
  return /[ぁ-んァ-ヴ一-龠]/.test(message)
}

/**
 * 例外(unknown)を、そのまま画面に出せる文言にする。
 * すでに日本語で書かれた文言は言い換えない(上の looksAlreadyWrittenForHumans)。
 */
export function describeUnknownError(e: unknown, online = true): string {
  const message = e instanceof Error ? e.message : String(e)
  const trimmed = message.trim()
  if (trimmed !== '' && looksAlreadyWrittenForHumans(trimmed)) return trimmed
  return formatGuidance(guidanceForMessage(trimmed === '' ? message : trimmed, online))
}

/** navigator.onLine を安全に読む(非ブラウザ環境では「オンライン」とみなす) */
export function isOnlineNow(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/**
 * サーバーのエラーを、原因と次の行動が分かる文言にして投げる (機能161)。
 *
 * 原文をそのまま投げると、設定シートや資産シートに英語の PostgREST メッセージ
 * (`column ... does not exist` など)がそのまま出てしまう。
 * 画面はこの message をそのまま出すので、ここで案内まで作ってしまう。
 *
 * shareLinks / partnerComments も同じ式で投げているが、あちらは同じ場所で
 * 「テーブルが無い」判定(tableAvailability)も立てるため、
 * この関数には寄せずインラインのままにしてある。
 *
 * onSchemaError は、マイグレーション未実行のときだけ通常の案内より先に割り込むための口。
 * 資産のように「テーブルが無い」を画面の状態にも反映したい呼び出し側があるため、
 * 後始末をここで走らせられるようにしてある。文言を返せばそれで投げ、
 * 返さなければ通常の案内に落ちる。
 */
export function throwOnServerError(
  error: unknown,
  options?: { onSchemaError?: (err: ServerErrorLike) => string | void }
): void {
  if (!error) return
  const e = toServerError(error)
  if (options?.onSchemaError && isSchemaError(e)) {
    const message = options.onSchemaError(e)
    if (message) throw new Error(message)
  }
  throw new Error(formatGuidance(guidanceForServerError(e, isOnlineNow())))
}
