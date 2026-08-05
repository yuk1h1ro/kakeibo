-- ============================================================
-- Discord の Webhook URL を端末間で同期する 追加マイグレーション
--
-- すでに schema.sql を実行済みの既存プロジェクトに、
-- discord_settings テーブルを追加するためのSQLです。
-- Supabase の SQL Editor にそのまま貼り付けて Run を1回実行してください。
-- (if not exists / drop policy if exists 付きなので、
--  誤って複数回実行しても安全です)
--
-- ※ これから新規にセットアップする場合は、最新の schema.sql に
--    この内容が含まれているため、実行は不要です。
-- ※ 実行しなくても Discord 通知はこれまでどおり使えます
--    (Webhook URL がその端末の中だけに保存され、他の端末と同期されない
--     = 設定した端末で記録した分しか通知されない、という従来の状態のままです)。
--
-- ---- なぜテーブルを増やしてまで同期するのか ----
-- Webhook URL は端末の localStorage にしかありませんでした。そのため
-- 「PCでは設定したがスマホではしていない」状態が起こり、**いちばん入力に
-- 使っているスマホからの記録だけが通知されない**という事故が実際に起きました。
-- 通知は彼女に残高の増減を知らせるための機能なので、ここが抜けると
-- 機能そのものの存在理由が失われます。
--
-- ---- 秘密の扱いについて ----
-- Webhook URL は「知っていれば誰でもそのチャンネルに投稿できる」トークンです。
-- ただし RLS で本人の行だけに絞ったうえで anon からテーブル権限を剥がして
-- 置く分には、端末の localStorage に置くより危険が増えません。
-- むしろ端末を失くしたときは、ログアウトの後始末で端末側だけを消せます
-- (サーバーには残るので、次の端末でログインすれば設定し直さずに済みます)。
-- Gemini の APIキーは同期しません(レシートを撮るのはスマホだけで、
-- 鍵を移動させない方が安全なため)。
-- ============================================================

-- ------------------------------------------------------------
-- discord_settings テーブル
-- 1ユーザー1行。user_id を主キーにしているので、行が増えることはありません。
--
-- webhook_url を null 許容にして「解除」を **行の削除ではなく null の保存**で
-- 表しているのは、解除を他の端末へ確実に伝えるためです。行ごと消すと、
-- 古い URL をキャッシュしたままの端末が次に開いたときに「サーバーには何も無い
-- = まだ誰も設定していない」と読み、キャッシュを引き上げ直して
-- **解除したはずの通知が復活**してしまいます。
-- ------------------------------------------------------------
create table if not exists public.discord_settings (
  -- 行の所有者 兼 主キー。未指定なら実行ユーザーの ID が自動で入る。
  -- ユーザー削除時は一緒に削除される (on delete cascade)
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,

  -- Discord の Webhook URL。null = 未設定、または解除済み
  webhook_url text,

  -- 最後に設定・解除した日時
  updated_at timestamptz not null default now(),

  -- レコード作成日時
  created_at timestamptz not null default now()
);

-- 形式のおかしな値を置かせない。アプリ側 (discordWebhook.ts の
-- isValidWebhookUrl) と同じ条件を、画面を通さない書き込みにも効かせる。
-- 長さの上限は、極端に長い文字列を置き場所に使われないための歯止め。
alter table public.discord_settings
  drop constraint if exists discord_settings_webhook_url_check;

alter table public.discord_settings
  add constraint discord_settings_webhook_url_check
  check (
    webhook_url is null
    or (
      char_length(webhook_url) between 34 and 300
      and (
        webhook_url like 'https://discord.com/api/webhooks/%'
        or webhook_url like 'https://discordapp.com/api/webhooks/%'
      )
    )
  );

comment on table public.discord_settings is
  '彼女への Discord 通知の送り先。1ユーザー1行。'
  '端末間で同期するために置いている(端末ごとの localStorage はキャッシュ)。';

comment on column public.discord_settings.webhook_url is
  'Discord の Webhook URL。null = 未設定または解除済み。'
  '解除を行の削除ではなく null で表すのは、他の端末に解除を伝えるため。';

-- ------------------------------------------------------------
-- Row Level Security (RLS)
-- transactions と同じく、ログインした本人の行しか読み書きできません。
-- (create policy には if not exists が無いため、
--  drop してから作り直すことで再実行に耐えるようにしています)
-- ------------------------------------------------------------
alter table public.discord_settings enable row level security;

drop policy if exists "select_own_discord_settings" on public.discord_settings;
create policy "select_own_discord_settings"
  on public.discord_settings
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert_own_discord_settings" on public.discord_settings;
create policy "insert_own_discord_settings"
  on public.discord_settings
  for insert
  with check (auth.uid() = user_id);

-- 保存も解除も upsert (insert ... on conflict do update) で行うため、
-- update 側のポリシーが無いと解除だけが静かに失敗します。
drop policy if exists "update_own_discord_settings" on public.discord_settings;
create policy "update_own_discord_settings"
  on public.discord_settings
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete_own_discord_settings" on public.discord_settings;
create policy "delete_own_discord_settings"
  on public.discord_settings
  for delete
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- anon からテーブル権限を剥がす
--
-- 彼女の共有ページは anon キーでアクセスします。RLS だけでも他人の行は
-- 読めませんが、「うっかりポリシーを1つ足すと全部見えてしまう」状態を
-- 避けるため、migration-partner-share.sql と同じ作法でテーブル権限そのものを
-- 落とします。ここを忘れると、共有ページから Webhook URL を読める余地が残ります。
-- (ログイン後のアプリは authenticated ロールで動くので影響ありません)
-- ------------------------------------------------------------
do $$
begin
  if to_regclass('public.discord_settings') is not null then
    revoke all on table public.discord_settings from anon;
  end if;
end
$$;

-- ------------------------------------------------------------
-- 確認用 (任意)
-- 下のクエリで、anon に discord_settings の権限が1つも無いことを
-- 確かめられます。0行なら正しい状態です。
--
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'discord_settings'
--      and grantee = 'anon';
-- ------------------------------------------------------------
