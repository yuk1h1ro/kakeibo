-- ============================================================
-- 家計簿アプリ (kakeibo) スキーマ
-- Supabase の SQL Editor にそのまま貼り付けて実行できます。
-- ============================================================

-- ------------------------------------------------------------
-- transactions テーブル
-- 支出 (expense) と彼女からの預かり金 (partner_deposit) を
-- 1つのテーブルで管理します。
-- ------------------------------------------------------------
create table if not exists public.transactions (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者。未指定なら実行ユーザーの ID が自動で入る。
  -- ユーザー削除時は関連レコードも一緒に削除される (on delete cascade)
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- 取引日 (YYYY-MM-DD)
  date date not null,

  -- 種別: 'expense' = 支出 / 'partner_deposit' = 彼女からの預かり金
  type text not null check (type in ('expense', 'partner_deposit')),

  -- 金額 (円)。支出なら支払い総額、預かりなら預かった額。正の整数のみ。
  amount integer not null check (amount > 0),

  -- カテゴリ (食費・日用品など)。預かり金の場合は null 可
  category text,

  -- メモ (任意。既定は空文字)
  memo text not null default '',

  -- お店 (店名。任意。既定は空文字。支出でのみ使用)
  store text not null default '',

  -- 支出のうち彼女の負担分 (円)。彼女の預かり残高から差し引かれる。
  -- 0 以上かつ支払い総額 (amount) 以下であること。
  partner_amount integer not null default 0
    check (partner_amount >= 0 and partner_amount <= amount),

  -- 記録の出どころ。'recurring' なら繰り返し入力が自動生成した行。
  -- 手入力の行は空文字のまま (アプリは手入力時にこの列を送らない)
  source text not null default '',

  -- 気分スタンプ (満足 / 普通 / 後悔)。任意なので null = 未設定。
  -- 入力時に押すスタンプも、あとからまとめて仕分ける画面も、この1列だけを使う
  satisfaction text
    check (satisfaction is null or satisfaction in ('good', 'neutral', 'regret')),

  -- レコード作成日時
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Row Level Security (RLS)
-- 有効化すると、ポリシーで許可された行以外には一切アクセスできません。
-- anon キーがブラウザに公開されても、他人のデータは読み書きできない仕組みです。
-- ------------------------------------------------------------
alter table public.transactions enable row level security;

-- 自分の行だけ参照 (SELECT) できる
create policy "select_own_transactions"
  on public.transactions
  for select
  using (auth.uid() = user_id);

-- 自分の user_id の行だけ追加 (INSERT) できる
create policy "insert_own_transactions"
  on public.transactions
  for insert
  with check (auth.uid() = user_id);

-- 自分の行だけ更新 (UPDATE) できる。
-- with check により、更新後も自分の行であることを保証 (user_id の付け替え防止)
create policy "update_own_transactions"
  on public.transactions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 自分の行だけ削除 (DELETE) できる
create policy "delete_own_transactions"
  on public.transactions
  for delete
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- インデックス
-- 月次レポートなど日付での絞り込みと、ユーザーごとの検索を高速化します。
-- ------------------------------------------------------------
create index if not exists idx_transactions_date on public.transactions (date);
create index if not exists idx_transactions_user_id on public.transactions (user_id);

-- ------------------------------------------------------------
-- categories テーブル
-- ユーザーごとのカテゴリ設定(追加・名前変更・絵文字変更・並べ替え・削除)。
-- アプリの初回起動時に既定8カテゴリが自動で登録されます。
-- ------------------------------------------------------------
create table if not exists public.categories (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者。未指定なら実行ユーザーの ID が自動で入る。
  -- ユーザー削除時は関連レコードも一緒に削除される (on delete cascade)
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- transactions.category に保存される値。
  -- 既定カテゴリは 'food' などの固定キー、追加カテゴリは UUID 文字列
  cat_key text not null,

  -- 表示名 (例: 食費)
  label text not null,

  -- 絵文字 (例: 🍚)
  emoji text not null default '📦',

  -- 表示順 (小さいほど上)
  sort_order integer not null default 0,

  -- 削除フラグ。true なら選択肢に出ないが、過去の記録の表示には使われる
  archived boolean not null default false,

  -- レコード作成日時
  created_at timestamptz not null default now(),

  -- 同一ユーザー内でカテゴリキーは重複しない
  unique (user_id, cat_key)
);

-- Row Level Security (transactions と同じく本人の行のみ読み書き可)
alter table public.categories enable row level security;

-- 自分の行だけ参照 (SELECT) できる
create policy "select_own_categories"
  on public.categories
  for select
  using (auth.uid() = user_id);

-- 自分の user_id の行だけ追加 (INSERT) できる
create policy "insert_own_categories"
  on public.categories
  for insert
  with check (auth.uid() = user_id);

-- 自分の行だけ更新 (UPDATE) できる。
-- with check により、更新後も自分の行であることを保証 (user_id の付け替え防止)
create policy "update_own_categories"
  on public.categories
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 自分の行だけ削除 (DELETE) できる
create policy "delete_own_categories"
  on public.categories
  for delete
  using (auth.uid() = user_id);

-- ユーザーごとの取得を高速化
create index if not exists idx_categories_user_id on public.categories (user_id);

-- ------------------------------------------------------------
-- store_categories テーブル
-- 「この店ではこのカテゴリ」を1店1行で覚えます (店名からのカテゴリ自動選択)。
-- 支出を保存するたびに上書きされるので、履歴は持ちません。
-- ------------------------------------------------------------
create table if not exists public.store_categories (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者。未指定なら実行ユーザーの ID が自動で入る。
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- 突き合わせ用に正規化した店名 (全角/半角・大文字小文字・空白を吸収したもの)
  store_key text not null,

  -- 表示・入力補完に使う、ユーザーが実際に入力した店名
  store_name text not null,

  -- その店で最後に選ばれたカテゴリ (categories.cat_key と同じ値)
  category text not null,

  -- 最後に覚え直した日時 (端末間で新しい方を採用するために使う)
  updated_at timestamptz not null default now(),

  -- レコード作成日時
  created_at timestamptz not null default now(),

  -- 同一ユーザー内で店名は重複しない (1店1行)
  unique (user_id, store_key)
);

-- Row Level Security (transactions と同じく本人の行のみ読み書き可)
alter table public.store_categories enable row level security;

create policy "select_own_store_categories"
  on public.store_categories
  for select
  using (auth.uid() = user_id);

create policy "insert_own_store_categories"
  on public.store_categories
  for insert
  with check (auth.uid() = user_id);

create policy "update_own_store_categories"
  on public.store_categories
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete_own_store_categories"
  on public.store_categories
  for delete
  using (auth.uid() = user_id);

-- ユーザーごとの取得を高速化
create index if not exists idx_store_categories_user_id on public.store_categories (user_id);

-- ------------------------------------------------------------
-- recurring_rules テーブル
-- 家賃・サブスクなどを「毎月N日」「毎週X曜」「毎年M月N日」で登録します。
-- サーバー側の cron は使わず、アプリを開いたときに未生成分をまとめて作ります。
-- ------------------------------------------------------------
create table if not exists public.recurring_rules (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者。未指定なら実行ユーザーの ID が自動で入る。
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- 一覧に出す名前 (例: 家賃)
  title text not null,

  -- 繰り返しの種類
  kind text not null check (kind in ('monthly', 'weekly', 'yearly')),

  -- 毎月・毎年の日にち (1〜31)。毎週では null
  day_of_month integer check (day_of_month between 1 and 31),

  -- 毎週の曜日 (0=日 〜 6=土)。毎月・毎年では null
  weekday integer check (weekday between 0 and 6),

  -- 毎年の月 (1〜12)。毎月・毎週では null
  month_of_year integer check (month_of_year between 1 and 12),

  -- 生成する取引の内容 (transactions と同じ意味)
  amount integer not null check (amount > 0),
  category text,
  store text not null default '',
  memo text not null default '',
  partner_amount integer not null default 0
    check (partner_amount >= 0 and partner_amount <= amount),

  -- この日から生成を始める
  start_date date not null default current_date,

  -- 「この日までは生成済み」。null なら一度も生成していない。
  -- 重複生成を防ぐ要なので、生成の直前に必ず更新されます
  last_generated_date date,

  -- false = 停止中 (生成しない)
  active boolean not null default true,

  -- レコード作成日時 (一覧の並び順に使う)
  created_at timestamptz not null default now()
);

-- Row Level Security (transactions と同じく本人の行のみ読み書き可)
alter table public.recurring_rules enable row level security;

create policy "select_own_recurring_rules"
  on public.recurring_rules
  for select
  using (auth.uid() = user_id);

create policy "insert_own_recurring_rules"
  on public.recurring_rules
  for insert
  with check (auth.uid() = user_id);

create policy "update_own_recurring_rules"
  on public.recurring_rules
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete_own_recurring_rules"
  on public.recurring_rules
  for delete
  using (auth.uid() = user_id);

-- ユーザーごとの取得を高速化
create index if not exists idx_recurring_rules_user_id on public.recurring_rules (user_id);

-- ------------------------------------------------------------
-- transaction_templates テーブル
-- よく使う入力 (店・カテゴリ・金額・彼女の負担分) を保存し、
-- 入力タブから1タップで呼び出すためのものです。
-- ------------------------------------------------------------
create table if not exists public.transaction_templates (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者。未指定なら実行ユーザーの ID が自動で入る。
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- チップに出す名前 (空なら店名・メモ・カテゴリ名で補われる)
  title text not null default '',

  -- 呼び出したときにフォームへ入る内容 (transactions と同じ意味)
  amount integer not null check (amount > 0),
  category text,
  store text not null default '',
  memo text not null default '',
  partner_amount integer not null default 0
    check (partner_amount >= 0 and partner_amount <= amount),

  -- 表示順 (小さいほど左)
  sort_order integer not null default 0,

  -- レコード作成日時
  created_at timestamptz not null default now()
);

-- Row Level Security (transactions と同じく本人の行のみ読み書き可)
alter table public.transaction_templates enable row level security;

create policy "select_own_transaction_templates"
  on public.transaction_templates
  for select
  using (auth.uid() = user_id);

create policy "insert_own_transaction_templates"
  on public.transaction_templates
  for insert
  with check (auth.uid() = user_id);

create policy "update_own_transaction_templates"
  on public.transaction_templates
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete_own_transaction_templates"
  on public.transaction_templates
  for delete
  using (auth.uid() = user_id);

-- ユーザーごとの取得を高速化
create index if not exists idx_transaction_templates_user_id
  on public.transaction_templates (user_id);

-- ============================================================
-- 彼女向けの共有機能
--   閲覧専用の共有リンク / 明細へのコメント / 月末サマリーの送信記録
--
-- 設計の要点(ここが安全性の肝):
--   * 彼女はアカウントを持たないので、共有ページは anon キーでアクセスする。
--   * しかし anon には transactions を1行も読ませない。
--     - RLS(本人の行のみ)に加えて、テーブル権限そのものを anon から revoke する。
--     - 彼女に見せる行は security definer 関数(RPC)が組み立てて返す。
--   * したがって「トークンを知らないと何も読めない」「トークンを知っていても
--     彼女に関係する行しか返ってこない」の2段構えになる。
--
-- 既存プロジェクトへの追加は supabase/migration-partner-share.sql を実行する。
-- 内容は同じもので、どちらも複数回実行して安全。
-- ============================================================

create extension if not exists pgcrypto;


-- security definer にしているのは、pgcrypto がどのスキーマに入っていても
-- 確実に呼べるようにするため(乱数を返すだけなので情報は漏れない)。
create or replace function public.partner_share_new_token()
returns text
language sql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
  select encode(gen_random_bytes(24), 'hex')
$$;

-- ------------------------------------------------------------
-- 1. partner_share_links テーブル
-- 彼女に渡す閲覧専用リンク。1人で複数発行できます(再発行しても古い方を
-- 明示的に無効化するまでは生きるので、UI 側は再発行時に必ず revoke します)。
-- ------------------------------------------------------------
create table if not exists public.partner_share_links (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者。未指定なら実行ユーザーの ID が自動で入る。
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- URL に載せる秘密の文字列。これを知っている人だけがページを見られる。
  -- 32文字未満は関数側で門前払いするので、既定の48文字から短くしないこと。
  token text not null unique default public.partner_share_new_token(),

  -- 有効期限。null なら無期限。過ぎたリンクは閲覧も書き込みもできなくなる。
  expires_at timestamptz,

  -- 無効化した日時。null 以外なら即座に閲覧も書き込みもできなくなる。
  revoked_at timestamptz,

  -- 最後に見られた日時(利用者の画面に「最後に見た日」を出すため)
  last_viewed_at timestamptz,

  -- レコード作成日時
  created_at timestamptz not null default now()
);

alter table public.partner_share_links enable row level security;

-- 本人(ログインした利用者)だけが自分のリンクを読み書きできる。
-- anon 向けのポリシーは1つも作らない = トークンの直接照会は不可能。
drop policy if exists "select_own_partner_share_links" on public.partner_share_links;
create policy "select_own_partner_share_links"
  on public.partner_share_links
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert_own_partner_share_links" on public.partner_share_links;
create policy "insert_own_partner_share_links"
  on public.partner_share_links
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "update_own_partner_share_links" on public.partner_share_links;
create policy "update_own_partner_share_links"
  on public.partner_share_links
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete_own_partner_share_links" on public.partner_share_links;
create policy "delete_own_partner_share_links"
  on public.partner_share_links
  for delete
  using (auth.uid() = user_id);

create index if not exists idx_partner_share_links_user_id
  on public.partner_share_links (user_id);

-- ------------------------------------------------------------
-- 2. partner_share_comments テーブル
-- 明細1件ごとのコメント。利用者(owner)はアプリから、彼女(partner)は
-- 共有ページから書きます。彼女の書き込みは必ず RPC 経由なので、
-- このテーブルへの anon の直接 INSERT 権限は与えません。
-- ------------------------------------------------------------
create table if not exists public.partner_share_comments (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- データの持ち主(= 利用者)。彼女の書き込みでは RPC がリンクの持ち主を入れる。
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- コメント先の明細。明細が消えたらコメントも消える。
  transaction_id uuid not null references public.transactions (id) on delete cascade,

  -- 書いた人。'owner' = 利用者(アプリから) / 'partner' = 彼女(共有ページから)
  author text not null check (author in ('owner', 'partner')),

  -- 本文。荒らし対策その1: 1件あたりの長さをデータベース側で縛る。
  body text not null check (char_length(body) between 1 and 300),

  -- どの共有リンクから書かれたか(彼女の投稿のみ)。連投制限の集計に使う。
  -- リンクを削除してもコメントは残す (on delete set null)
  link_id uuid references public.partner_share_links (id) on delete set null,

  -- 利用者が読んだか。彼女の投稿は false で入り、アプリで開くと true になる。
  read_by_owner boolean not null default false,

  -- レコード作成日時(スレッドの並び順と連投制限の判定に使う)
  created_at timestamptz not null default now()
);

alter table public.partner_share_comments enable row level security;

-- 本人だけが読み書きできる。彼女(anon)向けのポリシーは作らない。
drop policy if exists "select_own_partner_share_comments" on public.partner_share_comments;
create policy "select_own_partner_share_comments"
  on public.partner_share_comments
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert_own_partner_share_comments" on public.partner_share_comments;
create policy "insert_own_partner_share_comments"
  on public.partner_share_comments
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "update_own_partner_share_comments" on public.partner_share_comments;
create policy "update_own_partner_share_comments"
  on public.partner_share_comments
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete_own_partner_share_comments" on public.partner_share_comments;
create policy "delete_own_partner_share_comments"
  on public.partner_share_comments
  for delete
  using (auth.uid() = user_id);

create index if not exists idx_partner_share_comments_user_id
  on public.partner_share_comments (user_id);
create index if not exists idx_partner_share_comments_transaction_id
  on public.partner_share_comments (transaction_id);
-- 連投制限は「このリンクから直近1分/1日に何件書かれたか」を数えるので、
-- link_id + created_at の複合インデックスを用意しておく
create index if not exists idx_partner_share_comments_link_created
  on public.partner_share_comments (link_id, created_at desc);

-- ------------------------------------------------------------
-- 3. partner_summary_sends テーブル (機能016)
-- 「この月のサマリーはもう Discord に送った」という印。
-- (user_id, month) の一意制約が二重送信を防ぐ唯一の砦なので外さないこと。
-- 複数端末が同時にアプリを開いても、INSERT に成功した1台だけが送ります。
-- ------------------------------------------------------------
create table if not exists public.partner_summary_sends (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- 送信済みの月 ('YYYY-MM')
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),

  -- 送信した日時
  sent_at timestamptz not null default now(),

  -- 同じ月を二度送らないための一意制約(重複防止の要)
  unique (user_id, month)
);

