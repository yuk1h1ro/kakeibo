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

  -- お店 (店名。任意。既定は空文字。支出でのみ使用)
  store text not null default '',

  -- 支出のうち彼女の負担分 (円)。彼女の預かり残高から差し引かれる。
  -- 0 以上かつ支払い総額 (amount) 以下であること。
  partner_amount integer not null default 0
    check (partner_amount >= 0 and partner_amount <= amount),

  -- 記録の出どころ。'recurring' なら繰り返し入力が自動生成した行。
  -- 手入力の行は空文字のまま (アプリは手入力時にこの列を送らない)
  source text not null default '',

  -- 気分スタンプ (満足 / 普通 / 後悔)。任意なので null = 未設定。
  -- 入力時に押すスタンプも、あとからまとめて仕分ける画面も、この1列だけを使う
  satisfaction text
    check (satisfaction is null or satisfaction in ('good', 'neutral', 'regret')),

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
drop policy if exists "select_own_transactions" on public.transactions;
create policy "select_own_transactions"
  on public.transactions
  for select
  using (auth.uid() = user_id);

-- 自分の user_id の行だけ追加 (INSERT) できる
drop policy if exists "insert_own_transactions" on public.transactions;
create policy "insert_own_transactions"
  on public.transactions
  for insert
  with check (auth.uid() = user_id);

-- 自分の行だけ更新 (UPDATE) できる。
-- with check により、更新後も自分の行であることを保証 (user_id の付け替え防止)
drop policy if exists "update_own_transactions" on public.transactions;
create policy "update_own_transactions"
  on public.transactions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 自分の行だけ削除 (DELETE) できる
drop policy if exists "delete_own_transactions" on public.transactions;
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

-- Row Level Security (transactions と同じく本人の行のみ読み書き可)
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

-- ユーザーごとの取得を高速化
create index if not exists idx_categories_user_id on public.categories (user_id);

