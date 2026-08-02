-- ============================================================
-- お店(店名)フィールドの追加マイグレーション
--
-- すでに schema.sql を実行済みの既存プロジェクトに、
-- transactions テーブルの store カラム(お店・店名)を追加するためのSQLです。
-- Supabase の SQL Editor にそのまま貼り付けて Run を1回実行してください。
-- (add column if not exists 付きなので、誤って複数回実行しても安全です)
--
-- ※ これから新規にセットアップする場合は、最新の schema.sql に
--    この内容が含まれているため、実行は不要です。
-- ============================================================

-- お店 (店名。任意。既定は空文字。支出でのみ使用)
alter table public.transactions
  add column if not exists store text not null default '';
