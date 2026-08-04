-- ============================================================
-- 感情スタンプ (満足 / 普通 / 後悔) の追加マイグレーション
--
-- すでに schema.sql を実行済みの既存プロジェクトに、
-- transactions テーブルの satisfaction カラムを追加するためのSQLです。
-- Supabase の SQL Editor にそのまま貼り付けて Run を1回実行してください。
-- (if not exists / drop constraint if exists 付きなので、
--  誤って複数回実行しても安全です)
--
-- 入力時に押すスタンプも、あとからまとめて仕分ける画面も、
-- この1列だけを読み書きします(データを二重に持ちません)。
--
-- ※ 実行しなくても記録・入力・同期はこれまでどおり動きます。
--    その場合、アプリ側で感情スタンプの導線が静かに消えるだけです。
-- ============================================================

-- 感情スタンプ (任意。null = 未設定)
alter table public.transactions
  add column if not exists satisfaction text;

-- 想定外の値が入らないようにする。null (未設定) は許可する
alter table public.transactions
  drop constraint if exists transactions_satisfaction_check;

alter table public.transactions
  add constraint transactions_satisfaction_check
  check (satisfaction is null or satisfaction in ('good', 'neutral', 'regret'));