-- ------------------------------------------------------------
-- store_categories テーブル
-- 「この店ではこのカテゴリ」を1店1行で覚えます (店名からのカテゴリ自動選択)。
-- 支出を保存するたびに上書きされるので、履歴は持ちません。
-- ------------------------------------------------------------
create table if not exists public.store_categories (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者。未指定なら実行ユーザーの ID が自動で入る。
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

-- Row Level Security (transactions と同じく本人の行のみ読み書き可)
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

-- ------------------------------------------------------------
-- recurring_rules テーブル
-- 家賃・サブスクなどを「毎月N日」「毎週X曜」「毎年M月N日」で登録します。
-- サーバー側の cron は使わず、アプリを開いたときに未生成分をまとめて作ります。
-- ------------------------------------------------------------
create table if not exists public.recurring_rules (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者。未指定なら実行ユーザーの ID が自動で入る。
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

-- Row Level Security (transactions と同じく本人の行のみ読み書き可)
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

-- ------------------------------------------------------------
-- transaction_templates テーブル
-- よく使う入力 (店・カテゴリ・金額・彼女の負担分) を保存し、
-- 入力タブから1タップで呼び出すためのものです。
-- ------------------------------------------------------------
create table if not exists public.transaction_templates (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者。未指定なら実行ユーザーの ID が自動で入る。
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

-- Row Level Security (transactions と同じく本人の行のみ読み書き可)
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

-- ============================================================
-- 彼女向けの共有機能
--   閲覧専用の共有リンク / 明細へのコメント / 月末サマリーの送信記録
--
-- 設計の要点(ここが安全性の肝):
--   * 彼女はアカウントを持たないので、共有ページは anon キーでアクセスする。
--   * しかし anon には transactions を1行も読ませない。
--     - RLS(本人の行のみ)に加えて、テーブル権限そのものを anon から revoke する。
--     - 彼女に見せる行は security definer 関数(RPC)が組み立てて返す。
--   * したがって「トークンを知らないと何も読めない」「トークンを知っていても
--     彼女に関係する行しか返ってこない」の2段構えになる。
--
-- 既存プロジェクトへの追加は supabase/migration-partner-share.sql を実行する。
-- 内容は同じもので、どちらも複数回実行して安全。
-- ============================================================

create extension if not exists pgcrypto;


-- security definer にしているのは、pgcrypto がどのスキーマに入っていても
-- 確実に呼べるようにするため(乱数を返すだけなので情報は漏れない)。
create or replace function public.partner_share_new_token()
returns text
language sql
volatile
security definer
set search_path = public, extensions, pg_temp
as $$
  select encode(gen_random_bytes(24), 'hex')
$$;

-- ------------------------------------------------------------
-- 1. partner_share_links テーブル
-- 彼女に渡す閲覧専用リンク。1人で複数発行できます(再発行しても古い方を
-- 明示的に無効化するまでは生きるので、UI 側は再発行時に必ず revoke します)。
-- ------------------------------------------------------------
create table if not exists public.partner_share_links (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者。未指定なら実行ユーザーの ID が自動で入る。
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- URL に載せる秘密の文字列。これを知っている人だけがページを見られる。
  -- 32文字未満は関数側で門前払いするので、既定の48文字から短くしないこと。
  token text not null unique default public.partner_share_new_token(),

  -- 有効期限。null なら無期限。過ぎたリンクは閲覧も書き込みもできなくなる。
  expires_at timestamptz,

  -- 無効化した日時。null 以外なら即座に閲覧も書き込みもできなくなる。
  revoked_at timestamptz,

  -- 最後に見られた日時(利用者の画面に「最後に見た日」を出すため)
  last_viewed_at timestamptz,

  -- レコード作成日時
  created_at timestamptz not null default now()
);

alter table public.partner_share_links enable row level security;

-- 本人(ログインした利用者)だけが自分のリンクを読み書きできる。
-- anon 向けのポリシーは1つも作らない = トークンの直接照会は不可能。
drop policy if exists "select_own_partner_share_links" on public.partner_share_links;
create policy "select_own_partner_share_links"
  on public.partner_share_links
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert_own_partner_share_links" on public.partner_share_links;
create policy "insert_own_partner_share_links"
  on public.partner_share_links
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "update_own_partner_share_links" on public.partner_share_links;
create policy "update_own_partner_share_links"
  on public.partner_share_links
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete_own_partner_share_links" on public.partner_share_links;
create policy "delete_own_partner_share_links"
  on public.partner_share_links
  for delete
  using (auth.uid() = user_id);

create index if not exists idx_partner_share_links_user_id
  on public.partner_share_links (user_id);

-- ------------------------------------------------------------
-- 2. partner_share_comments テーブル
-- 明細1件ごとのコメント。利用者(owner)はアプリから、彼女(partner)は
-- 共有ページから書きます。彼女の書き込みは必ず RPC 経由なので、
-- このテーブルへの anon の直接 INSERT 権限は与えません。
-- ------------------------------------------------------------
create table if not exists public.partner_share_comments (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- データの持ち主(= 利用者)。彼女の書き込みでは RPC がリンクの持ち主を入れる。
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- コメント先の明細のID。
  --
  -- **わざと外部キーを張っていません。** 以前は on delete cascade 付きの
  -- 外部キーだったため、削除の取り消し (機能159) で同じIDの行を入れ直しても、
  -- delete がサーバーに届いた時点でコメントが物理削除されており、戻りませんでした。
  -- 明細が消えている間はコメントが見えなくなるだけ(下の関数が
  -- transactions と join しているので、見えない明細のコメントは返らない)で、
  -- 行そのものは残ります。行を戻せばコメントも一緒に戻ります。
  transaction_id uuid not null,

  -- 書いた人。'owner' = 利用者(アプリから) / 'partner' = 彼女(共有ページから)
  author text not null check (author in ('owner', 'partner')),

  -- 本文。荒らし対策その1: 1件あたりの長さをデータベース側で縛る。
  body text not null check (char_length(body) between 1 and 300),

  -- どの共有リンクから書かれたか(彼女の投稿のみ)。連投制限の集計に使う。
  -- リンクを削除してもコメントは残す (on delete set null)
  link_id uuid references public.partner_share_links (id) on delete set null,

  -- 利用者が読んだか。彼女の投稿は false で入り、アプリで開くと true になる。
  read_by_owner boolean not null default false,

  -- レコード作成日時(スレッドの並び順と連投制限の判定に使う)
  created_at timestamptz not null default now()
);

alter table public.partner_share_comments enable row level security;

-- 本人だけが読み書きできる。彼女(anon)向けのポリシーは作らない。
drop policy if exists "select_own_partner_share_comments" on public.partner_share_comments;
create policy "select_own_partner_share_comments"
  on public.partner_share_comments
  for select
  using (auth.uid() = user_id);

-- コメント先の明細も、必ず自分のものであることを確かめる。
-- ここを user_id だけで通していたころは、**他人の明細のIDを指したコメント**を
-- 自分の行として作れた(共有ページ側の RPC は明細の持ち主を見ているのに、
-- アプリ側の直接 INSERT だけが素通りしていた = 非対称)。
-- 明細への外部キーは意図的に張っていない(削除の取り消しでコメントを戻すため)ので、
-- 持ち主の確認はこのポリシーでしか行えない。
-- なお、これは **書き込む瞬間**の確認で、あとから明細が消えてもコメントは残る
-- (orphan を許す設計はそのまま。asset_balances の INSERT と同じ形)。
drop policy if exists "insert_own_partner_share_comments" on public.partner_share_comments;
create policy "insert_own_partner_share_comments"
  on public.partner_share_comments
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.transactions t
      where t.id = transaction_id and t.user_id = auth.uid()
    )
  );

drop policy if exists "update_own_partner_share_comments" on public.partner_share_comments;
create policy "update_own_partner_share_comments"
  on public.partner_share_comments
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete_own_partner_share_comments" on public.partner_share_comments;
create policy "delete_own_partner_share_comments"
  on public.partner_share_comments
  for delete
  using (auth.uid() = user_id);

-- すでにこのテーブルを作ってある環境から、明細への外部キー(on delete cascade)を外す。
-- 制約を落とすだけなので、**いま入っているコメントは1件も消えません**。
-- 名前を決め打ちにしないのは、作られた時期によって制約名が違い得るため。
do $$
declare
  c record;
begin
  if to_regclass('public.partner_share_comments') is null then
    return;
  end if;
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'partner_share_comments'
       and con.contype = 'f'
       and con.confrelid = to_regclass('public.transactions')
  loop
    execute format(
      'alter table public.partner_share_comments drop constraint %I', c.conname
    );
  end loop;
end
$$;

create index if not exists idx_partner_share_comments_user_id
  on public.partner_share_comments (user_id);
create index if not exists idx_partner_share_comments_transaction_id
  on public.partner_share_comments (transaction_id);
-- 連投制限は「このリンクから直近1分/1日に何件書かれたか」を数えるので、
-- link_id + created_at の複合インデックスを用意しておく
create index if not exists idx_partner_share_comments_link_created
  on public.partner_share_comments (link_id, created_at desc);

-- ------------------------------------------------------------
-- 3. partner_summary_sends テーブル (機能016)
-- 「この月のサマリーはもう Discord に送った」という印。
-- (user_id, month) の一意制約が二重送信を防ぐ唯一の砦なので外さないこと。
-- 複数端末が同時にアプリを開いても、INSERT に成功した1台だけが送ります。
-- ------------------------------------------------------------
create table if not exists public.partner_summary_sends (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- 送信済みの月 ('YYYY-MM')
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),

  -- 送信した日時
  sent_at timestamptz not null default now(),

  -- 同じ月を二度送らないための一意制約(重複防止の要)
  unique (user_id, month)
);

