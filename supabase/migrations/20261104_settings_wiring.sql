-- Settings wiring (2026-11-04): maintenance guard + notification toggles
create or replace function public._assert_not_maintenance()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from public.platform_settings where id = 1 and maintenance_mode)
     and not public.is_admin() then
    raise exception 'TOP is under maintenance. Please try again shortly.';
  end if;
end $$;
revoke execute on function public._assert_not_maintenance() from public, anon;

create or replace function public.filter_notification_by_settings()
returns trigger language plpgsql security definer set search_path = public as $$
declare s public.platform_settings;
begin
  select * into s from public.platform_settings where id = 1;
  if not found then return new; end if;
  if new.type = 'deposit' and s.notif_deposit is false then return null; end if;
  if new.type = 'withdrawal' and s.notif_withdraw is false then return null; end if;
  if new.type = 'earning' and s.notif_earnings is false then return null; end if;
  return new;
end $$;
drop trigger if exists trg_filter_notification_by_settings on public.notifications;
create trigger trg_filter_notification_by_settings before insert on public.notifications
  for each row execute function public.filter_notification_by_settings();

create or replace function public.create_investment(p_plan_id uuid, p_amount numeric)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_plan public.investment_plans;
  v_wallet public.wallets;
  v_status text;
  v_inv_id uuid;
  v_daily numeric;
  v_new_bal numeric;
  s public.platform_settings;
begin
  if v_uid is null then raise exception 'You must be signed in'; end if;
  perform public._assert_not_maintenance();
  select status into v_status from public.profiles where id = v_uid;
  if coalesce(v_status, '') <> 'active' then raise exception 'Your account is not active'; end if;
  select * into s from public.platform_settings where id = 1;
  if s.enable_investments = false then raise exception 'Investments are currently disabled'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a valid amount'; end if;
  if coalesce(s.min_investment, 0) > 0 and p_amount < s.min_investment then
    raise exception 'Minimum investment is ₦%', to_char(s.min_investment, 'FM999,999,999,990'); end if;
  if coalesce(s.max_investment, 0) > 0 and p_amount > s.max_investment then
    raise exception 'Maximum investment is ₦%', to_char(s.max_investment, 'FM999,999,999,990'); end if;

  select * into v_plan from public.investment_plans where id = p_plan_id;
  if not found then raise exception 'Investment plan not found'; end if;
  if not v_plan.is_available or not v_plan.is_active then raise exception 'This plan is not available'; end if;
  if p_amount < v_plan.min_amount then raise exception 'Minimum amount for this plan is ₦%', v_plan.min_amount; end if;
  if v_plan.max_amount is not null and v_plan.max_amount > 0 and p_amount > v_plan.max_amount then
    raise exception 'Maximum amount for this plan is ₦%', v_plan.max_amount; end if;

  select * into v_wallet from public.wallets where user_id = v_uid for update;
  if not found then raise exception 'Wallet not found'; end if;
  if v_wallet.balance < p_amount then raise exception 'Insufficient balance'; end if;

  v_new_bal := v_wallet.balance - p_amount;
  v_daily := round(p_amount * v_plan.daily_profit_percent / 100, 2);
  update public.wallets set balance = v_new_bal, updated_at = now() where id = v_wallet.id;

  insert into public.investments (user_id, plan_id, plan_name, amount, daily_profit, daily_rate, profit_percent,
    duration, expected_return, start_date, end_date, status)
  values (v_uid, v_plan.id, v_plan.name, p_amount, v_daily, v_plan.daily_profit_percent, v_plan.daily_profit_percent,
    v_plan.duration_days, v_daily * v_plan.duration_days, now(), now() + make_interval(days => v_plan.duration_days), 'active')
  returning id into v_inv_id;

  insert into public.transactions (user_id, investment_id, amount, type, description, status, balance_after)
  values (v_uid, v_inv_id, p_amount, 'investment', 'Invested in ' || v_plan.name, 'success', v_new_bal);

  insert into public.notifications (user_id, title, message, type)
  values (v_uid, 'Investment Successful',
    'Your investment of ₦' || to_char(p_amount, 'FM999,999,999,990') || ' in ' || v_plan.name || ' is now active.', 'investment');

  return json_build_object('investment_id', v_inv_id, 'balance', v_new_bal, 'daily_profit', v_daily);
end $$;

