-- ============================================================
-- 資産・純資産の記録 (機能101) の追加マイグレーション
--
-- すでに schema.sql を実行済みのプロジェクトに、
-- assets(資産・負債の定義)と asset_balances(残高のスナップショット)を
-- 追加するためのSQLです。
-- Supabase の SQL Editor にそのまま貼り付けて Run を1回実行してください。
-- (if not exists / drop policy if exists 付きなので、
--  誤って複数回実行しても安全です)
--
-- ※ 実行しなくても記録・入力・同期はこれまでどおり動きます
--    (アプリに「資産」タブが出ないだけです)。
--
-- なぜ transactions と分けるのか
--   支出は「出来事(フロー)」、残高は「ある時点の状態(ストック)」で性質が違います。
--   同じテーブルに混ぜると月次の支出合計・レポート・彼女の預かり残高に
--   資産の数字が紛れ込んでしまうため、テーブルごと分けています。
--   こうしておけば、家計簿側の集計が資産の行を1件も見ないことが構造的に保証されます。
-- ============================================================

-- ------------------------------------------------------------
-- assets テーブル(資産・負債の定義)
-- 「何を持っているか」だけを持ち、金額は持ちません。
-- 金額は asset_balances に日付つきで積んでいきます。
-- ------------------------------------------------------------
create table if not exists public.assets (
  -- 主キー (自動生成の UUID)
  id uuid primary key default gen_random_uuid(),

  -- 行の所有者。未指定なら実行ユーザーの ID が自動で入る。
  -- ユーザー削除時は関連レコードも一緒に削除される (on delete cascade)
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- 'asset'(資産) か 'liability'(負債) か。
  -- 負債は残債を「プラスの数字」で持ち、純資産を出すときにだけ引く。
  -- こうすると入力欄で符号を意識せずに済む。
  kind text not null check (kind in ('asset', 'liability')),

  -- 種別 (bank / securities / cash / credit_card / scholarship など)。
  -- 表示上の分類でしかないので、将来増やせるよう check 制約は付けない
  category text not null default 'other',

  -- 表示名 (例: 三井住友銀行、楽天カード)
  name text not null check (char_length(name) between 1 and 40),

  -- 表示順 (小さいほど上)
  sort_order integer not null default 0,

  -- 一覧からも集計からも外した状態 (解約・完済したもの)。
  -- 行を消さずに残すのは、過去の残高の記録を失わないため
  archived boolean not null default false,

  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- asset_balances テーブル(残高のスナップショット)
-- 「いつ時点でいくらだったか」を積んでいきます。
-- 日本では家計簿アプリが銀行と自動連携するのに
-- アグリゲーター事業者との有料契約が必要なため、手入力の記録方式にしています。
-- ------------------------------------------------------------
create table if not exists public.asset_balances (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- どの資産・負債の残高か。資産を本当に削除したときは残高も一緒に消す
  asset_id uuid not null references public.assets (id) on delete cascade,

  -- 残高の基準日 (「2026-08-01 時点で 120 万円」の日付部分)
  as_of date not null,

  -- 残高。円の整数で持つ (小数を持たないので丸め誤差が出ない)。
  -- 資産の評価損やカードの払いすぎでマイナスになることがあるため、符号の制約は付けない。
  -- 桁あふれを避けるため integer ではなく bigint にしている
  -- (integer は約21億が上限で、不動産などを入れると足りなくなる)
  balance bigint not null,

  -- 同じ日に複数回更新したときに「あとから書いたほう」を選ぶために使う
  created_at timestamptz not null default now(),

  -- 同じ資産・同じ日付の残高は1件だけ。
  -- 月1回の記録を想定しているが、同じ日に何度直しても行が増えず、
  -- 最後に入れた値だけが残る (アプリ側は upsert で書き込む)
  unique (asset_id, as_of)
);

-- ------------------------------------------------------------
-- Row Level Security (RLS)
-- transactions と同じく、ログインした本人の行しか読み書きできません。
-- ------------------------------------------------------------
alter table public.assets enable row level security;

drop policy if exists "select_own_assets" on public.assets;
create policy "select_own_assets"
  on public.assets
  for select
  using (auth.uid() = user_id);

drop policy if exists "insert_own_assets" on public.assets;
create policy "insert_own_assets"
  on public.assets
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "update_own_assets" on public.assets;
create policy "update_own_assets"
  on public.assets
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete_own_assets" on public.assets;
create policy "delete_own_assets"
  on public.assets
  for delete
  using (auth.uid() = user_id);

alter table public.asset_balances enable row level security;

drop policy if exists "select_own_asset_balances" on public.asset_balances;
create policy "select_own_asset_balances"
  on public.asset_balances
  for select
  using (auth.uid() = user_id);

-- 他人の資産にぶら下げた残高を作れないよう、asset_id の持ち主も確認する
drop policy if exists "insert_own_asset_balances" on public.asset_balances;
create policy "insert_own_asset_balances"
  on public.asset_balances
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.assets a
      where a.id = asset_id and a.user_id = auth.uid()
    )
  );

drop policy if exists "update_own_asset_balances" on public.asset_balances;
create policy "update_own_asset_balances"
  on public.asset_balances
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete_own_asset_balances" on public.asset_balances;
create policy "delete_own_asset_balances"
  on public.asset_balances
  for delete
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 共有ページ(彼女に見せるリンク)からは絶対に見えないようにする。
-- migration-partner-share.sql が transactions などに対して行っているのと同じ扱い。
-- ------------------------------------------------------------
revoke all on table public.assets from anon;
revoke all on table public.asset_balances from anon;

-- ------------------------------------------------------------
-- インデックス
-- 一覧は user_id、推移の計算は (asset_id, as_of) の順で引く
-- ------------------------------------------------------------
create index if not exists idx_assets_user_id on public.assets (user_id);
create index if not exists idx_asset_balances_user_id on public.asset_balances (user_id);
create index if not exists idx_asset_balances_asset_as_of
  on public.asset_balances (asset_id, as_of);