alter table public.partner_summary_sends enable row level security;

drop policy if exists "select_own_partner_summary_sends" on public.partner_summary_sends;
create policy "select_own_partner_summary_sends"
  on public.partner_summary_sends
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert_own_partner_summary_sends" on public.partner_summary_sends;
create policy "insert_own_partner_summary_sends"
  on public.partner_summary_sends
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "delete_own_partner_summary_sends" on public.partner_summary_sends;
create policy "delete_own_partner_summary_sends"
  on public.partner_summary_sends
  for delete
  using (auth.uid() = user_id);

create index if not exists idx_partner_summary_sends_user_id
  on public.partner_summary_sends (user_id);

-- ------------------------------------------------------------
-- 4. anon からテーブル権限を剥がす
--
-- RLS だけでも anon は他人の行を読めませんが、「うっかりポリシーを1つ足すと
-- 全部見えてしまう」状態を避けるため、テーブル権限そのものを落とします。
-- 彼女がアクセスするのは下の security definer 関数だけです。
-- (ログイン後のアプリは authenticated ロールで動くので影響ありません)
-- ------------------------------------------------------------
-- 存在しないテーブルを revoke するとスクリプト全体が止まってしまうので、
-- 実在するものだけを対象にする(古いスキーマのままの環境でも最後まで通す)
do $$
declare
  t text;
