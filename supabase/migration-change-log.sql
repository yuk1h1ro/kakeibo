-- ============================================================
-- 変更履歴 (機能163) の追加マイグレーション
--
-- すでに schema.sql を実行済みのプロジェクトに、
-- transaction_changes テーブルを追加するためのSQLです。
-- Supabase の SQL Editor にそのまま貼り付けて Run を1回実行してください。
-- (if not exists / drop policy if exists 付きなので、
--  誤って複数回実行しても安全です)
--
-- 「いつ・どの記録を・何から何に」直したかを残します。
-- 使う人は1人なので「誰が」は残しません(列そのものがありません)。
--
-- ※ 実行しなくても記録・入力・同期はこれまでどおり動きます。
--    その場合、履歴タブの「変更履歴」の導線が静かに消えるだけです。
-- ============================================================

-- ------------------------------------------------------------
-- transaction_changes テーブル
--
-- transaction_id には外部キーを張っていません。
-- 削除した記録の履歴こそ後から見たいのに、外部キーがあると
-- 元の行が消えた時点で履歴まで道連れになってしまうためです。
-- ------------------------------------------------------------
create table if not exists public.transaction_changes (
  -- 主キー。アプリ側で採番した UUID をそのまま入れる
  -- (オフラインで貯めた分を後からまとめて送っても二重にならないようにするため)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者。未指定なら実行ユーザーの ID が自動で入る
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- どの記録についての履歴か (transactions.id。外部キーにはしない)
  transaction_id uuid not null,

  -- 何をしたか: 'update' = 変更 / 'delete' = 削除 / 'restore' = 元に戻した
  action text not null check (action in ('update', 'delete', 'restore')),

  -- どの記録かが分かる1行 (日付・お店/カテゴリ・金額)。
  -- 記録が消えたあとでも読めるように、文字列として写しを持たせる
  summary text not null default '',

  -- 「何から何に」の一覧。[{ "label": "金額", "from": "¥1,000", "to": "¥1,200" }, ...]
  -- カテゴリ名はその時点の名前で残す(後で名前を変えても履歴の意味が変わらない)
  changes jsonb not null default '[]'::jsonb,

  -- いつ直したか
  changed_at timestamptz not null default now()
);

-- 新しい順に読むだけなので、この1本で足りる
create index if not exists transaction_changes_user_changed_at_idx
  on public.transaction_changes (user_id, changed_at desc);

-- ------------------------------------------------------------
-- Row Level Security (RLS)
-- transactions と同じく、ログインした本人の行しか読み書きできません。
-- ------------------------------------------------------------
alter table public.transaction_changes enable row level security;

drop policy if exists "select_own_transaction_changes" on public.transaction_changes;
create policy "select_own_transaction_changes"
  on public.transaction_changes
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert_own_transaction_changes" on public.transaction_changes;
create policy "insert_own_transaction_changes"
  on public.transaction_changes
  for insert
  with check (auth.uid() = user_id);

-- 古い履歴の掃除 (アプリが 180日より前の行を消します)
drop policy if exists "delete_own_transaction_changes" on public.transaction_changes;
create policy "delete_own_transaction_changes"
  on public.transaction_changes
  for delete
  using (auth.uid() = user_id);

-- 履歴は「書いたら直さない」ものなので update ポリシーは作りません
-- (ポリシーが無い操作は RLS により誰も実行できません)

-- ------------------------------------------------------------
-- 共有ページ (機能179) から見えないようにする
-- 彼女に渡すリンクは anon キーで開くため、明示的に権限を剥がしておきます。
-- (migration-partner-share.sql と同じ考え方)
-- ------------------------------------------------------------
revoke all on table public.transaction_changes from anon;
