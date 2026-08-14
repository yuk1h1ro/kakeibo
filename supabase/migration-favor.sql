-- ============================================================
-- おごり・値引きの追加マイグレーション
--   「実際に払った額より、本来の値段が高かった」回を記録できるようにします。
--     * 誰かに **おごってもらった**(相手の名前と、いくらぶんか)
--     * 割引券・クーポン・ポイントで **安くなった / 無料になった**
--
-- Supabase の SQL Editor にそのまま貼り付けて Run を1回実行してください。
-- (add column if not exists / drop constraint if exists 付きなので、
--  誤って複数回実行しても安全です)
--
-- ※ 実行しなくても記録・入力・同期はこれまでどおり使えます。
--    アプリは起動時に favor_* 列の有無を確かめ、無ければおごり・値引きの
--    導線を出しません(静かに無効化)。
--
-- ---- 設計の要点 ----
--
--  * **amount は「実際に自分の財布から出た額」のまま**。ここは1円も変えない。
--    おごってもらった 3,200円 を amount に入れてしまうと、払っていないお金が
--    支出の合計・カテゴリ別・ペース・予算のすべてに乗ってしまう。
--    家計簿がいちばん壊れてはいけないのは「いくら使ったか」なので、
--    浮いた分は **別の列** に置き、集計にも入れない。
--
--  * では、なぜ記録するのか。**おごってもらった事実は、支出ではないが記録に値する**
--    ものだから。誰に・いつ・いくらぶん ご馳走になったのかは、月末に思い出そうとしても
--    出てこない。お返しをするにも、お礼を言うにも、まず残っていないと始まらない。
--    (割引券のほうは「いくら浮いたか」の記録。おごりのついでに同じ仕組みで持つ)
--
--  * 列を3つに分けている理由:
--      favor_amount … 浮いた額(円)。本来の値段は amount + favor_amount で出せる。
--                     「本来の値段」ではなく差額を持つのは、レシートに
--                     「割引 −500」と刷られているのがこちらの数字だから。
--      favor_kind   … 'treat'(おごり) / 'discount'(値引き)。名前の有無で
--                     見分ける案もあったが、名前を書かずにおごってもらった回が
--                     黙って「値引き」に化けてしまう。事実は事実として持つ。
--      favor_from   … おごってくれた人。おごり(treat)のときだけ入る。
--                     この列こそがこの機能の値打ちなので、メモに混ぜない
--                     (メモは検索でも通知でも別の使われ方をしていて、
--                      人の名前を安定して取り出せる場所ではない)。
--
--  * **支出(expense)の行にだけ付く**。預かり・返金・調整は残高の付け替えで、
--    そこに「おごり」は存在しない。
--
--  * 共有ページ(彼女が見る画面)には出さない。第三者にご馳走になった記録は
--    彼女の残高と何の関係もないため、RPC の変更は不要。
-- ============================================================

-- ------------------------------------------------------------
-- 1. 列を足す
-- 既定はすべて「おごりも値引きも無い」= これまでの記録と同じ意味。
-- ------------------------------------------------------------
alter table public.transactions
  add column if not exists favor_amount integer not null default 0;

comment on column public.transactions.favor_amount is
  'おごり・値引きで浮いた額(円)。0 = 無し。本来の値段は amount + favor_amount。'
  '自分の支出(amount)には含めない。';

alter table public.transactions
  add column if not exists favor_kind text;

comment on column public.transactions.favor_kind is
  '浮いた理由。treat = 誰かにおごってもらった / discount = 割引・クーポン・ポイント。'
  'null = おごりも値引きも無い(favor_amount = 0 と必ず一致する)。';

alter table public.transactions
  add column if not exists favor_from text not null default '';

comment on column public.transactions.favor_from is
  'おごってくれた人の名前。treat のときだけ入る(値引きには相手がいない)。';

-- ------------------------------------------------------------
-- 2. 3つの列が矛盾しないようにする
--
-- 画面を通さない書き込み(SQL エディタ・古い版のアプリ)でも、
-- 「額はあるのに理由が無い」「値引きなのに相手の名前がある」が残らないようにする。
--
-- null は比較の結果も null になり、CHECK は null を **通してしまう**。
-- favor_kind だけが null を取り得るので、必ず coalesce を通してから比べること。
-- ------------------------------------------------------------
alter table public.transactions
  drop constraint if exists transactions_favor_check;

alter table public.transactions
  add constraint transactions_favor_check
  check (
    favor_amount >= 0
    and coalesce(favor_kind, '') in ('', 'treat', 'discount')
    -- 額と理由は必ずセット(片方だけの行を作らせない)
    and (favor_amount > 0) = (coalesce(favor_kind, '') <> '')
    -- 相手の名前が入るのは「おごり」のときだけ
    and (favor_from = '' or coalesce(favor_kind, '') = 'treat')
    and char_length(favor_from) <= 20
    -- 預かり・返金・調整には付かない
    and (type = 'expense' or (favor_amount = 0 and favor_kind is null and favor_from = ''))
  );

-- ------------------------------------------------------------
-- 3. 支払い 0円 の支出を保存できるようにする
--
-- **この機能でいちばん大事な一行です。** 全額おごってもらった回・割引券で無料に
-- なった回は、自分が払った額が 0円 になる。これまでの check (amount > 0) は
-- そういう回を丸ごと弾いていた = 記録そのものを残せなかった。
--
-- ただし「ただの 0円」は許さない。浮いた額(favor_amount)が入っているときだけ
-- 0円 を通す。理由の無い 0円 の行は、打ち間違いと区別が付かないため。
--
-- 手動調整 (partner_adjust) が符号つきである件は migration-partner-ledger.sql
-- のままで変えていない。
--
-- この制約は migration-partner-ledger.sql も付け直している。あちらは
-- 「favor_amount 列があるかどうか」を見て同じ条件を付けるようにしてあるので、
-- **2つの SQL はどちらを先に実行しても、何度実行しても同じ結果になる**
-- (実行順で 0円 の記録が締め出されることはない)。
-- ------------------------------------------------------------
alter table public.transactions
  drop constraint if exists transactions_amount_check;

alter table public.transactions
  add constraint transactions_amount_check
  check (
    case
      when type = 'partner_adjust' then amount <> 0
      when type = 'expense' then amount > 0 or favor_amount > 0
      else amount > 0
    end
  );

-- ------------------------------------------------------------
-- 4. 「誰にご馳走になったか」で引くための索引
-- 人ごとの集計(何回・いくら・最後はいつ)はアプリ側の純粋関数が
-- 手元の記録から出すので必須ではないが、記録が増えたときのために張っておく。
-- 値引きの行(favor_from = '')は入れない。
-- ------------------------------------------------------------
create index if not exists idx_transactions_favor_from
  on public.transactions (favor_from)
  where favor_from <> '';