begin
  foreach t in array array[
    'transactions',
    'categories',
    'store_categories',
    'recurring_rules',
    'transaction_templates',
    'partner_share_links',
    'partner_share_comments',
    'partner_summary_sends',
    -- Webhook URL の同期先 (このファイル末尾の節)。ここではまだ作られて
    -- いないので初回は素通りするが、末尾の節が自前で revoke している
    'discord_settings'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on table public.%I from anon', t);
    end if;
  end loop;
end
$$;

-- ------------------------------------------------------------
-- 5. partner_share_view(token) — 共有ページが読むもの
--
-- security definer なので RLS を越えて transactions を読めますが、
-- **返すのは彼女に関係する行だけ**です:
--   - 預かり金の残高
--   - 預かった履歴 (type = 'partner_deposit')
--   - 彼女の負担分がある支出だけ (partner_amount > 0)。しかも返す金額は
--     partner_amount のみで、支払い総額 (amount) は絶対に返しません。
--   - 利用者個人の支出 (partner_amount = 0) は1行も返しません。
--
-- トークンが無い・無効化済み・期限切れのときは、区別せず {"ok": false} を返します
-- (存在の有無を漏らさないため)。
-- ------------------------------------------------------------
create or replace function public.partner_share_view(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.partner_share_links;
  v_balance integer;
  v_deposits jsonb;
  v_charges jsonb;
  v_comments jsonb;
begin
  -- 明らかに形式が違うトークンは総当たりの的にしかならないので即座に断る
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 128 then
    return jsonb_build_object('ok', false);
  end if;

  select * into v_link
    from public.partner_share_links
   where token = p_token
     and revoked_at is null
     and (expires_at is null or expires_at > now())
   limit 1;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  -- 「最後に見られた日」を利用者の画面に出すために更新する
  update public.partner_share_links set last_viewed_at = now() where id = v_link.id;

  -- 残高 = 預かった額の合計 − 彼女の負担分の合計
  select coalesce(sum(case when t.type = 'partner_deposit' then t.amount else -t.partner_amount end), 0)
    into v_balance
    from public.transactions t
   where t.user_id = v_link.user_id;

  -- 預かった履歴
  select coalesce(
           jsonb_agg(
             jsonb_build_object('id', t.id, 'date', t.date, 'amount', t.amount)
             order by t.date desc, t.created_at desc
           ),
           '[]'::jsonb
         )
    into v_deposits
    from public.transactions t
   where t.user_id = v_link.user_id
     and t.type = 'partner_deposit';

  -- 彼女の負担分がある支出だけ。amount(支払い総額)は含めない。
  -- カテゴリ名は彼女の端末では解決できないので、ここで表示名まで解決して返す。
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', t.id,
               'date', t.date,
               'store', t.store,
               'amount', t.partner_amount,
               'category', t.category,
               'category_label', c.label
             )
             order by t.date desc, t.created_at desc
           ),
           '[]'::jsonb
         )
    into v_charges
    from public.transactions t
    left join public.categories c
      on c.user_id = t.user_id and c.cat_key = t.category
   where t.user_id = v_link.user_id
     and t.type = 'expense'
     and t.partner_amount > 0;

  -- 上で返した明細に紐づくコメントだけを返す
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', cm.id,
               'transaction_id', cm.transaction_id,
               'author', cm.author,
               'body', cm.body,
               'created_at', cm.created_at
             )
             order by cm.created_at asc
           ),
           '[]'::jsonb
         )
    into v_comments
    from public.partner_share_comments cm
    join public.transactions t on t.id = cm.transaction_id
   where cm.user_id = v_link.user_id
     and t.user_id = v_link.user_id
     and (t.type = 'partner_deposit' or (t.type = 'expense' and t.partner_amount > 0));

  return jsonb_build_object(
    'ok', true,
    'balance', v_balance,
    'deposits', v_deposits,
    'charges', v_charges,
    'comments', v_comments,
    'expires_at', v_link.expires_at,
    'max_comment_length', 300
  );
end;
$$;