create or replace function public.create_deposit(p_amount numeric, p_method text, p_reference text, p_proof_url text,
  p_sender_account_name text default null, p_sender_bank_name text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_min numeric;
  v_id uuid;
begin
  if v_uid is null then raise exception 'You must be signed in'; end if;
  perform public._assert_not_maintenance();
  select status into v_status from public.profiles where id = v_uid;
  if coalesce(v_status, '') <> 'active' then raise exception 'Your account is not active'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a valid amount'; end if;
  select coalesce(min_deposit_amount, 0) into v_min from public.platform_settings where id = 1;
  if p_amount < v_min then raise exception 'Minimum deposit is ₦%', v_min; end if;

  insert into public.deposits (user_id, amount, payment_method, payment_reference, proof_url, sender_account_name, sender_bank_name, status)
  values (v_uid, p_amount, p_method, p_reference, p_proof_url, p_sender_account_name, p_sender_bank_name, 'pending')
  returning id into v_id;

  insert into public.transactions (user_id, amount, type, description, status, reference_id)
  values (v_uid, p_amount, 'deposit', 'Deposit via ' || coalesce(p_method, 'bank transfer') || ' (pending approval)', 'pending', v_id);

  insert into public.notifications (user_id, title, message, type)
  values (v_uid, 'Deposit Received', 'Your deposit of ₦' || to_char(p_amount, 'FM999,999,999,990') || ' is pending approval.', 'deposit');

  return json_build_object('id', v_id, 'status', 'pending');
end $$;

create or replace function public.request_withdrawal(p_amount numeric, p_bank_name text, p_account_number text, p_account_name text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  s public.platform_settings;
  v_status text;
  v_wallet public.wallets;
  v_pending numeric;
  v_fee numeric;
  v_net numeric;
  v_id uuid;
begin
  if v_uid is null then raise exception 'You must be signed in'; end if;
  perform public._assert_not_maintenance();
  select status into v_status from public.profiles where id = v_uid;
  if coalesce(v_status, '') <> 'active' then raise exception 'Your account is not active'; end if;
  select * into s from public.platform_settings where id = 1;
  if s.withdrawals_locked or s.enable_withdrawals = false then
    raise exception 'Withdrawals are currently locked by admin. Please check back later.'; end if;
  if not exists (select 1 from public.investments where user_id = v_uid and status = 'active') then
    raise exception 'You need at least one active investment plan to request a withdrawal.'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a valid amount'; end if;
  if p_amount < coalesce(s.min_withdrawal_amount, 450) then
    raise exception 'Minimum withdrawal is ₦%', coalesce(s.min_withdrawal_amount, 450); end if;
  if coalesce(trim(p_bank_name), '') = '' or coalesce(trim(p_account_number), '') = '' or coalesce(trim(p_account_name), '') = '' then
    raise exception 'Enter your bank name, account number and account name'; end if;

  select * into v_wallet from public.wallets where user_id = v_uid for update;
  if not found then raise exception 'Wallet not found'; end if;
  select coalesce(sum(amount), 0) into v_pending from public.withdrawals where user_id = v_uid and status = 'pending';
  if p_amount > v_wallet.balance then raise exception 'Insufficient balance'; end if;
  if p_amount > v_wallet.balance - v_pending then
    raise exception 'You have a pending withdrawal of ₦%. You can only request up to ₦% right now.', v_pending, greatest(v_wallet.balance - v_pending, 0); end if;

  v_fee := round(p_amount * coalesce(s.withdrawal_fee_percent, 15) / 100, 2);
  v_net := p_amount - v_fee;

  insert into public.withdrawals (user_id, amount, fee_amount, net_amount, bank_name, account_number, account_name, status)
  values (v_uid, p_amount, v_fee, v_net, trim(p_bank_name), trim(p_account_number), trim(p_account_name), 'pending')
  returning id into v_id;

  insert into public.transactions (user_id, amount, type, description, status, reference_id)
  values (v_uid, p_amount, 'withdrawal',
    'Withdrawal request to ' || trim(p_bank_name) || ' (' || coalesce(s.withdrawal_fee_percent, 15) || '% charge, net payout ₦' || to_char(v_net, 'FM999,999,999,990.00') || ')',
    'pending', v_id);

  insert into public.notifications (user_id, title, message, type)
  values (v_uid, 'Withdrawal Submitted', 'Your request for ₦' || to_char(p_amount, 'FM999,999,999,990') || ' has been received and is pending approval.', 'withdrawal');

  return json_build_object('id', v_id, 'amount', p_amount, 'fee_amount', v_fee, 'net_amount', v_net, 'status', 'pending');
end $$;

create or replace function public.redeem_gift_code(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_gc public.gift_codes;
  v_new_bal numeric;
begin
  if v_uid is null then raise exception 'You must be signed in'; end if;
  perform public._assert_not_maintenance();
  if p_code is null or trim(p_code) = '' then raise exception 'Enter a gift code'; end if;

  select * into v_gc from public.gift_codes where upper(code) = upper(trim(p_code)) for update;
  if not found then raise exception 'Invalid gift code'; end if;
  if not v_gc.is_active then raise exception 'This gift code is no longer active'; end if;
  if v_gc.expiry_date is not null and v_gc.expiry_date < now() then raise exception 'This gift code has expired'; end if;
  if coalesce(v_gc.max_redemptions, 0) > 0 and v_gc.current_redemptions >= v_gc.max_redemptions then
    raise exception 'This gift code has reached its redemption limit'; end if;
  if exists (select 1 from public.gift_code_redemptions where gift_code_id = v_gc.id and user_id = v_uid) then
    raise exception 'You have already redeemed this gift code'; end if;

  insert into public.gift_code_redemptions (gift_code_id, user_id, amount) values (v_gc.id, v_uid, v_gc.reward_amount);
  update public.gift_codes set current_redemptions = current_redemptions + 1 where id = v_gc.id;

  update public.wallets set balance = balance + v_gc.reward_amount, updated_at = now()
   where user_id = v_uid returning balance into v_new_bal;
  if not found then raise exception 'Wallet not found'; end if;

  insert into public.transactions (user_id, amount, type, description, status, balance_after)
  values (v_uid, v_gc.reward_amount, 'bonus', 'Gift code ' || v_gc.code || ' redeemed', 'success', v_new_bal);
  insert into public.notifications (user_id, title, message, type)
  values (v_uid, 'Gift Code Redeemed', '₦' || to_char(v_gc.reward_amount, 'FM999,999,990') || ' from gift code ' || v_gc.code || ' was added to your wallet.', 'bonus');

  return json_build_object('code', v_gc.code, 'amount', v_gc.reward_amount);
end $$;
