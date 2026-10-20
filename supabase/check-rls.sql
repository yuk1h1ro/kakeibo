-- ============================================================
-- 他人のデータが読めない・書けないことを確かめる (RLS の点検)
--
-- 使い方: Supabase の SQL Editor にこのファイルを**全部**貼って Run。
--         最後に結果の表が出ます。「NG」が1行も無ければ合格です。
--         何度実行してもかまいません。
--
-- データは1件も変えません。
--   書き込みを試す部分は、成功しても失敗してもその場で取り消します
--   (例外を投げて巻き戻す)。共有リンクの「最後に見た日」も更新されません。
--
-- 確かめること:
--   1. 設定 … public のすべてのテーブルで RLS が有効か。
--              ポリシーがすべて「本人(auth.uid())の行だけ」になっているか
--   2. 他人 … 存在しないユーザー ID でログインした扱いにして、
--              あなたの行が1件でも見えるか / 書き換え・削除できるか /
--              あなたの名義で行を足せるか / あなたの明細・資産にぶら下げて足せるか
--   3. 未ログイン(anon) … 1件でも見えるか
--   4. 共有ページの入口(RPC) … でたらめなトークン・無効化や期限切れの
--              リンクで、中身が返ってこないか / コメントを書けないか
--   5. 関数の公開範囲 … ログインなしで呼べる security definer 関数が
--              想定どおりか
--
-- 確かめられないこと:
--   * テーブルが空なら「見えるか」は確かめようがない(設定だけを見て OK にする)
--   * 共有リンクで**有効な**トークンを知っている人に何が見えるかは、
--     リンクを渡した相手に見せる設計どおりなので点検しない
-- ============================================================

do $rls$
declare
  v_out jsonb := '[]'::jsonb;
  -- なりすまし役。auth.users に存在しない、毎回ちがう ID
  v_attacker uuid := gen_random_uuid();
  r record;
  v_problems text[];
  v_notes text[];
  v_rows bigint;
  v_n bigint;
  v_state text;
  v_err text;
  v_src jsonb;
  v_res jsonb;
  v_col text;
  v_parent uuid;
  v_token text;
  v_tested int;
  v_bad int;