alter table public.partner_summary_sends enable row level security;

drop policy if exists "select_own_partner_summary_sends" on public.partner_summary_sends;
create policy "select_own_partner_summary_sends"
  on public.partner_summary_sends
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert_own_partner_summary_sends" on public.partner_summary_sends;
create policy "insert_own_partner_summary_sends"
  on public.partner_summary_sends
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "delete_own_partner_summary_sends" on public.partner_summary_sends;
create policy "delete_own_partner_summary_sends"
  on public.partner_summary_sends
  for delete
  using (auth.uid() = user_id);

create index if not exists idx_partner_summary_sends_user_id
  on public.partner_summary_sends (user_id);

-- ------------------------------------------------------------
-- 4. anon からテーブル権限を剥がす
--
-- RLS だけでも anon は他人の行を読めませんが、「うっかりポリシーを1つ足すと
-- 全部見えてしまう」状態を避けるため、テーブル権限そのものを落とします。
-- 彼女がアクセスするのは下の security definer 関数だけです。
-- (ログイン後のアプリは authenticated ロールで動くので影響ありません)
-- ------------------------------------------------------------
-- 存在しないテーブルを revoke するとスクリプト全体が止まってしまうので、
-- 実在するものだけを対象にする(古いスキーマのままの環境でも最後まで通す)
do $$
declare
  t text;
