-- ============================================================
-- タグと分割の追加マイグレーション
--   機能088 タグ / ラベル(1件に複数)
--   機能096 1件を複数カテゴリに分割
--
-- Supabase の SQL Editor にそのまま貼り付けて Run を1回実行してください。
-- (add column if not exists 付きなので、誤って複数回実行しても安全です)
--
-- ※ 実行しなくても記録・入力・同期はこれまでどおり使えます。
--    アプリは起動時に tags / split_group 列の有無を確かめ、無ければ
--    タグと分割の導線を出しません(静かに無効化)。
--
-- ---- 設計の要点 ----
--  * タグは専用の列(text[])にしている。メモの中の #ハッシュタグから拾う案も
--    あったが、(1) メモは共有ページに出さない項目なのでタグと衝突する、
--    (2) メモを書き直しただけでタグが消える、(3) 候補の提示が不確実、
--    という3点で分類軸としては弱いため。
--  * 分割は「1行に内訳をJSONで持つ」のではなく、**カテゴリごとに独立した行**を
--    作り、split_group で束ねるだけにしている。こうするとレポートの集計も
--    預かり残高も既存の式(1行 = 1カテゴリ、彼女の負担分は行ごと)のままで正しい。
--    彼女の負担分を分割した各行がそれぞれ持つのはこのためで、
--    全体に1つだけ持たせると按分の丸めで残高がずれる。
--  * この2つの列は共有ページ(彼女が見る画面)には出さない。
--    タグは自分用の整理軸であり、分割は「1件が複数行になっただけ」で、
--    彼女に見せる金額(負担分)は行ごとに正しく出るため、RPC の変更は不要。
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

alter table public.transactions
  add constraint transactions_tags_check
  check (
    array_length(tags, 1) is null
    or (
      array_length(tags, 1) <= 5
      and not exists (
        select 1 from unnest(tags) as t(v)
         where char_length(v) = 0 or char_length(v) > 20
      )
    )
  );

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
