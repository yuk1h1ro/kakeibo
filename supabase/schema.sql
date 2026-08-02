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

  -- 支出のうち彼女の負担分 (円)。彼女の預かり残高から差し引かれる。
  -- 0 以上かつ支払い総額 (amount) 以下であること。
  partner_amount integer not null default 0
    check (partner_amount >= 0 and partner_amount <= amount),

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
