-- ============================================================
-- 預かり金まわりの追加マイグレーション
--   機能012 預かり金の「返金」「手動調整」
--   機能011 残高マイナス(= 彼女への貸し)の扱い
--   機能018 1件を複数人で分けて立替(彼女が払った回)
--
-- Supabase の SQL Editor にそのまま貼り付けて Run を1回実行してください。
-- (drop constraint if exists / add column if not exists / create or replace 付きなので、
--  誤って複数回実行しても安全です)
--
-- ※ 実行しなくても記録・入力・同期はこれまでどおり使えます。
--    アプリは起動時に partner_paid 列の有無を確かめ、無ければ
--    「返金・調整」「支払った人」の導線を出しません(静かに無効化)。
--
-- ---- 設計の要点 ----
--  * 残高 = Σ(1件ごとの影響額) は変えない。影響額の定義だけを広げる:
--      預かり(partner_deposit)   … +amount
--      返金(partner_refund)      … −amount   ← 追加
--      調整(partner_adjust)      … +amount(符号つき) ← 追加
--      支出(expense)             … partner_paid − partner_amount
--    既存の行は partner_paid が 0 なので、従来どおり「−彼女の負担分」のまま。
--    **過去の残高は1円も動きません。**
--  * 「現金で受け取った」には型を作っていません。残高への効果も意味も
--    既存の partner_deposit と同じ(彼女→私にお金が動いた)ためです。
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