begin
  foreach t in array array[
    'transactions',
    'categories',
    'store_categories',
    'recurring_rules',
    'transaction_templates',
    'partner_share_links',
    'partner_share_comments',
    'partner_summary_sends'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on table public.%I from anon', t);
    end if;
  end loop;
end
$$;

-- ------------------------------------------------------------
-- 5. partner_share_view(token) — 共有ページが読むもの
--
-- security definer なので RLS を越えて transactions を読めますが、
-- **返すのは彼女に関係する行だけ**です:
--   - 預かり金の残高
--   - 預かった履歴 (type = 'partner_deposit')
--   - 彼女の負担分がある支出だけ (partner_amount > 0)。しかも返す金額は
--     partner_amount のみで、支払い総額 (amount) は絶対に返しません。
--   - 利用者個人の支出 (partner_amount = 0) は1行も返しません。
--
-- トークンが無い・無効化済み・期限切れのときは、区別せず {"ok": false} を返します
-- (存在の有無を漏らさないため)。
-- ------------------------------------------------------------
create or replace function public.partner_share_view(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.partner_share_links;
  v_balance integer;
  v_deposits jsonb;
  v_charges jsonb;
  v_comments jsonb;
begin
  -- 明らかに形式が違うトークンは総当たりの的にしかならないので即座に断る
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 128 then
    return jsonb_build_object('ok', false);
  end if;

  select * into v_link
    from public.partner_share_links
   where token = p_token
     and revoked_at is null
     and (expires_at is null or expires_at > now())
   limit 1;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  -- 「最後に見られた日」を利用者の画面に出すために更新する
  update public.partner_share_links set last_viewed_at = now() where id = v_link.id;

  -- 残高 = 預かった額の合計 − 彼女の負担分の合計
  select coalesce(sum(case when t.type = 'partner_deposit' then t.amount else -t.partner_amount end), 0)
    into v_balance
    from public.transactions t
   where t.user_id = v_link.user_id;

  -- 預かった履歴
  select coalesce(
           jsonb_agg(
             jsonb_build_object('id', t.id, 'date', t.date, 'amount', t.amount)
             order by t.date desc, t.created_at desc
           ),
           '[]'::jsonb
         )
    into v_deposits
    from public.transactions t
   where t.user_id = v_link.user_id
     and t.type = 'partner_deposit';

  -- 彼女の負担分がある支出だけ。amount(支払い総額)は含めない。
  -- カテゴリ名は彼女の端末では解決できないので、ここで表示名まで解決して返す。
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', t.id,
               'date', t.date,
               'store', t.store,
               'amount', t.partner_amount,
               'category', t.category,
               'category_label', c.label
             )
             order by t.date desc, t.created_at desc
           ),
           '[]'::jsonb
         )
    into v_charges
    from public.transactions t
    left join public.categories c
      on c.user_id = t.user_id and c.cat_key = t.category
   where t.user_id = v_link.user_id
     and t.type = 'expense'
     and t.partner_amount > 0;

  -- 上で返した明細に紐づくコメントだけを返す
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', cm.id,
               'transaction_id', cm.transaction_id,
               'author', cm.author,
               'body', cm.body,
               'created_at', cm.created_at
             )
             order by cm.created_at asc
           ),
           '[]'::jsonb
         )
    into v_comments
    from public.partner_share_comments cm
    join public.transactions t on t.id = cm.transaction_id
   where cm.user_id = v_link.user_id
     and t.user_id = v_link.user_id
     and (t.type = 'partner_deposit' or (t.type = 'expense' and t.partner_amount > 0));

  return jsonb_build_object(
    'ok', true,
    'balance', v_balance,
    'deposits', v_deposits,
    'charges', v_charges,
    'comments', v_comments,
    'expires_at', v_link.expires_at,
    'max_comment_length', 300
  );
