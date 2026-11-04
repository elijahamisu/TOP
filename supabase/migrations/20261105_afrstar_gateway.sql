-- Afrstar payment gateway for TOP.
--  * platform_settings.deposit_mode: 'manual' (bank transfer + admin approval) or 'gateway' (Afrstar checkout, auto-credit)
--  * gateway deposits are credited by the verified Afrstar callback, with referral commission (same rule as manual)
--  * withdrawals always need an admin: Send to gateway (Afrstar payout), Mark as paid (existing approve), Reject
--  * admin can fund (top up) and withdraw the gateway balance; those rows live in gateway_admin_transactions
-- All gw_* functions are service-role only (called from the afrstar edge functions).

alter table public.platform_settings add column if not exists deposit_mode text not null default 'manual';
do $$ begin
  alter table public.platform_settings add constraint platform_settings_deposit_mode_chk check (deposit_mode in ('manual','gateway'));
exception when duplicate_object then null; end $$;

alter table public.deposits
  add column if not exists method text not null default 'manual',
  add column if not exists order_sn text unique,
  add column if not exists order_amount numeric(14,2),
  add column if not exists platform_osn text,
  add column if not exists pay_url text,
  add column if not exists amount_paid numeric(14,2),
  add column if not exists gateway_status integer,
  add column if not exists gateway_message text,
  add column if not exists utr text,
  add column if not exists gateway_payload jsonb;

alter table public.withdrawals
  add column if not exists method text not null default 'manual',
  add column if not exists order_sn text unique,
  add column if not exists platform_osn text,
  add column if not exists payout_amount numeric(14,2),
  add column if not exists bank_code text,
  add column if not exists gateway_status integer,
  add column if not exists gateway_message text,
  add column if not exists utr text,
  add column if not exists sent_at timestamptz,
  add column if not exists sent_by uuid,
  add column if not exists gateway_payload jsonb;

create table if not exists public.gateway_admin_transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('topup','payout')),
  order_sn text not null unique,
  platform_osn text,
  amount numeric(14,2) not null check (amount > 0),
  amount_paid numeric(14,2),
  balance_before numeric(14,2),
  bank_code text, bank_name text, account_number text, account_name text,
  pay_url text,
  status text not null default 'pending',
  gateway_status integer,
  gateway_message text,
  utr text,
  gateway_payload jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.gateway_admin_transactions enable row level security;
drop policy if exists "admins read gateway tx" on public.gateway_admin_transactions;
create policy "admins read gateway tx" on public.gateway_admin_transactions for select to authenticated using (public.is_admin());

