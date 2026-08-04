-- ============================================================
-- 繰り返し(定期)入力の追加マイグレーション
--
-- すでに schema.sql を実行済みの既存プロジェクトに、
-- recurring_rules テーブルと transactions.source 列を追加するためのSQLです。
-- Supabase の SQL Editor にそのまま貼り付けて Run を1回実行してください。
-- (if not exists / drop policy if exists 付きなので、
--  誤って複数回実行しても安全です)
--
-- ※ これから新規にセットアップする場合は、最新の schema.sql に
--    この内容が含まれているため、実行は不要です。
-- ※ 実行しなくても記録・入力はこれまでどおり使えます
--    (繰り返し入力の設定画面が出ないだけです)。
-- ============================================================

-- ------------------------------------------------------------
-- transactions.source 列
-- 'recurring' なら繰り返し入力が自動生成した行。手入力の行は空文字のまま。
-- (アプリは手入力時にこの列を送らないため、この列が無くても手入力は通ります)
-- ------------------------------------------------------------
alter table public.transactions
  add column if not exists source text not null default '';

-- ------------------------------------------------------------
-- recurring_rules テーブル
-- 家賃・サブスクなどを「毎月N日」「毎週X曜」「毎年M月N日」で登録します。
-- サーバー側の cron は使わず、アプリを開いたときに未生成分をまとめて作ります。
-- ------------------------------------------------------------
create table if not exists public.recurring_rules (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者。未指定なら実行ユーザーの ID が自動で入る。
  -- ユーザー削除時は関連レコードも一緒に削除される (on delete cascade)
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

-- ------------------------------------------------------------
-- Row Level Security (RLS)
-- transactions と同じく、ログインした本人の行しか読み書きできません。
-- ------------------------------------------------------------
alter table public.recurring_rules enable row level security;

drop policy if exists "select_own_recurring_rules" on public.recurring_rules;
create policy "select_own_recurring_rules"
  on public.recurring_rules
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert_own_recurring_rules" on public.recurring_rules;
create policy "insert_own_recurring_rules"
  on public.recurring_rules
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "update_own_recurring_rules" on public.recurring_rules;
create policy "update_own_recurring_rules"
  on public.recurring_rules
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete_own_recurring_rules" on public.recurring_rules;
create policy "delete_own_recurring_rules"
  on public.recurring_rules
  for delete
  using (auth.uid() = user_id);

-- ユーザーごとの取得を高速化
create index if not exists idx_recurring_rules_user_id on public.recurring_rules (user_id);