begin
  for r in
    select c.oid::regclass as rel, c.relname, c.relkind, c.relrowsecurity
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f')
     order by c.relname
  loop
    v_problems := '{}';
    v_notes := '{}';
    execute format('select count(*) from %s', r.rel) into v_rows;

    -- ---------- 1. 設定 ----------
    if r.relkind in ('v', 'm') then
      -- ビューは呼び出し側の RLS を素通りしうる。このアプリはビューを作っていない
      v_problems := v_problems || 'ビュー(RLS を素通りしうる)。心当たりが無ければ調べてください'::text;
    elsif not r.relrowsecurity then
      v_problems := v_problems || 'RLS が無効'::text;
    end if;

    select string_agg(policyname, ', ') into v_err
      from pg_policies
     where schemaname = 'public' and tablename = r.relname
       and coalesce(qual, '') !~ 'auth\.uid\(\)'
       and coalesce(with_check, '') !~ 'auth\.uid\(\)';
    if v_err is not null then
      v_problems := v_problems || ('本人に絞っていないポリシーがある: ' || v_err);
    end if;

    -- ---------- 2. 他人として読む ----------
    v_n := null; v_state := null;
    begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claim.sub', v_attacker::text, true);
      perform set_config('request.jwt.claims',
        jsonb_build_object('sub', v_attacker, 'role', 'authenticated')::text, true);
      execute format('select count(*) from %s', r.rel) into v_n;
      raise exception 'rls_check_rollback';
    exception when others then
      if sqlerrm <> 'rls_check_rollback' then v_state := sqlstate; v_err := sqlerrm; end if;
    end;
    if v_state is not null and v_state <> '42501' then
      v_notes := v_notes || ('他人の読み取りを試せず: ' || v_err);
    elsif v_state is null and v_n > 0 then
      v_problems := v_problems || format('他人に %s 件見える', v_n);
    end if;

    -- ---------- 3. 未ログインで読む ----------
    v_n := null; v_state := null;
    begin
      perform set_config('role', 'anon', true);
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      execute format('select count(*) from %s', r.rel) into v_n;
      raise exception 'rls_check_rollback';
    exception when others then
      if sqlerrm <> 'rls_check_rollback' then v_state := sqlstate; v_err := sqlerrm; end if;
    end;
    if v_state is not null and v_state <> '42501' then
      v_notes := v_notes || ('未ログインの読み取りを試せず: ' || v_err);
    elsif v_state is null and v_n > 0 then
      v_problems := v_problems || format('ログインなしで %s 件見える', v_n);
    end if;

    if r.relkind in ('r', 'p') then
      -- ---------- 2. 他人として書き換え・削除 ----------
      -- 値は変えない(列 = 列)。それでも件数が出れば「触れてしまう」
      select a.attname into v_col
        from pg_attribute a
       where a.attrelid = r.rel and a.attnum > 0 and not a.attisdropped
       order by a.attnum limit 1;

      v_n := null; v_state := null;
      begin
        perform set_config('role', 'authenticated', true);
        perform set_config('request.jwt.claim.sub', v_attacker::text, true);
        perform set_config('request.jwt.claims',
          jsonb_build_object('sub', v_attacker, 'role', 'authenticated')::text, true);
        execute format('update %s set %I = %I', r.rel, v_col, v_col);
        get diagnostics v_n = row_count;
        raise exception 'rls_check_rollback';
      exception when others then
        if sqlerrm <> 'rls_check_rollback' then v_state := sqlstate; v_err := sqlerrm; end if;
      end;
      if v_state is not null and v_state <> '42501' then
        v_notes := v_notes || ('書き換えを試せず: ' || v_err);
      elsif v_state is null and v_n > 0 then
        v_problems := v_problems || format('他人が %s 件書き換えられる', v_n);
      end if;

      v_n := null; v_state := null;
      begin
        perform set_config('role', 'authenticated', true);
        perform set_config('request.jwt.claim.sub', v_attacker::text, true);
        perform set_config('request.jwt.claims',
          jsonb_build_object('sub', v_attacker, 'role', 'authenticated')::text, true);
        execute format('delete from %s', r.rel);
        get diagnostics v_n = row_count;
        raise exception 'rls_check_rollback';
      exception when others then
        if sqlerrm <> 'rls_check_rollback' then v_state := sqlstate; v_err := sqlerrm; end if;
      end;
      if v_state is not null and v_state <> '42501' then
        v_notes := v_notes || ('削除を試せず: ' || v_err);
      elsif v_state is null and v_n > 0 then
        v_problems := v_problems || format('他人が %s 件消せる', v_n);
      end if;

      -- ---------- 2. 他人が「あなたの名義」で足す ----------
      -- 既存の1行を写し、id だけ新しくして入れてみる。持ち主(user_id)はあなたのまま
      execute format('select to_jsonb(x) from %s x limit 1', r.rel) into v_src;
      if v_src is not null then
        if v_src ? 'id' then
          v_src := v_src || jsonb_build_object('id', gen_random_uuid());
        end if;
        v_state := null;
        begin
          perform set_config('role', 'authenticated', true);
          perform set_config('request.jwt.claim.sub', v_attacker::text, true);
          perform set_config('request.jwt.claims',
            jsonb_build_object('sub', v_attacker, 'role', 'authenticated')::text, true);
          execute format('insert into %s select * from jsonb_populate_record(null::%s, $1)', r.rel, r.rel)
            using v_src;
          raise exception 'rls_check_rollback';
        exception when others then
          v_state := sqlstate; v_err := sqlerrm;
        end;
        if v_err = 'rls_check_rollback' then
          v_problems := v_problems || 'あなたの名義で他人が行を足せる'::text;
        elsif v_state <> '42501' then
          v_notes := v_notes || ('名義の追加を試せず: ' || v_err);
        end if;
      end if;
    end if;

    if r.relkind in ('r', 'p') and v_rows = 0 then
      v_notes := v_notes || 'まだ空なので、見え方は設定だけで判断'::text;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_array(
      case when cardinality(v_problems) > 0 then 'NG'
           when exists (select 1 from unnest(v_notes) s where s like '%試せず%') then '確認できず'
           else 'OK' end,
      'テーブル ' || r.relname || format(' (%s 行)', v_rows),
      coalesce(nullif(array_to_string(v_problems || v_notes, ' / '), ''),
               '他人にもログインなしでも 0 件。書き換え・削除・名義の追加もできない')
    ));
  end loop;

  -- ---------- 2. 他人の明細・資産にぶら下げて足す ----------
  -- 名義は自分(なりすまし役)でも、親があなたの行なら断られるべき
  -- (断られずに通ると、ここでは「auth.users に居ない」で止まる = 親の確認が効いていない)
  if to_regclass('public.partner_share_comments') is not null then
    select id into v_parent from public.transactions limit 1;
    if v_parent is null then
      v_out := v_out || jsonb_build_array(jsonb_build_array('OK',
        'あなたの明細へのコメントの書き込み', '明細がまだ無いので試していない'));
    else
      v_state := null;
      begin
        perform set_config('role', 'authenticated', true);
        perform set_config('request.jwt.claim.sub', v_attacker::text, true);
        perform set_config('request.jwt.claims',
          jsonb_build_object('sub', v_attacker, 'role', 'authenticated')::text, true);
        insert into public.partner_share_comments (user_id, transaction_id, author, body)
          values (v_attacker, v_parent, 'owner', 'rls check');
        raise exception 'rls_check_rollback';
      exception when others then
        v_state := sqlstate; v_err := sqlerrm;
      end;
      v_out := v_out || jsonb_build_array(jsonb_build_array(
        case when v_state = '42501' then 'OK' else 'NG' end,
        'あなたの明細へのコメントの書き込み',
        case when v_state = '42501' then '他人は断られる'
             else '他人が書き込めてしまう可能性: ' || v_err end));
    end if;
  end if;

  if to_regclass('public.asset_balances') is not null then
    select id into v_parent from public.assets limit 1;
    if v_parent is null then
      v_out := v_out || jsonb_build_array(jsonb_build_array('OK',
        'あなたの資産への残高の書き込み', '資産がまだ無いので試していない'));
    else
      v_state := null;
      begin
        perform set_config('role', 'authenticated', true);
        perform set_config('request.jwt.claim.sub', v_attacker::text, true);
        perform set_config('request.jwt.claims',
          jsonb_build_object('sub', v_attacker, 'role', 'authenticated')::text, true);
        insert into public.asset_balances (user_id, asset_id, as_of, balance)
          values (v_attacker, v_parent, date '2000-01-01', 0);
        raise exception 'rls_check_rollback';
      exception when others then
        v_state := sqlstate; v_err := sqlerrm;
      end;
      v_out := v_out || jsonb_build_array(jsonb_build_array(
        case when v_state = '42501' then 'OK' else 'NG' end,
        'あなたの資産への残高の書き込み',
        case when v_state = '42501' then '他人は断られる'
             else '他人が書き込めてしまう可能性: ' || v_err end));
    end if;
  end if;

  -- ---------- 4. 共有ページの入口 ----------
  if to_regprocedure('public.partner_share_view(text)') is null then
    v_out := v_out || jsonb_build_array(jsonb_build_array('OK',
      '共有ページの入口', '共有リンクの SQL が未実行なので入口そのものが無い'));
  else
    -- でたらめなトークン(64文字)
    v_token := md5(random()::text) || md5(random()::text);
    v_res := null; v_state := null;
    begin
      perform set_config('role', 'anon', true);
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      v_res := public.partner_share_view(v_token);
      raise exception 'rls_check_rollback';
    exception when others then
      if sqlerrm <> 'rls_check_rollback' then v_state := sqlstate; v_err := sqlerrm; end if;
    end;
    v_out := v_out || jsonb_build_array(jsonb_build_array(
      case when v_state is null and v_res ->> 'ok' = 'false' then 'OK'
           when v_state is not null then '確認できず' else 'NG' end,
      '共有ページ: でたらめなトークン',
      case when v_state is not null then v_err
           when v_res ->> 'ok' = 'false' then '中身は返らない'
           else '中身が返ってしまう' end));

    -- 無効化した / 期限切れのリンク(あなたが過去に作ったもの)
    v_tested := 0; v_bad := 0;
    for v_token in
      select token from public.partner_share_links
       where revoked_at is not null or (expires_at is not null and expires_at <= now())
    loop
      v_tested := v_tested + 1;
      v_res := null; v_state := null;
      begin
        perform set_config('role', 'anon', true);
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claims', '{"role":"anon"}', true);
        v_res := public.partner_share_view(v_token);
        raise exception 'rls_check_rollback';
      exception when others then
        if sqlerrm <> 'rls_check_rollback' then v_state := sqlstate; end if;
      end;
      if v_state is null and coalesce(v_res ->> 'ok', '') <> 'false' then
        v_bad := v_bad + 1;
      end if;
    end loop;
    v_out := v_out || jsonb_build_array(jsonb_build_array(
      case when v_bad > 0 then 'NG' else 'OK' end,
      '共有ページ: 無効化・期限切れのリンク',
      case when v_tested = 0 then '該当するリンクが無いので試していない'
           when v_bad > 0 then format('%s 本中 %s 本で中身が返ってしまう', v_tested, v_bad)
           else format('%s 本とも中身は返らない', v_tested) end));

    if to_regprocedure('public.partner_share_add_comment(text, uuid, text)') is not null then
      v_res := null; v_state := null;
      begin
        perform set_config('role', 'anon', true);
        perform set_config('request.jwt.claim.sub', '', true);
        perform set_config('request.jwt.claims', '{"role":"anon"}', true);
        v_res := public.partner_share_add_comment(
          md5(random()::text) || md5(random()::text), gen_random_uuid(), 'rls check');
        raise exception 'rls_check_rollback';
      exception when others then
        if sqlerrm <> 'rls_check_rollback' then v_state := sqlstate; v_err := sqlerrm; end if;
      end;
      v_out := v_out || jsonb_build_array(jsonb_build_array(
        case when v_state is null and v_res ->> 'ok' = 'false' then 'OK'
             when v_state is not null then '確認できず' else 'NG' end,
        '共有ページ: でたらめなトークンでコメント',
        case when v_state is not null then v_err
             when v_res ->> 'ok' = 'false' then '書き込めない'
             else '書き込めてしまう' end));
    end if;
  end if;

  -- ---------- 5. ログインなしで呼べる security definer 関数 ----------
  -- security definer は RLS を越えて動くので、誰が呼べるかがそのまま守りになる。
  -- 共有ページの2つ(閲覧・コメント)は、トークンを確かめる前提でわざと公開している
  for r in
    select p.oid::regprocedure as fn, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prosecdef
       and has_function_privilege('anon', p.oid, 'execute')
     order by p.proname
  loop
    v_out := v_out || jsonb_build_array(jsonb_build_array(
      case
        when r.proname in ('partner_share_view', 'partner_share_add_comment') then 'OK'
        when r.proname = 'partner_share_new_token' then '注意'
        else 'NG'
      end,
      '関数 ' || r.fn::text || ' をログインなしで呼べる',
      case
        when r.proname in ('partner_share_view', 'partner_share_add_comment') then
          '想定どおり(彼女の共有ページの入口。トークンが合わなければ何も返さない)'
        when r.proname = 'partner_share_new_token' then
          'ランダムな文字列を作って返すだけで、データには触れないので害は無い。'
          || '気になるなら: revoke execute on function public.partner_share_new_token() from anon;'
        else
          '想定外。中身を確かめ、不要なら revoke execute ... from anon, public;'
      end));
  end loop;

  perform set_config('rls_check.out', v_out::text, false);
end
$rls$;

select x ->> 0 as "判定",
       x ->> 1 as "確かめたこと",
       x ->> 2 as "結果"
  from jsonb_array_elements(current_setting('rls_check.out')::jsonb) with ordinality as e(x, n)
 order by case x ->> 0 when 'NG' then 0 when '確認できず' then 1 when '注意' then 2 else 3 end, n;
