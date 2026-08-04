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