end;
$$;

-- ------------------------------------------------------------
-- 6. partner_share_add_comment(token, transaction_id, body) — 彼女の書き込み
--
-- 荒らし・事故への対策(すべてサーバー側で効きます):
--   a. リンクが無効化・期限切れなら書けない(閲覧と同じ判定を通す)
--   b. 本文は前後の空白を落としたうえで 1〜300文字。超過は保存しない
--   c. 直近1分間に3件まで、直近24時間に50件まで(リンク単位)
--   d. コメントを付けられるのは「彼女に見えている明細」だけ。
--      他人の明細IDを当てても書けないし、存在の有無も返さない
-- ------------------------------------------------------------
create or replace function public.partner_share_add_comment(
  p_token text,
  p_transaction_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.partner_share_links;
  v_body text;
  v_recent integer;
  v_daily integer;
  v_visible boolean;
  v_id uuid;
  v_created timestamptz;
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 128 then
    return jsonb_build_object('ok', false, 'reason', 'link');
  end if;

  select * into v_link
    from public.partner_share_links
   where token = p_token
     and revoked_at is null
     and (expires_at is null or expires_at > now())
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'link');
  end if;

  -- 本文の正規化と長さ制限
  v_body := btrim(coalesce(p_body, ''));
  if char_length(v_body) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  if char_length(v_body) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'length');
  end if;

  -- 連投制限 (リンク単位)。サーバー時刻で判定するので端末の時計はいじれない
  select count(*) into v_recent
    from public.partner_share_comments
   where link_id = v_link.id
     and created_at > now() - interval '1 minute';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;

  select count(*) into v_daily
    from public.partner_share_comments
   where link_id = v_link.id
     and created_at > now() - interval '1 day';
  if v_daily >= 50 then
    return jsonb_build_object('ok', false, 'reason', 'rate_day');
  end if;

  -- 彼女に見えている明細か(見えない明細には書けない)
  select true into v_visible
    from public.transactions t
   where t.id = p_transaction_id
     and t.user_id = v_link.user_id
     and (t.type = 'partner_deposit' or (t.type = 'expense' and t.partner_amount > 0))
   limit 1;

  if v_visible is not true then
    -- 明細が無いのか見えないだけなのかは区別せずに断る
    return jsonb_build_object('ok', false, 'reason', 'link');
  end if;

  insert into public.partner_share_comments
    (user_id, transaction_id, author, body, link_id, read_by_owner)
  values
    (v_link.user_id, p_transaction_id, 'partner', v_body, v_link.id, false)
  returning id, created_at into v_id, v_created;

  return jsonb_build_object(
    'ok', true,
    'comment', jsonb_build_object(
      'id', v_id,
      'transaction_id', p_transaction_id,
      'author', 'partner',
      'body', v_body,
      'created_at', v_created
    )
  );
end;
$$;

-- ------------------------------------------------------------
-- 7. 関数の実行権限
-- 既定では public(= 全ロール)に execute が付くので、いったん剥がしてから
-- 必要なロールにだけ与えます。
-- ------------------------------------------------------------
revoke all on function public.partner_share_new_token() from public;
grant execute on function public.partner_share_new_token() to authenticated;

revoke all on function public.partner_share_view(text) from public;
grant execute on function public.partner_share_view(text) to anon, authenticated;

revoke all on function public.partner_share_add_comment(text, uuid, text) from public;
grant execute on function public.partner_share_add_comment(text, uuid, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 8. 確認用 (任意)
-- 下のクエリを実行して、anon に transactions の権限が1つも無いことを
-- 確かめられます。0行なら正しい状態です。
--
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'transactions'
--      and grantee = 'anon';
-- ------------------------------------------------------------