-- ------------------------------------------------------------
-- 6. partner_share_add_comment(token, transaction_id, body) — 彼女の書き込み
--
-- 荒らし・事故への対策(すべてサーバー側で効きます):
--   a. リンクが無効化・期限切れなら書けない(閲覧と同じ判定を通す)
--   b. 本文は前後の空白を落としたうえで 1〜300文字。超過は保存しない
--   c. 直近1分間に3件まで、直近24時間に50件まで(リンク単位)
--   d. コメントを付けられるのは「彼女に見えている明細」だけ。
--      他人の明細IDを当てても書けないし、存在の有無も返さない
-- ------------------------------------------------------------
create or replace function public.partner_share_add_comment(
  p_token text,
  p_transaction_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.partner_share_links;
  v_body text;
  v_recent integer;
  v_daily integer;
  v_visible boolean;
  v_id uuid;
  v_created timestamptz;
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 128 then
    return jsonb_build_object('ok', false, 'reason', 'link');
  end if;

  select * into v_link
    from public.partner_share_links
   where token = p_token
     and revoked_at is null
     and (expires_at is null or expires_at > now())
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'link');
  end if;

  -- 本文の正規化と長さ制限
  v_body := btrim(coalesce(p_body, ''));
  if char_length(v_body) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  if char_length(v_body) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'length');
  end if;

  -- 連投制限 (リンク単位)。サーバー時刻で判定するので端末の時計はいじれない
  select count(*) into v_recent
    from public.partner_share_comments
   where link_id = v_link.id
     and created_at > now() - interval '1 minute';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;

  select count(*) into v_daily
    from public.partner_share_comments
   where link_id = v_link.id
     and created_at > now() - interval '1 day';
  if v_daily >= 50 then
    return jsonb_build_object('ok', false, 'reason', 'rate_day');
  end if;

  -- 彼女に見えている明細か(見えない明細には書けない)
  select true into v_visible
    from public.transactions t
   where t.id = p_transaction_id
     and t.user_id = v_link.user_id
     and (t.type = 'partner_deposit' or (t.type = 'expense' and t.partner_amount > 0))
   limit 1;

  if v_visible is not true then
    -- 明細が無いのか見えないだけなのかは区別せずに断る
    return jsonb_build_object('ok', false, 'reason', 'link');
  end if;

  insert into public.partner_share_comments
    (user_id, transaction_id, author, body, link_id, read_by_owner)
  values
    (v_link.user_id, p_transaction_id, 'partner', v_body, v_link.id, false)
  returning id, created_at into v_id, v_created;

  return jsonb_build_object(
    'ok', true,
    'comment', jsonb_build_object(
      'id', v_id,
      'transaction_id', p_transaction_id,
      'author', 'partner',
      'body', v_body,
      'created_at', v_created
    )
  );
end;
$$;

-- ------------------------------------------------------------
-- 7. 関数の実行権限
-- 既定では public(= 全ロール)に execute が付くので、いったん剥がしてから
-- 必要なロールにだけ与えます。
-- ------------------------------------------------------------
revoke all on function public.partner_share_new_token() from public;
grant execute on function public.partner_share_new_token() to authenticated;

revoke all on function public.partner_share_view(text) from public;
grant execute on function public.partner_share_view(text) to anon, authenticated;