-- ---------- shared: credit a pending deposit + referral commission ----------
create or replace function public._credit_deposit(p_id uuid, p_actor uuid, p_credit numeric default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  d public.deposits;
  s public.platform_settings;
  v_amt numeric;
  v_new_bal numeric;
  v_ref_by text;
  v_dep_username text;
  v_referrer uuid;
  v_commission numeric := 0;
  v_ref_bal numeric;
  v_desc text;
begin
  select * into d from public.deposits where id = p_id for update;
  if not found then raise exception 'Deposit not found'; end if;
  if d.status <> 'pending' then raise exception 'Deposit is already %', d.status; end if;
  select * into s from public.platform_settings where id = 1;
  v_amt := coalesce(p_credit, d.amount);
  if v_amt <= 0 then raise exception 'Nothing to credit'; end if;
  v_desc := case when d.method = 'gateway' then 'Deposit via payment gateway' else 'Deposit Verified & Approved' end;

  update public.deposits set status = 'approved', amount = v_amt, processed_by = p_actor, processed_at = now(), updated_at = now() where id = p_id;
  perform 1 from public.wallets where user_id = d.user_id for update;
  update public.wallets set balance = balance + v_amt, updated_at = now() where user_id = d.user_id returning balance into v_new_bal;
  if not found then raise exception 'Wallet not found'; end if;

  update public.transactions set status = 'success', amount = v_amt, balance_after = v_new_bal, description = v_desc
   where reference_id = p_id and type = 'deposit';
  if not found then
    insert into public.transactions (user_id, amount, type, description, status, balance_after, reference_id)
    values (d.user_id, v_amt, 'deposit', v_desc, 'success', v_new_bal, p_id);
  end if;
  insert into public.notifications (user_id, title, message, type)
  values (d.user_id, case when d.method = 'gateway' then 'Deposit Successful' else 'Deposit Approved' end,
    'Your deposit of ₦' || to_char(v_amt, 'FM999,999,999,990.00') || ' has been added to your wallet.', 'deposit');

  -- referral commission (manual and gateway deposits alike)
  select referral_by, username into v_ref_by, v_dep_username from public.profiles where id = d.user_id;
  if s.enable_referrals and v_ref_by is not null then
    select id into v_referrer from public.profiles where lower(username) = lower(v_ref_by) and id <> d.user_id limit 1;
    if v_referrer is not null then
      v_commission := round(v_amt * coalesce(s.referral_percent, 20) / 100, 2);
      if v_commission > 0 then
        perform 1 from public.wallets where user_id = v_referrer for update;
        update public.wallets set balance = balance + v_commission, updated_at = now() where user_id = v_referrer returning balance into v_ref_bal;
        insert into public.transactions (user_id, amount, type, description, status, balance_after, reference_id)
        values (v_referrer, v_commission, 'referral',
          'Referral commission (' || coalesce(s.referral_percent, 20) || '%) from @' || coalesce(v_dep_username, 'user') || '''s deposit', 'success', v_ref_bal, p_id);
        insert into public.notifications (user_id, title, message, type)
        values (v_referrer, 'Referral Commission Earned',
          'You earned ₦' || to_char(v_commission, 'FM999,999,990.00') || ' from @' || coalesce(v_dep_username, 'user') || '''s deposit!', 'referral');
        insert into public.referrals (referrer_id, referred_id, reward_amount, reward_percent, reward_status, reward_date)
        values (v_referrer, d.user_id, v_commission, s.referral_percent, 'paid', now())
        on conflict (referred_id) do update set reward_amount = public.referrals.reward_amount + excluded.reward_amount,
          reward_percent = excluded.reward_percent, reward_status = 'paid', reward_date = now();
      end if;
    end if;
  end if;
  return json_build_object('id', p_id, 'status', 'approved', 'credited', v_amt, 'balance', v_new_bal, 'referral_commission', v_commission);
end $$;
revoke execute on function public._credit_deposit(uuid, uuid, numeric) from public, anon, authenticated;

-- manual approval now uses the shared credit path
create or replace function public.admin_approve_deposit(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare v json;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  v := public._credit_deposit(p_id, auth.uid(), null);
  perform public._admin_log('Approved Deposit #' || p_id, p_id::text);
  return v;
end $$;

-- ---------- gateway deposit: create the pending order ----------
create or replace function public.gw_create_deposit(p_user uuid, p_amount numeric, p_order_sn text)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_status text; v_min numeric; v_mode text; v_maint boolean; v_id uuid;
begin
  select coalesce(min_deposit_amount, 0), deposit_mode, coalesce(maintenance_mode, false) into v_min, v_mode, v_maint from public.platform_settings where id = 1;
  if v_maint then raise exception 'TOP is under maintenance. Please try again shortly.'; end if;
  if v_mode <> 'gateway' then raise exception 'Online payment is not available right now. Please use bank transfer.'; end if;
  select status into v_status from public.profiles where id = p_user;
  if coalesce(v_status, '') <> 'active' then raise exception 'Your account is not active'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a valid amount'; end if;
  if p_amount < v_min then raise exception 'Minimum deposit is ₦%', v_min; end if;

  insert into public.deposits (user_id, amount, order_amount, payment_method, method, order_sn, status, gateway_message)
  values (p_user, round(p_amount, 2), round(p_amount, 2), 'Payment Gateway', 'gateway', p_order_sn, 'pending', 'Creating checkout…')
  returning id into v_id;
  insert into public.transactions (user_id, amount, type, description, status, reference_id)
  values (p_user, round(p_amount, 2), 'deposit', 'Deposit via payment gateway (awaiting payment)', 'pending', v_id);
  return json_build_object('id', v_id);
end $$;

create or replace function public.gw_fail_deposit(p_order_sn text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare d public.deposits;
begin
  select * into d from public.deposits where order_sn = p_order_sn for update;
  if not found or d.status <> 'pending' then return; end if;
  update public.deposits set status = 'failed', gateway_message = p_message, updated_at = now() where id = d.id;
  update public.transactions set status = 'failed', description = 'Gateway deposit failed' where reference_id = d.id and type = 'deposit';
end $$;

-- ---------- payin callback (user deposit) ----------
create or replace function public.gw_apply_payin(p_order_sn text, p_platform_osn text, p_status integer, p_amount_paid numeric,
  p_message text, p_utr text, p_payload jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare d public.deposits; v_credit numeric;
begin
  select * into d from public.deposits where order_sn = p_order_sn and method = 'gateway' for update;
  if not found then return 'not_found'; end if;
  if d.platform_osn is not null and d.platform_osn <> p_platform_osn then return 'osn_mismatch'; end if;
  if d.status = 'approved' then return 'duplicate'; end if;
  update public.deposits set platform_osn = p_platform_osn, gateway_status = p_status, gateway_message = p_message,
    amount_paid = p_amount_paid, utr = coalesce(p_utr, utr), gateway_payload = p_payload, updated_at = now() where id = d.id;
  if p_status <> 1 then return 'recorded'; end if;
  if d.status not in ('pending', 'failed') then return 'ignored'; end if;
  if d.status = 'failed' then update public.deposits set status = 'pending' where id = d.id; end if;
  -- credit what was actually paid, never more than the order
  v_credit := least(d.order_amount, coalesce(p_amount_paid, d.order_amount));
  perform public._credit_deposit(d.id, null, v_credit);
  return 'credited';
end $$;

-- ---------- withdrawals: send to gateway ----------
-- pending -> processing: debits the wallet now (as approval does), the payout callback finalises it.
create or replace function public.gw_claim_withdrawal(p_id uuid, p_admin uuid, p_order_sn text, p_bank_code text)
returns json language plpgsql security definer set search_path = public as $$
declare w public.withdrawals; v_bal numeric; v_net numeric;
begin
  select * into w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'Withdrawal not found'; end if;
  if w.status <> 'pending' then raise exception 'Withdrawal is already %', w.status; end if;
  select balance into v_bal from public.wallets where user_id = w.user_id for update;
  if v_bal is null then raise exception 'Wallet not found'; end if;
  if v_bal < w.amount then raise exception 'Insufficient balance: user has ₦% but the withdrawal is ₦%', v_bal, w.amount; end if;
  v_net := round(coalesce(w.net_amount, w.amount - coalesce(w.fee_amount, 0)), 2);
  if v_net <= 0 then raise exception 'Net payout is zero'; end if;

  update public.wallets set balance = balance - w.amount, updated_at = now() where user_id = w.user_id returning balance into v_bal;
  update public.withdrawals set status = 'processing', method = 'gateway', order_sn = p_order_sn, payout_amount = v_net,
    bank_code = p_bank_code, sent_at = now(), sent_by = p_admin, processed_by = p_admin,
    platform_osn = null, gateway_status = null, gateway_message = 'Sending to gateway…' where id = p_id;
  update public.transactions set balance_after = v_bal, description = 'Withdrawal processing via payment gateway' where reference_id = p_id and type = 'withdrawal';
  insert into public.admin_logs (admin_id, admin_name, action, target_id)
  select p_admin, (select full_name from public.profiles where id = p_admin), 'Sent Withdrawal #' || p_id || ' to gateway', p_id::text;
  return json_build_object('id', p_id, 'user_id', w.user_id, 'payout_amount', v_net, 'account_number', w.account_number, 'account_name', w.account_name);
end $$;

-- processing -> pending with the wallet refunded (gateway refused or payout failed)
create or replace function public.gw_revert_withdrawal(p_id uuid, p_message text)
returns text language plpgsql security definer set search_path = public as $$
declare w public.withdrawals; v_bal numeric;
begin
  select * into w from public.withdrawals where id = p_id for update;
  if not found then return 'not_found'; end if;
  if w.status <> 'processing' then return 'ignored'; end if;
  perform 1 from public.wallets where user_id = w.user_id for update;
  update public.wallets set balance = balance + w.amount, updated_at = now() where user_id = w.user_id returning balance into v_bal;
  update public.withdrawals set status = 'pending', method = 'manual', order_sn = null, platform_osn = null, payout_amount = null,
    sent_at = null, sent_by = null, processed_by = null, gateway_message = p_message where id = p_id;
  update public.transactions set balance_after = null, description = 'Withdrawal request (pending approval)' where reference_id = p_id and type = 'withdrawal';
  return 'reverted';
end $$;

create or replace function public.gw_set_withdrawal_osn(p_id uuid, p_platform_osn text, p_message text)
returns void language sql security definer set search_path = public as $$
  update public.withdrawals set platform_osn = coalesce(p_platform_osn, platform_osn), gateway_message = p_message
   where id = p_id and status = 'processing';
$$;

-- ---------- payout callback (user withdrawal) ----------
create or replace function public.gw_apply_payout(p_order_sn text, p_platform_osn text, p_status integer, p_amount numeric,
  p_message text, p_utr text, p_payload jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare w public.withdrawals;
begin
  select * into w from public.withdrawals where order_sn = p_order_sn for update;
  if not found then return 'not_found'; end if;
  if w.platform_osn is not null and w.platform_osn <> p_platform_osn then return 'osn_mismatch'; end if;
  if round(w.payout_amount, 2) <> round(p_amount, 2) then return 'amount_mismatch'; end if;
  if w.status = 'approved' then return 'duplicate'; end if;
  if w.status <> 'processing' then return 'ignored'; end if;
  update public.withdrawals set platform_osn = p_platform_osn, gateway_status = p_status, utr = coalesce(p_utr, utr), gateway_payload = p_payload where id = w.id;
  if p_status = 1 then
    update public.withdrawals set status = 'approved', processed_at = now(), gateway_message = coalesce(p_message, 'Paid by gateway') where id = w.id;
    update public.transactions set status = 'success', description = 'Withdrawal paid to ' || coalesce(w.bank_name, 'bank') where reference_id = w.id and type = 'withdrawal';
    insert into public.notifications (user_id, title, message, type)
    values (w.user_id, 'Withdrawal Paid', 'Your withdrawal of ₦' || to_char(w.amount, 'FM999,999,999,990') || ' was approved. ₦' ||
      to_char(w.payout_amount, 'FM999,999,999,990.00') || ' has been sent to your bank account.', 'withdrawal');
    return 'completed';
  elsif p_status = 9 then
    perform public.gw_revert_withdrawal(w.id, 'Gateway payout failed: ' || coalesce(p_message, 'no reason given') || '. Wallet refunded; request is pending again.');
    return 'failed_reverted';
  end if;
  return 'recorded';
end $$;

-- ---------- admin top-up / payout callbacks ----------
create or replace function public.gw_apply_admin(p_order_sn text, p_platform_osn text, p_status integer, p_amount numeric,
  p_message text, p_utr text, p_payload jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare t public.gateway_admin_transactions;
begin
  select * into t from public.gateway_admin_transactions where order_sn = p_order_sn for update;
  if not found then return 'not_found'; end if;
  if t.platform_osn is not null and t.platform_osn <> p_platform_osn then return 'osn_mismatch'; end if;
  if t.status = 'completed' then return 'duplicate'; end if;
  update public.gateway_admin_transactions set platform_osn = p_platform_osn, gateway_status = p_status, gateway_message = p_message,
    utr = coalesce(p_utr, utr), gateway_payload = p_payload, updated_at = now(),
    amount_paid = case when t.kind = 'topup' then p_amount else amount_paid end,
    status = case when p_status = 1 then 'completed' when p_status = 9 then 'failed' else status end
   where id = t.id;
  return case when p_status = 1 then 'completed' when p_status = 9 then 'failed' else 'recorded' end;
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'gw_create_deposit(uuid, numeric, text)', 'gw_fail_deposit(text, text)',
    'gw_apply_payin(text, text, integer, numeric, text, text, jsonb)',
    'gw_claim_withdrawal(uuid, uuid, text, text)', 'gw_revert_withdrawal(uuid, text)', 'gw_set_withdrawal_osn(uuid, text, text)',
    'gw_apply_payout(text, text, integer, numeric, text, text, jsonb)',
    'gw_apply_admin(text, text, integer, numeric, text, text, jsonb)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
grant execute on function public._credit_deposit(uuid, uuid, numeric) to service_role;

-- reject stays manual-only on pending rows; also let admins clear abandoned gateway deposits
create or replace function public.admin_reject_deposit(p_id uuid, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare d public.deposits;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into d from public.deposits where id = p_id for update;
  if not found then raise exception 'Deposit not found'; end if;
  if d.status not in ('pending', 'failed') then raise exception 'Deposit is already %', d.status; end if;
  update public.deposits set status = 'rejected', rejection_reason = p_reason, processed_by = auth.uid(), processed_at = now(), updated_at = now() where id = p_id;
  update public.transactions set status = 'failed', description = 'Deposit Rejected: ' || coalesce(p_reason, '') where reference_id = p_id and type = 'deposit';
  if d.method <> 'gateway' then
    insert into public.notifications (user_id, title, message, type)
    values (d.user_id, 'Deposit Rejected', 'Your deposit of ₦' || to_char(d.amount, 'FM999,999,999,990') || ' was rejected. Reason: ' || coalesce(p_reason, 'not specified'), 'deposit');
  end if;
  perform public._admin_log('Rejected Deposit #' || p_id || coalesce('. Reason: ' || p_reason, ''), p_id::text);
  return json_build_object('id', p_id, 'status', 'rejected');
end $$;

-- manual deposits only when the switch is on manual
create or replace function public.create_deposit(p_amount numeric, p_method text, p_reference text, p_proof_url text,
  p_sender_account_name text default null, p_sender_bank_name text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_status text; v_min numeric; v_mode text; v_id uuid;
begin
  if v_uid is null then raise exception 'You must be signed in'; end if;
  perform public._assert_not_maintenance();
  select status into v_status from public.profiles where id = v_uid;
  if coalesce(v_status, '') <> 'active' then raise exception 'Your account is not active'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a valid amount'; end if;
  select coalesce(min_deposit_amount, 0), deposit_mode into v_min, v_mode from public.platform_settings where id = 1;
  if v_mode = 'gateway' then raise exception 'Bank transfer deposits are paused. Please use online payment.'; end if;
  if p_amount < v_min then raise exception 'Minimum deposit is ₦%', v_min; end if;

  insert into public.deposits (user_id, amount, payment_method, payment_reference, proof_url, sender_account_name, sender_bank_name, status, method)
  values (v_uid, p_amount, p_method, p_reference, p_proof_url, p_sender_account_name, p_sender_bank_name, 'pending', 'manual')
  returning id into v_id;
  insert into public.transactions (user_id, amount, type, description, status, reference_id)
  values (v_uid, p_amount, 'deposit', 'Deposit via ' || coalesce(p_method, 'bank transfer') || ' (pending approval)', 'pending', v_id);
  insert into public.notifications (user_id, title, message, type)
  values (v_uid, 'Deposit Received', 'Your deposit of ₦' || to_char(p_amount, 'FM999,999,999,990') || ' is pending approval.', 'deposit');
  return json_build_object('id', v_id, 'status', 'pending');
end $$;
