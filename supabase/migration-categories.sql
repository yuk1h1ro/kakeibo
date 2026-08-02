-- ============================================================
-- カテゴリ設定機能の追加マイグレーション
--
-- すでに schema.sql を実行済みの既存プロジェクトに、
-- categories テーブルを追加するためのSQLです。
-- Supabase の SQL Editor にそのまま貼り付けて実行してください。
-- (if not exists / drop policy if exists 付きなので、
--  誤って複数回実行しても安全です)
--
-- ※ これから新規にセットアップする場合は、最新の schema.sql に
--    この内容が含まれているため、実行は不要です。
-- ============================================================

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

-- ------------------------------------------------------------
-- Row Level Security (RLS)
-- transactions と同じく、ログインした本人の行しか読み書きできません。
-- (create policy には if not exists が無いため、
--  drop してから作り直すことで再実行に耐えるようにしています)
-- ------------------------------------------------------------
alter table public.categories enable row level security;

-- 自分の行だけ参照 (SELECT) できる
drop policy if exists "select_own_categories" on public.categories;
create policy "select_own_categories"
  on public.categories
  for select
  using (auth.uid() = user_id);

-- 自分の user_id の行だけ追加 (INSERT) できる
drop policy if exists "insert_own_categories" on public.categories;
create policy "insert_own_categories"
  on public.categories
  for insert
  with check (auth.uid() = user_id);

-- 自分の行だけ更新 (UPDATE) できる。
-- with check により、更新後も自分の行であることを保証 (user_id の付け替え防止)
drop policy if exists "update_own_categories" on public.categories;
create policy "update_own_categories"
  on public.categories
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 自分の行だけ削除 (DELETE) できる
drop policy if exists "delete_own_categories" on public.categories;
create policy "delete_own_categories"
  on public.categories
  for delete
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- インデックス
-- ユーザーごとの取得を高速化します。
-- ------------------------------------------------------------
create index if not exists idx_categories_user_id on public.categories (user_id);
