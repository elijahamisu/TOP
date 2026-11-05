-- Plan states: active (is_available), deactivated (not available), coming soon.
alter table public.investment_plans add column if not exists coming_soon boolean not null default false;

CREATE OR REPLACE FUNCTION public.create_investment(p_plan_id uuid, p_amount numeric)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if v_plan.coming_soon then raise exception 'This plan is coming soon'; end if;
  if not v_plan.is_available or not v_plan.is_active then raise exception 'This plan is not available'; end if;
  -- Fixed-price plans: the investment amount is the plan amount.
  if p_amount <> v_plan.min_amount then raise exception 'The amount for this plan is ₦%', to_char(v_plan.min_amount, 'FM999,999,999,990'); end if;
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
end $function$

;