revoke all on function public.partner_share_add_comment(text, uuid, text) from public;
grant execute on function public.partner_share_add_comment(text, uuid, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 8. 確認用 (任意)
-- 下のクエリを実行して、anon に transactions の権限が1つも無いことを
-- 確かめられます。0行なら正しい状態です。
--
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'transactions'
--      and grantee = 'anon';
-- ------------------------------------------------------------

-- ============================================================
-- 預かり金の返金・手動調整・立替者 (機能012 / 011 / 018)
--
-- 既存プロジェクトへの追加は supabase/migration-partner-ledger.sql を実行する。
-- 内容は同じもので、どちらも複数回実行して安全。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 種別に「返金」「調整」を足す (機能012)
-- 元の check は列定義に直接書かれているため、Postgres が自動で付けた
-- 名前 (transactions_type_check) で置き換えます。
-- ------------------------------------------------------------
alter table public.transactions
  drop constraint if exists transactions_type_check;

alter table public.transactions
  add constraint transactions_type_check
  check (type in ('expense', 'partner_deposit', 'partner_refund', 'partner_adjust'));

-- ------------------------------------------------------------
-- 2. 金額の制約をゆるめる
-- 手動調整だけは「ズレを直す」ものなので符号つき(マイナスもあり得る)。
-- ただし 0 は残高が動かない = 履歴に残す意味が無いので禁止したままにします。
-- 支出・預かり・返金は従来どおり正の整数のみ。
-- ------------------------------------------------------------
alter table public.transactions
  drop constraint if exists transactions_amount_check;

alter table public.transactions
  add constraint transactions_amount_check
  check (case when type = 'partner_adjust' then amount <> 0 else amount > 0 end);

-- ------------------------------------------------------------
-- 3. 彼女の負担分の制約を「支出のときだけ」に限る
-- partner_adjust の amount がマイナスになり得るため、
-- 「partner_amount <= amount」を全種別に課したままだと調整行が入りません。
-- (支出以外の行では partner_amount は常に 0 です)
-- ------------------------------------------------------------
-- 上の transactions テーブル定義の partner_amount の check は amount という
-- 別の列を参照するため、PostgreSQL がテーブル制約に格上げして
-- transactions_check という名前を付ける。ここで落としておかないと
-- 古い「partner_amount <= amount」が生き残り、amount がマイナスの
-- 調整行が必ず 23514 で弾かれる。
alter table public.transactions
  drop constraint if exists transactions_check;

alter table public.transactions
  drop constraint if exists transactions_partner_amount_check;

alter table public.transactions
  add constraint transactions_partner_amount_check
  check (partner_amount >= 0 and (type <> 'expense' or partner_amount <= amount));

-- ------------------------------------------------------------
-- 4. 「彼女が実際に払った額」の列 (機能018)
-- 既定 0 = 自分が全額払った(これまでの前提)。既存行の意味は変わりません。
-- ------------------------------------------------------------
alter table public.transactions
  add column if not exists partner_paid integer not null default 0;

comment on column public.transactions.partner_paid is
  '支払い総額のうち彼女が実際に払った額(円)。0 = 自分が全額払った。'
  '残高への影響は partner_paid − partner_amount。';

alter table public.transactions
  drop constraint if exists transactions_partner_paid_check;

alter table public.transactions
  add constraint transactions_partner_paid_check
  check (partner_paid >= 0 and (type <> 'expense' or partner_paid <= amount));

-- ------------------------------------------------------------
-- 5. 共有ページ(彼女が見る画面)の更新
--
-- 守るもの(migration-partner-share.sql から変えていない前提):
--   * anon には transactions の権限を1つも与えない。彼女が読めるのは
--     この security definer 関数の戻り値だけ。
--   * 利用者個人の支出は1件も返さない。返すのは「彼女に関係する行」だけ。
--   * 支払い総額(amount)は返さない。返すのは彼女の負担額と、
--     彼女自身が払った額(= 彼女がすでに知っている額)だけ。
--
-- 変えたところ:
--   a. 残高の式に返金・調整・彼女が払った額を入れた(アプリ側と同じ式)
--   b. 返金・調整を settlements として返す(残高が動いた理由を隠さない)
--      ※ deposits はそのまま「預かり」だけ。古い画面でも壊れないように、
--        既存のキーの意味は一切変えていません。
--   c. 彼女が払った回(partner_paid > 0)も charges に含める。
--      彼女が負担 0 でも「彼女が払った」行は彼女に関係する行なので見せる。
-- ------------------------------------------------------------
create or replace function public.partner_share_view(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.partner_share_links;
  v_balance integer;
  v_deposits jsonb;
  v_settlements jsonb;
  v_charges jsonb;
  v_comments jsonb;
begin
  -- 明らかに形式が違うトークンは総当たりの的にしかならないので即座に断る
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 128 then
    return jsonb_build_object('ok', false);
  end if;

  select * into v_link
    from public.partner_share_links
   where token = p_token
     and revoked_at is null
     and (expires_at is null or expires_at > now())
   limit 1;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  update public.partner_share_links set last_viewed_at = now() where id = v_link.id;

  -- 残高 = Σ(1件ごとの影響額)。アプリ側 (partnerBalance.ts) と同じ式にすること
  select coalesce(sum(
           case t.type
             when 'partner_deposit' then t.amount
             when 'partner_refund'  then -t.amount
             when 'partner_adjust'  then t.amount
             else coalesce(t.partner_paid, 0) - t.partner_amount
           end
         ), 0)
    into v_balance
    from public.transactions t
   where t.user_id = v_link.user_id;

  -- 預かった履歴(従来どおり)
  select coalesce(
           jsonb_agg(
             jsonb_build_object('id', t.id, 'date', t.date, 'amount', t.amount)
             order by t.date desc, t.created_at desc
           ),
           '[]'::jsonb
         )
    into v_deposits
    from public.transactions t
   where t.user_id = v_link.user_id
     and t.type = 'partner_deposit';

  -- 返金・調整 (機能012)。amount は残高への影響額(符号つき)で返す
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', t.id,
               'date', t.date,
               'kind', t.type,
               'amount', case when t.type = 'partner_refund' then -t.amount else t.amount end,
               'memo', t.memo
             )
             order by t.date desc, t.created_at desc
           ),
           '[]'::jsonb
         )
    into v_settlements
    from public.transactions t
   where t.user_id = v_link.user_id
     and t.type in ('partner_refund', 'partner_adjust');

  -- 彼女に関係する支出。支払い総額 (amount) は含めない。
  -- paid = 彼女自身が払った額 (機能018)
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', t.id,
               'date', t.date,
               'store', t.store,
               'amount', t.partner_amount,
               'paid', coalesce(t.partner_paid, 0),
               'category', t.category,
               'category_label', c.label
             )
             order by t.date desc, t.created_at desc
           ),
           '[]'::jsonb
         )
    into v_charges
    from public.transactions t
    left join public.categories c
      on c.user_id = t.user_id and c.cat_key = t.category
   where t.user_id = v_link.user_id
     and t.type = 'expense'
     and (t.partner_amount > 0 or coalesce(t.partner_paid, 0) > 0);

  -- 上で返した明細に紐づくコメントだけを返す
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', cm.id,
               'transaction_id', cm.transaction_id,
               'author', cm.author,
               'body', cm.body,
               'created_at', cm.created_at
             )
             order by cm.created_at asc
           ),
           '[]'::jsonb
         )
    into v_comments
    from public.partner_share_comments cm
    join public.transactions t on t.id = cm.transaction_id
   where cm.user_id = v_link.user_id
     and t.user_id = v_link.user_id
     and (
       t.type in ('partner_deposit', 'partner_refund', 'partner_adjust')
       or (t.type = 'expense' and (t.partner_amount > 0 or coalesce(t.partner_paid, 0) > 0))
     );

  return jsonb_build_object(
    'ok', true,
    'balance', v_balance,
    'deposits', v_deposits,
    'settlements', v_settlements,
    'charges', v_charges,
    'comments', v_comments,
    'expires_at', v_link.expires_at,
    'max_comment_length', 300
  );
