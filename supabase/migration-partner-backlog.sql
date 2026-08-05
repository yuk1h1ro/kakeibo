-- ============================================================
-- 預かり金の履歴を「まとめて Discord に送る」ための追加マイグレーション
--
-- すでに schema.sql を実行済みの既存プロジェクトに、
-- partner_backlog_sends テーブルを追加するためのSQLです。
-- Supabase の SQL Editor にそのまま貼り付けて Run を1回実行してください。
-- (if not exists / drop policy if exists 付きなので、
--  誤って複数回実行しても安全です)
--
-- ※ これから新規にセットアップする場合は、最新の schema.sql に
--    この内容が含まれているため、実行は不要です。
-- ※ 実行しなくてもまとめ送信は使えます。
--    「どこまで送ったか」がその端末の中だけに残るため、
--    **別の端末から開くと「前回の続き」が分からない**(全期間しか選べない)
--    という状態になるだけです。記録・入力・同期はこれまでどおり動きます。
--
-- ---- なぜテーブルを1つ増やしたのか ----
-- この機能が必要になった原因そのものが「Discord の設定が端末の中にしか
-- 無かったこと」でした。同じ轍を踏まないよう、**どこまで送ったか**も
-- 端末に閉じ込めません。PCで追いつかせたのにスマホで全部送り直す、が起きると
-- 彼女の通知欄が同じ履歴で二度埋まります。
--
-- 月末サマリーの partner_summary_sends(送った月を1行ずつ積む)と作りが違うのは、
-- 覚えたいものが違うためです。あちらは「送った月の集合」で、こちらは
-- 「どこまで送ったかの1点(カーソル)」しか要りません。行を積む形にすると、
-- 途中で失敗した回の半端な行が残り、次に読むときどれが正なのかを決められません。
-- 1ユーザー1行で、**進んだ方向にだけ**書き換えます。
--
-- discord_settings に列を足す案も検討しましたが、送り先(秘密のトークン)と
-- 送信の進み具合は寿命も意味も違うので、混ぜませんでした。
-- 「解除」で送り先を消したときに、送信済みの記憶まで一緒に消えるのは誤りです。
-- ============================================================

-- ------------------------------------------------------------
-- partner_backlog_sends テーブル
-- 1ユーザー1行。user_id が主キーなので、行が増えることはありません。
--
-- カーソル (last_date / last_created_at / last_tx_id) は、アプリ側の並び順
-- (日付 → 記録日時 → ID)と同じ3つ組です。日付だけでは同じ日の複数件を
-- 区切れないため、3つとも持ちます。
-- ------------------------------------------------------------
create table if not exists public.partner_backlog_sends (
  -- 行の所有者 兼 主キー。未指定なら実行ユーザーの ID が自動で入る
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,

  -- ここまで送った、という目印(送信済みの最後の明細)
  last_date text check (last_date is null or last_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  last_created_at text,
  last_tx_id text,

  -- 表示用の累計。「前回いつ・どれだけ送ったか」を画面に出すためだけに持つ
  sent_entries integer not null default 0 check (sent_entries >= 0),
  sent_messages integer not null default 0 check (sent_messages >= 0),

  -- 最後に送った日時
  last_sent_at timestamptz,

  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.partner_backlog_sends is
  '預かり金の履歴を Discord へまとめ送りした進み具合。1ユーザー1行。'
  '端末をまたいで同じ履歴を二度送らないために置いている。';

comment on column public.partner_backlog_sends.last_tx_id is
  'ここまで送った、という目印。アプリの並び順(日付→記録日時→ID)の3つ組で持つ。'
  'この目印は前に進めるだけで、決して戻さない(戻すと送信済みが再送される)。';

-- ------------------------------------------------------------
-- Row Level Security (RLS)
-- transactions と同じく、ログインした本人の行しか読み書きできません。
-- (create policy には if not exists が無いため、
--  drop してから作り直すことで再実行に耐えるようにしています)
-- ------------------------------------------------------------
alter table public.partner_backlog_sends enable row level security;

drop policy if exists "select_own_partner_backlog_sends" on public.partner_backlog_sends;
create policy "select_own_partner_backlog_sends"
  on public.partner_backlog_sends
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert_own_partner_backlog_sends" on public.partner_backlog_sends;
create policy "insert_own_partner_backlog_sends"
  on public.partner_backlog_sends
  for insert
  with check (auth.uid() = user_id);

-- 進み具合の記録は upsert (insert ... on conflict do update) で書くため、
-- update 側のポリシーが無いと2回目以降だけが静かに失敗します。
drop policy if exists "update_own_partner_backlog_sends" on public.partner_backlog_sends;
create policy "update_own_partner_backlog_sends"
  on public.partner_backlog_sends
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete_own_partner_backlog_sends" on public.partner_backlog_sends;
create policy "delete_own_partner_backlog_sends"
  on public.partner_backlog_sends
  for delete
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- anon からテーブル権限を剥がす
--
-- 彼女の共有ページは anon キーでアクセスします。RLS だけでも他人の行は
-- 読めませんが、「うっかりポリシーを1つ足すと全部見えてしまう」状態を避けるため、
-- migration-partner-share.sql と同じ作法でテーブル権限そのものを落とします。
-- (ログイン後のアプリは authenticated ロールで動くので影響ありません)
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.partner_backlog_sends') is not null then
    revoke all on table public.partner_backlog_sends from anon;
  end if;
end
$$;

-- ------------------------------------------------------------
-- 確認用 (任意)
-- 下のクエリで、anon に partner_backlog_sends の権限が1つも無いことを
-- 確かめられます。0行なら正しい状態です。
--
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'partner_backlog_sends'
--      and grantee = 'anon';
-- ------------------------------------------------------------
