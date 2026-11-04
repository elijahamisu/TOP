-- TOP database smoke test. Runs entirely inside one transaction and ROLLs BACK:
-- nothing it creates is kept. Output: one row per check with pass/fail.
BEGIN;

CREATE TEMP TABLE _r (n serial, test text, pass boolean, detail text) ON COMMIT DROP;
GRANT INSERT, SELECT ON _r TO authenticated;
GRANT USAGE ON SEQUENCE _r_n_seq TO authenticated;

DO $$
DECLARE
  a uuid := gen_random_uuid();   -- referrer
  b uuid := gen_random_uuid();   -- normal user (referred by a)
  c uuid := gen_random_uuid();   -- admin (admin email)
  v_plan uuid;
  v_dep uuid;
  v_wd uuid;
  v_n int;
  v_bal numeric;
  v_j json;
  v_err text;
  v_ok boolean;

BEGIN
  -- ---------- sign-up trigger ----------
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ref_test@example.com',
          '{"full_name":"Ref Tester","username":"TestRef"}', now(), now());
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user_test@example.com',
          '{"full_name":"User Tester","username":"usertest","referral_by":"TESTREF"}', now(), now());
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  VALUES (c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'amisuelijaholuwasegun@gmail.com',
          '{"full_name":"Admin Tester","username":"admintest"}', now(), now());

  INSERT INTO _r(test, pass, detail) SELECT 'signup: profile created', count(*) = 1, 'referral_by=' || max(referral_by)
    FROM public.profiles WHERE id = b AND email = 'user_test@example.com' AND full_name = 'User Tester' AND referral_by = 'testref' AND is_admin = false;
  SELECT balance INTO v_bal FROM public.wallets WHERE user_id = b;
  INSERT INTO _r(test, pass, detail) VALUES ('signup: wallet with 450 welcome bonus', v_bal = 450, 'balance=' || coalesce(v_bal::text, 'null'));
  INSERT INTO _r(test, pass, detail) SELECT 'signup: bonus transaction', count(*) = 1, count(*)::text
    FROM public.transactions WHERE user_id = b AND type = 'bonus' AND amount = 450;
  INSERT INTO _r(test, pass, detail) SELECT 'signup: referrals row (case-insensitive)', count(*) = 1, count(*)::text
    FROM public.referrals WHERE referrer_id = a AND referred_id = b;
  INSERT INTO _r(test, pass, detail) SELECT 'signup: admin email gets is_admin', bool_and(is_admin), null
    FROM public.profiles WHERE id = c;

  -- fixtures (as postgres)
  INSERT INTO public.investment_plans (name, min_amount, max_amount, daily_profit_percent, duration_days)
  VALUES ('Test Plan', 1000, 100000, 5, 10) RETURNING id INTO v_plan;
  INSERT INTO public.gift_codes (code, reward_amount, max_redemptions) VALUES ('TESTGIFT', 500, 10);

  -- ---------- as user b ----------
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);

  BEGIN
    UPDATE public.wallets SET balance = 999999 WHERE user_id = b;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    INSERT INTO _r(test, pass, detail) VALUES ('RLS: user direct wallet update blocked', v_n = 0, v_n || ' rows');
  EXCEPTION WHEN others THEN
    INSERT INTO _r(test, pass, detail) VALUES ('RLS: user direct wallet update blocked', true, 'error: ' || sqlerrm);
  END;

  SELECT count(*) INTO v_n FROM public.wallets;
  INSERT INTO _r(test, pass, detail) VALUES ('RLS: user sees only own wallet', v_n = 1, v_n || ' rows');

  BEGIN
    INSERT INTO public.transactions (user_id, amount, type) VALUES (b, 1000000, 'deposit');
    INSERT INTO _r(test, pass, detail) VALUES ('RLS: user cannot insert transactions', false, 'insert succeeded');
  EXCEPTION WHEN others THEN
    INSERT INTO _r(test, pass, detail) VALUES ('RLS: user cannot insert transactions', true, sqlerrm);
  END;

  BEGIN
    UPDATE public.profiles SET is_admin = true WHERE id = b;
    INSERT INTO _r(test, pass, detail) VALUES ('guard: user cannot self-promote', false, 'update succeeded');
  EXCEPTION WHEN others THEN
    INSERT INTO _r(test, pass, detail) VALUES ('guard: user cannot self-promote', true, sqlerrm);
  END;

  UPDATE public.profiles SET full_name = 'Renamed', phone = '0800' WHERE id = b;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r(test, pass, detail) VALUES ('RLS: user can update safe profile fields', v_n = 1, v_n || ' rows');

  SELECT count(*) INTO v_n FROM public.profiles;
  INSERT INTO _r(test, pass, detail) VALUES ('RLS: user sees only own profile (+ own referrals)', v_n = 1, v_n || ' rows');

  BEGIN
    PERFORM public.admin_approve_deposit(gen_random_uuid());
    INSERT INTO _r(test, pass, detail) VALUES ('admin RPC refused for non-admin', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO _r(test, pass, detail) VALUES ('admin RPC refused for non-admin', sqlerrm ILIKE '%admin only%', sqlerrm);
  END;

  -- give balance (as postgres), then invest as b
  RESET ROLE;
  UPDATE public.wallets SET balance = 5000 WHERE user_id = b;
  SET LOCAL ROLE authenticated;

  v_j := public.create_investment(v_plan, 2000);
  INSERT INTO _r(test, pass, detail) VALUES ('create_investment happy path', (v_j->>'balance')::numeric = 3000 AND (v_j->>'daily_profit')::numeric = 100, v_j::text);
  SELECT count(*) INTO v_n FROM public.investments WHERE user_id = b AND status = 'active' AND plan_id = v_plan;
  INSERT INTO _r(test, pass, detail) VALUES ('create_investment: investment row visible to user', v_n = 1, v_n || ' rows');

  BEGIN
    PERFORM public.create_investment(v_plan, 50000);
    INSERT INTO _r(test, pass, detail) VALUES ('create_investment: insufficient balance', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO _r(test, pass, detail) VALUES ('create_investment: insufficient balance', sqlerrm ILIKE '%insufficient balance%', sqlerrm);
  END;

  v_j := public.redeem_gift_code('testgift');
  INSERT INTO _r(test, pass, detail) VALUES ('redeem_gift_code returns {code, amount}', v_j->>'code' = 'TESTGIFT' AND (v_j->>'amount')::numeric = 500, v_j::text);
  BEGIN
    PERFORM public.redeem_gift_code('TESTGIFT');
    INSERT INTO _r(test, pass, detail) VALUES ('redeem_gift_code: second redeem refused', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO _r(test, pass, detail) VALUES ('redeem_gift_code: second redeem refused', true, sqlerrm);
  END;
  -- balance now 3500

  BEGIN
    PERFORM public.request_withdrawal(400, 'OPay', '0123456789', 'User Tester');
    INSERT INTO _r(test, pass, detail) VALUES ('request_withdrawal: min 450', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO _r(test, pass, detail) VALUES ('request_withdrawal: min 450', sqlerrm ILIKE '%minimum%450%', sqlerrm);
  END;

  v_j := public.request_withdrawal(1000, 'OPay', '0123456789', 'User Tester');
  v_wd := (v_j->>'id')::uuid;
  SELECT balance INTO v_bal FROM public.wallets WHERE user_id = b;
  INSERT INTO _r(test, pass, detail) VALUES ('request_withdrawal: 15% fee, no deduction until approval',
    (v_j->>'fee_amount')::numeric = 150 AND (v_j->>'net_amount')::numeric = 850 AND v_bal = 3500, v_j::text || ' balance=' || v_bal);

  BEGIN
    PERFORM public.request_withdrawal(3000, 'OPay', '0123456789', 'User Tester');
    INSERT INTO _r(test, pass, detail) VALUES ('request_withdrawal: pending withdrawal limit', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO _r(test, pass, detail) VALUES ('request_withdrawal: pending withdrawal limit', sqlerrm ILIKE '%pending withdrawal%', sqlerrm);
  END;

  BEGIN
    PERFORM public.request_withdrawal(99999, 'OPay', '0123456789', 'User Tester');
    INSERT INTO _r(test, pass, detail) VALUES ('request_withdrawal: insufficient balance', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO _r(test, pass, detail) VALUES ('request_withdrawal: insufficient balance', sqlerrm ILIKE '%insufficient balance%', sqlerrm);
  END;

  v_j := public.create_deposit(1000, 'OPay', 'REF123', null);
  v_dep := (v_j->>'id')::uuid;
  SELECT count(*) INTO v_n FROM public.transactions WHERE reference_id = v_dep AND status = 'pending';
  INSERT INTO _r(test, pass, detail) VALUES ('create_deposit: pending deposit + pending transaction', v_j->>'status' = 'pending' AND v_n = 1, v_j::text);

  -- ---------- as admin c ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);

  v_j := public.admin_approve_deposit(v_dep);
  SELECT balance INTO v_bal FROM public.wallets WHERE user_id = a;
  INSERT INTO _r(test, pass, detail) VALUES ('admin_approve_deposit: credits user + 20% referral',
    (v_j->>'balance')::numeric = 4500 AND (v_j->>'referral_commission')::numeric = 200 AND v_bal = 650, v_j::text || ' referrer balance=' || v_bal);

  v_j := public.admin_approve_withdrawal(v_wd);
  INSERT INTO _r(test, pass, detail) VALUES ('admin_approve_withdrawal: deducts on approval', (v_j->>'balance')::numeric = 3500, v_j::text);

  v_j := public.admin_adjust_balance(b, -500, 'test deduction');
  INSERT INTO _r(test, pass, detail) VALUES ('admin_adjust_balance', (v_j->>'balance')::numeric = 3000, v_j::text);

  v_j := public.admin_assign_plan(b, v_plan);
  INSERT INTO _r(test, pass, detail) VALUES ('admin_assign_plan', (v_j->>'amount')::numeric = 1000, v_j::text);

  UPDATE public.platform_settings SET withdrawals_locked = true WHERE id = 1;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _r(test, pass, detail) VALUES ('admin can update platform_settings', v_n = 1, v_n || ' rows');

  -- ---------- back to user b ----------
  PERFORM set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.request_withdrawal(500, 'OPay', '0123456789', 'User Tester');
    INSERT INTO _r(test, pass, detail) VALUES ('request_withdrawal: locked', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO _r(test, pass, detail) VALUES ('request_withdrawal: locked', sqlerrm ILIKE '%locked%', sqlerrm);
  END;

  BEGIN
    PERFORM public.process_daily_earnings();
    INSERT INTO _r(test, pass, detail) VALUES ('process_daily_earnings not callable by users', false, 'no error');
  EXCEPTION WHEN others THEN
    INSERT INTO _r(test, pass, detail) VALUES ('process_daily_earnings not callable by users', sqlerrm ILIKE '%permission denied%', sqlerrm);
  END;

  -- ---------- scheduler (as postgres) ----------
  RESET ROLE;
  v_j := public.process_daily_earnings();
  SELECT count(*) INTO v_n FROM public.transactions WHERE user_id = b AND type = 'earning';
  SELECT balance INTO v_bal FROM public.wallets WHERE user_id = b;
  INSERT INTO _r(test, pass, detail) VALUES ('process_daily_earnings credits active investments',
    v_n = 2 AND v_bal = 3150, v_j::text || ' earnings=' || v_n || ' balance=' || v_bal);
  v_j := public.process_daily_earnings();
  INSERT INTO _r(test, pass, detail) VALUES ('process_daily_earnings idempotent same day', (v_j->>'processed')::int = 0, v_j::text);
  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'process-daily-earnings' AND schedule = '0 0 * * *';
  INSERT INTO _r(test, pass, detail) VALUES ('pg_cron job scheduled 00:00 UTC', v_n = 1, v_n::text);
END $$;

SELECT n, test, pass, detail FROM _r ORDER BY n;

ROLLBACK;
