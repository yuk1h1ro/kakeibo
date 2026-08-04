-- ============================================================
-- よく使う入力のテンプレートの追加マイグレーション
--
-- すでに schema.sql を実行済みの既存プロジェクトに、
-- transaction_templates テーブルを追加するためのSQLです。
-- Supabase の SQL Editor にそのまま貼り付けて Run を1回実行してください。
-- (if not exists / drop policy if exists 付きなので、
--  誤って複数回実行しても安全です)
--
-- ※ これから新規にセットアップする場合は、最新の schema.sql に
--    この内容が含まれているため、実行は不要です。
-- ※ 実行しなくても記録・入力はこれまでどおり使えます
--    (テンプレートの導線が出ないだけです)。
-- ============================================================

-- ------------------------------------------------------------
-- transaction_templates テーブル
-- 店・カテゴリ・金額・彼女の負担分の組み合わせを保存し、
-- 入力タブから1タップで呼び出すためのものです。
-- ------------------------------------------------------------
create table if not exists public.transaction_templates (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者。未指定なら実行ユーザーの ID が自動で入る。
  -- ユーザー削除時は関連レコードも一緒に削除される (on delete cascade)
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

-- ------------------------------------------------------------
-- Row Level Security (RLS)
-- transactions と同じく、ログインした本人の行しか読み書きできません。
-- ------------------------------------------------------------
alter table public.transaction_templates enable row level security;

drop policy if exists "select_own_transaction_templates" on public.transaction_templates;
create policy "select_own_transaction_templates"
  on public.transaction_templates
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert_own_transaction_templates" on public.transaction_templates;
create policy "insert_own_transaction_templates"
  on public.transaction_templates
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "update_own_transaction_templates" on public.transaction_templates;
create policy "update_own_transaction_templates"
  on public.transaction_templates
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete_own_transaction_templates" on public.transaction_templates;
create policy "delete_own_transaction_templates"
  on public.transaction_templates
  for delete
  using (auth.uid() = user_id);

-- ユーザーごとの取得を高速化
create index if not exists idx_transaction_templates_user_id
  on public.transaction_templates (user_id);
