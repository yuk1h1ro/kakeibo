-- ============================================================
-- 店名からカテゴリを学習する機能の追加マイグレーション
--
-- すでに schema.sql を実行済みの既存プロジェクトに、
-- store_categories テーブルを追加するためのSQLです。
-- Supabase の SQL Editor にそのまま貼り付けて Run を1回実行してください。
-- (if not exists / drop policy if exists 付きなので、
--  誤って複数回実行しても安全です)
--
-- ※ これから新規にセットアップする場合は、最新の schema.sql に
--    この内容が含まれているため、実行は不要です。
-- ※ 実行しなくても記録・入力はこれまでどおり使えます
--    (学習内容がこの端末の中だけに保存され、他の端末と同期されません)。
-- ============================================================

-- ------------------------------------------------------------
-- store_categories テーブル
-- 「この店ではこのカテゴリ」を1店1行で覚えます。
-- 支出を保存するたびに上書きされるので、履歴は持ちません。
-- ------------------------------------------------------------
create table if not exists public.store_categories (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者。未指定なら実行ユーザーの ID が自動で入る。
  -- ユーザー削除時は関連レコードも一緒に削除される (on delete cascade)
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

-- ------------------------------------------------------------
-- Row Level Security (RLS)
-- transactions と同じく、ログインした本人の行しか読み書きできません。
-- (create policy には if not exists が無いため、
--  drop してから作り直すことで再実行に耐えるようにしています)
-- ------------------------------------------------------------
alter table public.store_categories enable row level security;

drop policy if exists "select_own_store_categories" on public.store_categories;
create policy "select_own_store_categories"
  on public.store_categories
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert_own_store_categories" on public.store_categories;
create policy "insert_own_store_categories"
  on public.store_categories
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "update_own_store_categories" on public.store_categories;
create policy "update_own_store_categories"
  on public.store_categories
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete_own_store_categories" on public.store_categories;
create policy "delete_own_store_categories"
  on public.store_categories
  for delete
  using (auth.uid() = user_id);

-- ユーザーごとの取得を高速化
create index if not exists idx_store_categories_user_id on public.store_categories (user_id);