end;
$$;

-- ------------------------------------------------------------
-- 6. コメントを書ける明細の範囲も、上の「見える範囲」に合わせる
-- (見えない明細には書けない、という約束を崩さないため)
-- 制限(長さ・連投)は元のまま変えていません。
-- ------------------------------------------------------------
create or replace function public.partner_share_add_comment(
  p_token text,
  p_transaction_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_link public.partner_share_links;
  v_body text;
  v_recent integer;
  v_daily integer;
  v_visible boolean;
  v_id uuid;
  v_created timestamptz;
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 128 then
    return jsonb_build_object('ok', false, 'reason', 'link');
  end if;

  select * into v_link
    from public.partner_share_links
   where token = p_token
     and revoked_at is null
     and (expires_at is null or expires_at > now())
   limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'link');
  end if;

  v_body := btrim(coalesce(p_body, ''));
  if char_length(v_body) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  if char_length(v_body) > 300 then
    return jsonb_build_object('ok', false, 'reason', 'length');
  end if;

  select count(*) into v_recent
    from public.partner_share_comments
   where link_id = v_link.id
     and created_at > now() - interval '1 minute';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;

  select count(*) into v_daily
    from public.partner_share_comments
   where link_id = v_link.id
     and created_at > now() - interval '1 day';
  if v_daily >= 50 then
    return jsonb_build_object('ok', false, 'reason', 'rate_day');
  end if;

  select true into v_visible
    from public.transactions t
   where t.id = p_transaction_id
     and t.user_id = v_link.user_id
     and (
       t.type in ('partner_deposit', 'partner_refund', 'partner_adjust')
       or (t.type = 'expense' and (t.partner_amount > 0 or coalesce(t.partner_paid, 0) > 0))
     )
   limit 1;

  if v_visible is not true then
    return jsonb_build_object('ok', false, 'reason', 'link');
  end if;

  insert into public.partner_share_comments
    (user_id, transaction_id, author, body, link_id, read_by_owner)
  values
    (v_link.user_id, p_transaction_id, 'partner', v_body, v_link.id, false)
  returning id, created_at into v_id, v_created;

  return jsonb_build_object(
    'ok', true,
    'comment', jsonb_build_object(
      'id', v_id,
      'transaction_id', p_transaction_id,
      'author', 'partner',
      'body', v_body,
      'created_at', v_created
    )
  );
end;
$$;

-- ------------------------------------------------------------
-- 7. 関数の実行権限(create or replace で消えることがあるので付け直す)
-- ------------------------------------------------------------
revoke all on function public.partner_share_view(text) from public;
grant execute on function public.partner_share_view(text) to anon, authenticated;

revoke all on function public.partner_share_add_comment(text, uuid, text) from public;
grant execute on function public.partner_share_add_comment(text, uuid, text) to anon, authenticated;

-- 念のため: anon にテーブル権限が戻っていないことを確かめる(0行なら正しい)
--   select grantee, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and table_name = 'transactions'
--      and grantee = 'anon';

-- ============================================================
-- タグと分割 (機能088 / 096)
--
-- 既存プロジェクトへの追加は supabase/migration-tags-splits.sql を実行する。
-- 内容は同じもので、どちらも複数回実行して安全。
-- ============================================================

-- ------------------------------------------------------------
-- 1. タグ (機能088)
-- 既定は空配列。既存行の意味は変わりません。
-- ------------------------------------------------------------
alter table public.transactions
  add column if not exists tags text[] not null default '{}';

comment on column public.transactions.tags is
  'カテゴリと直交するタグ(「旅行2026」「デート」など)。1件に複数。'
  'アプリ側で1件5個・1個20文字までに正規化してから保存します。';

-- 1件あたりの個数と1つあたりの長さは DB 側でも縛っておく
-- (画面を通さない書き込みでも一覧が壊れないように)
alter table public.transactions
  drop constraint if exists transactions_tags_check;

-- PostgreSQL は CHECK 制約の中に副問い合わせを書けないため、
-- 要素ごとの長さの判定を immutable な関数に閉じ込めて呼ぶ
create or replace function public.kakeibo_tags_ok(t text[])
returns boolean
language sql
immutable
as $fn$
  select coalesce(array_length(t, 1), 0) <= 5
     and coalesce(
           (select bool_and(char_length(u.v) between 1 and 20)
              from unnest(coalesce(t, '{}'::text[])) as u(v)),
           true)
$fn$;

alter table public.transactions
  add constraint transactions_tags_check
  check (public.kakeibo_tags_ok(tags));

-- タグでの絞り込みは配列の包含で引くので GIN を張る
create index if not exists idx_transactions_tags
  on public.transactions using gin (tags);

-- ------------------------------------------------------------
-- 2. 分割の束ねID (機能096)
-- null = 分割していない普通の1件。
-- 同じ会計から分けた行には同じ UUID が入ります。
-- ------------------------------------------------------------
alter table public.transactions
  add column if not exists split_group uuid;

comment on column public.transactions.split_group is
  '1件の会計を複数カテゴリに分けたときの束ねID。null = 分割なし。'
  '金額・カテゴリ・彼女の負担分は分けた行がそれぞれ持ちます。';

create index if not exists idx_transactions_split_group
  on public.transactions (split_group)
  where split_group is not null;

-- ============================================================
-- Discord の Webhook URL を端末間で同期する
--
-- 既存プロジェクトへの追加は supabase/migration-discord-webhook.sql を実行する。
-- 内容は同じもので、どちらも複数回実行して安全。
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
-- むしろ端末を失くしたときは、ログアウトの後始末で端末側だけを消せます。
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

-- Row Level Security (transactions と同じく本人の行のみ読み書き可)
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

-- anon からテーブル権限を剥がす(上の共有機能の節と同じ理由)。
-- ここを忘れると、共有ページから Webhook URL を読める余地が残ります。
do $$
begin
  if to_regclass('public.discord_settings') is not null then
    revoke all on table public.discord_settings from anon;
  end if;
end
$$;
