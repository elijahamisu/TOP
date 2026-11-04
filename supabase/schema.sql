-- =====================================================================
-- TOP — Supabase database schema
-- Project: qeflimxlemgtjldoxtid
-- Safe to re-run: tables use IF NOT EXISTS, functions CREATE OR REPLACE,
-- policies are dropped and recreated.
-- Sections are separated by "-- @@CHUNK" markers (applied one at a time).
-- =====================================================================

-- @@CHUNK 1: extensions + tables
create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  username text,
  phone text,
  referral_code text,
  referral_by text,
  is_admin boolean not null default false,
  avatar_url text,
  status text not null default 'active',
  saved_bank_name text,
  saved_account_number text,
  saved_account_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_username_ci_key on public.profiles (lower(username));
create index if not exists profiles_referral_by_ci_idx on public.profiles (lower(referral_by));

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  balance numeric(14,2) not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investment_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price numeric(14,2),
  min_amount numeric(14,2) not null default 0,
  max_amount numeric(14,2),
  daily_profit_percent numeric(8,3) not null default 0,
  duration_days integer not null default 30,
  is_available boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.investments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid references public.investment_plans(id) on delete set null,
  plan_name text,
  amount numeric(14,2) not null,
  daily_profit numeric(14,2),
  daily_rate numeric(8,3),
  profit_percent numeric(8,3),
  duration integer,
  expected_return numeric(14,2),
  total_earned numeric(14,2) not null default 0,
  last_earning_at timestamptz,
  start_date timestamptz not null default now(),
  end_date timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create index if not exists investments_user_idx on public.investments(user_id);
create index if not exists investments_status_idx on public.investments(status);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  investment_id uuid references public.investments(id) on delete set null,
  amount numeric(14,2) not null,
  type text not null,
  description text,
  status text not null default 'success',
  balance_after numeric(14,2),
  reference_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists transactions_user_idx on public.transactions(user_id);
create index if not exists transactions_type_idx on public.transactions(type);
create index if not exists transactions_ref_idx on public.transactions(reference_id);

create table if not exists public.deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text,
  payment_reference text,
  sender_account_name text,
  sender_bank_name text,
  proof_url text,
  status text not null default 'pending',
  rejection_reason text,
  processed_by uuid,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deposits_user_idx on public.deposits(user_id);

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  fee_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2),
  bank_name text,
  account_number text,
  account_name text,
  status text not null default 'pending',
  rejection_reason text,
  processed_by uuid,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists withdrawals_user_idx on public.withdrawals(user_id);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  title text,
  message text,
  type text not null default 'system',
  priority text not null default 'normal',
  status text not null default 'delivered',
  is_read boolean not null default false,
  read_at timestamptz,
  scheduled_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications(user_id);

create table if not exists public.admin_logs (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id) on delete set null,
  admin_name text,
  action text,
  target_id text,
  ip_address text,
  device_info text,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  id integer primary key default 1 check (id = 1),
  app_name text default 'TOP',
  app_description text,
  app_url text,
  support_email text,
  telegram_link text,
  telegram_popup_enabled boolean not null default true,
  telegram_popup_title text default 'Join Our Community',
  telegram_popup_message text default 'Join our Telegram community for investment updates, announcements, and 24/7 support.',
  telegram_channel_link text default 'https://t.me/monvexachannel',
  telegram_group_button text default 'Join Telegram Group',
  telegram_channel_button text default 'Join Telegram Channel',
  welcome_bonus_amount numeric(14,2) not null default 450,
  enable_welcome_bonus boolean not null default true,
  referral_percent numeric(6,2) not null default 20,
  enable_referrals boolean not null default true,
  min_withdrawal_amount numeric(14,2) not null default 450,
  withdrawal_fee_percent numeric(6,2) not null default 15,
  withdrawals_locked boolean not null default false,
  enable_withdrawals boolean not null default true,
  min_deposit_amount numeric(14,2) not null default 0,
  min_investment numeric(14,2),
  max_investment numeric(14,2),
  min_investment_amount numeric(14,2),
  enable_investments boolean not null default true,
  enable_earnings boolean not null default true,
  earnings_time text default '00:00',
  kuda_bank_name text,
  kuda_account_name text,
  kuda_account_number text,
  deposit_instructions text,
  maintenance_mode boolean not null default false,
  max_login_attempts integer default 5,
  session_timeout integer default 60,
  notif_deposit boolean default true,
  notif_earnings boolean default true,
  notif_withdraw boolean default true,
  updated_at timestamptz not null default now(),
  last_updated_by uuid,
  last_updated_by_name text
);
insert into public.platform_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject text,
  category text,
  message text,
  status text not null default 'open',
  priority text not null default 'normal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_replies (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  message text,
  is_admin boolean not null default false,
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.gift_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  reward_type text not null default 'cash',
  reward_amount numeric(14,2) not null default 0,
  expiry_date timestamptz,
  max_redemptions integer,
  current_redemptions integer not null default 0,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.gift_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  gift_code_id uuid not null references public.gift_codes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(14,2),
  redeemed_at timestamptz not null default now(),
  unique (gift_code_id, user_id)
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_id uuid not null unique references public.profiles(id) on delete cascade,
  reward_amount numeric(14,2) not null default 0,
  reward_percent numeric(6,2),
  reward_status text not null default 'pending',
  reward_date timestamptz,
  admin_note text,
  created_at timestamptz not null default now()
);

create table if not exists public.scheduler_logs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null default current_date,
  status text,
  processed_count integer default 0,
  failed_count integer default 0,
  total_amount numeric(14,2) default 0,
  details text,
  created_at timestamptz not null default now()
);

create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  module text,
  reference_id text,
  error_message text,
  created_at timestamptz not null default now()
);

-- @@CHUNK 2: helpers, guard triggers, RLS
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

create or replace function public.my_username()
returns text language sql stable security definer set search_path = public as $$
  select p.username from public.profiles p where p.id = auth.uid();
$$;

-- Lets the sign-up page check a username without exposing the profiles table.
create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where lower(username) = lower(trim(p_username)));
$$;

-- Is the caller an end user (PostgREST anon/authenticated) rather than an admin or a SECURITY DEFINER function?
create or replace function public._is_end_user()
returns boolean language sql stable set search_path = public as $$
  select current_user in ('authenticated','anon') and not public.is_admin();
$$;

create or replace function public.guard_profile_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if public._is_end_user() then
    if new.is_admin is distinct from old.is_admin then raise exception 'Not allowed to change is_admin'; end if;
    if new.email is distinct from old.email then raise exception 'Not allowed to change email'; end if;
    if new.referral_by is distinct from old.referral_by then raise exception 'Not allowed to change referral_by'; end if;
    if new.status is distinct from old.status then raise exception 'Not allowed to change status'; end if;
    if new.referral_code is distinct from old.referral_code then raise exception 'Not allowed to change referral_code'; end if;
    if new.id is distinct from old.id then raise exception 'Not allowed to change id'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_guard_profile_update on public.profiles;
create trigger trg_guard_profile_update before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Users may only flip is_read/read_at on their own notifications.
create or replace function public.guard_notification_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if public._is_end_user() then
    if (new.user_id, new.title, new.message, new.type, new.priority, new.status, new.scheduled_at, new.created_by)
       is distinct from (old.user_id, old.title, old.message, old.type, old.priority, old.status, old.scheduled_at, old.created_by) then
      raise exception 'Only read status can be changed';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_notification_update on public.notifications;
create trigger trg_guard_notification_update before update on public.notifications
  for each row execute function public.guard_notification_update();

-- Users may only bump updated_at on their own tickets.
create or replace function public.guard_ticket_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if public._is_end_user() then
    if (new.user_id, new.subject, new.category, new.message, new.status, new.priority)
       is distinct from (old.user_id, old.subject, old.category, old.message, old.status, old.priority) then
      raise exception 'Only an administrator can change this ticket';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_ticket_update on public.support_tickets;
create trigger trg_guard_ticket_update before update on public.support_tickets
  for each row execute function public.guard_ticket_update();

-- A reply bumps its ticket's updated_at.
create or replace function public.touch_ticket_on_reply()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.support_tickets set updated_at = now() where id = new.ticket_id;
  return new;
end $$;
drop trigger if exists trg_touch_ticket_on_reply on public.ticket_replies;
create trigger trg_touch_ticket_on_reply after insert on public.ticket_replies
  for each row execute function public.touch_ticket_on_reply();

-- Enable RLS everywhere + admin-all policy on every table
do $$
declare t text;
begin
  foreach t in array array['profiles','wallets','transactions','investments','investment_plans','deposits',
    'withdrawals','notifications','admin_logs','platform_settings','support_tickets','ticket_replies',
    'gift_codes','gift_code_redemptions','referrals','scheduler_logs','error_logs'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "admins all" on public.%I', t);
    execute format('create policy "admins all" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- Own-row read on user tables
do $$
declare t text;
begin
  foreach t in array array['wallets','transactions','investments','deposits','withdrawals','notifications',
    'support_tickets','gift_code_redemptions'] loop
    execute format('drop policy if exists "users read own" on public.%I', t);
    execute format('create policy "users read own" on public.%I for select to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;

-- profiles
drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile" on public.profiles for select to authenticated
  using (id = auth.uid());
drop policy if exists "users read own referrals profiles" on public.profiles;
create policy "users read own referrals profiles" on public.profiles for select to authenticated
  using (referral_by is not null and lower(referral_by) = lower(public.my_username()));
drop policy if exists "users update own profile" on public.profiles;
create policy "users update own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- public read: plans + settings
drop policy if exists "public read plans" on public.investment_plans;
create policy "public read plans" on public.investment_plans for select to anon, authenticated using (true);
drop policy if exists "public read settings" on public.platform_settings;
create policy "public read settings" on public.platform_settings for select to anon, authenticated using (true);

-- notifications: mark read + delete own
drop policy if exists "users update own notifications" on public.notifications;
create policy "users update own notifications" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "users delete own notifications" on public.notifications;
create policy "users delete own notifications" on public.notifications for delete to authenticated
  using (user_id = auth.uid());

-- support tickets + replies
drop policy if exists "users insert own tickets" on public.support_tickets;
create policy "users insert own tickets" on public.support_tickets for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "users update own tickets" on public.support_tickets;
create policy "users update own tickets" on public.support_tickets for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "users read replies on own tickets" on public.ticket_replies;
create policy "users read replies on own tickets" on public.ticket_replies for select to authenticated
  using (is_internal = false and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid()));
drop policy if exists "users insert replies on own tickets" on public.ticket_replies;
create policy "users insert replies on own tickets" on public.ticket_replies for insert to authenticated
  with check (sender_id = auth.uid() and is_admin = false and is_internal = false
    and exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid()));

-- gift codes: users see codes they redeemed (for the history embed)
drop policy if exists "users read redeemed codes" on public.gift_codes;
create policy "users read redeemed codes" on public.gift_codes for select to authenticated
  using (exists (select 1 from public.gift_code_redemptions r where r.gift_code_id = gift_codes.id and r.user_id = auth.uid()));

-- referrals: users see rows where they are referrer or referred
drop policy if exists "users read own referrals" on public.referrals;
create policy "users read own referrals" on public.referrals for select to authenticated
  using (referrer_id = auth.uid() or referred_id = auth.uid());

-- @@CHUNK 3: new-user trigger
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s public.platform_settings;
  v_username text := nullif(trim(new.raw_user_meta_data->>'username'), '');
  v_ref text := nullif(lower(trim(new.raw_user_meta_data->>'referral_by')), '');
  v_bonus numeric := 0;
  v_referrer uuid;
begin
  select * into s from public.platform_settings where id = 1;
  if s.enable_welcome_bonus then v_bonus := coalesce(s.welcome_bonus_amount, 0); end if;

  insert into public.profiles (id, email, full_name, username, phone, referral_code, referral_by, is_admin, status)
  values (new.id, new.email, nullif(trim(new.raw_user_meta_data->>'full_name'), ''), v_username,
          nullif(trim(new.raw_user_meta_data->>'phone'), ''), lower(v_username), v_ref,
          lower(new.email) = 'amisuelijaholuwasegun@gmail.com', 'active');

  insert into public.wallets (user_id, balance) values (new.id, v_bonus);

  if v_bonus > 0 then
    insert into public.transactions (user_id, amount, type, description, status, balance_after)
    values (new.id, v_bonus, 'bonus', 'Welcome Bonus Reward', 'success', v_bonus);
  end if;

  insert into public.notifications (user_id, title, message, type)
  values (new.id, 'Welcome to TOP!',
    case when v_bonus > 0 then 'Your account is active and ₦' || to_char(v_bonus, 'FM999,999,990') || ' has been credited to your wallet as a welcome bonus.'
         else 'Your account is active.' end, 'welcome');

  if v_ref is not null then
    select id into v_referrer from public.profiles where lower(username) = v_ref and id <> new.id limit 1;
    if v_referrer is not null then
      insert into public.referrals (referrer_id, referred_id, reward_percent, reward_status)
      values (v_referrer, new.id, s.referral_percent, 'pending')
      on conflict (referred_id) do nothing;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- @@CHUNK 4: user RPCs
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

-- @@CHUNK 5: admin RPCs
create or replace function public._admin_log(p_action text, p_target text)
returns void language sql security definer set search_path = public as $$
  insert into public.admin_logs (admin_id, admin_name, action, target_id)
  select auth.uid(), (select full_name from public.profiles where id = auth.uid()), p_action, p_target;
$$;

create or replace function public.admin_approve_deposit(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  d public.deposits;
  s public.platform_settings;
  v_new_bal numeric;
  v_ref_by text;
  v_dep_username text;
  v_referrer uuid;
  v_commission numeric := 0;
  v_ref_bal numeric;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into d from public.deposits where id = p_id for update;
  if not found then raise exception 'Deposit not found'; end if;
  if d.status <> 'pending' then raise exception 'Deposit is already %', d.status; end if;
  select * into s from public.platform_settings where id = 1;

  update public.deposits set status = 'approved', processed_by = auth.uid(), processed_at = now(), updated_at = now() where id = p_id;
  perform 1 from public.wallets where user_id = d.user_id for update;
  update public.wallets set balance = balance + d.amount, updated_at = now() where user_id = d.user_id returning balance into v_new_bal;
  if not found then raise exception 'Wallet not found'; end if;

  update public.transactions set status = 'success', balance_after = v_new_bal, description = 'Deposit Verified & Approved'
   where reference_id = p_id and type = 'deposit';
  if not found then
    insert into public.transactions (user_id, amount, type, description, status, balance_after, reference_id)
    values (d.user_id, d.amount, 'deposit', 'Deposit Verified & Approved', 'success', v_new_bal, p_id);
  end if;
  insert into public.notifications (user_id, title, message, type)
  values (d.user_id, 'Deposit Approved', 'Your deposit of ₦' || to_char(d.amount, 'FM999,999,999,990') || ' has been verified and added to your wallet.', 'deposit');

  -- referral commission
  select referral_by, username into v_ref_by, v_dep_username from public.profiles where id = d.user_id;
  if s.enable_referrals and v_ref_by is not null then
    select id into v_referrer from public.profiles where lower(username) = lower(v_ref_by) and id <> d.user_id limit 1;
    if v_referrer is not null then
      v_commission := round(d.amount * coalesce(s.referral_percent, 20) / 100, 2);
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

  perform public._admin_log('Approved Deposit #' || p_id, p_id::text);
  return json_build_object('id', p_id, 'status', 'approved', 'balance', v_new_bal, 'referral_commission', v_commission);
end $$;

create or replace function public.admin_reject_deposit(p_id uuid, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare d public.deposits;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into d from public.deposits where id = p_id for update;
  if not found then raise exception 'Deposit not found'; end if;
  if d.status <> 'pending' then raise exception 'Deposit is already %', d.status; end if;
  update public.deposits set status = 'rejected', rejection_reason = p_reason, processed_by = auth.uid(), processed_at = now(), updated_at = now() where id = p_id;
  update public.transactions set status = 'failed', description = 'Deposit Rejected: ' || coalesce(p_reason, '') where reference_id = p_id and type = 'deposit';
  insert into public.notifications (user_id, title, message, type)
  values (d.user_id, 'Deposit Rejected', 'Your deposit of ₦' || to_char(d.amount, 'FM999,999,999,990') || ' was rejected. Reason: ' || coalesce(p_reason, 'not specified'), 'deposit');
  perform public._admin_log('Rejected Deposit #' || p_id || coalesce('. Reason: ' || p_reason, ''), p_id::text);
  return json_build_object('id', p_id, 'status', 'rejected');
end $$;

create or replace function public.admin_approve_withdrawal(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  w public.withdrawals;
  v_bal numeric;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'Withdrawal not found'; end if;
  if w.status <> 'pending' then raise exception 'Withdrawal is already %', w.status; end if;
  select balance into v_bal from public.wallets where user_id = w.user_id for update;
  if v_bal is null then raise exception 'Wallet not found'; end if;
  if v_bal < w.amount then raise exception 'Insufficient balance: user has ₦% but the withdrawal is ₦%', v_bal, w.amount; end if;

  update public.wallets set balance = balance - w.amount, updated_at = now() where user_id = w.user_id returning balance into v_bal;
  update public.withdrawals set status = 'approved', processed_by = auth.uid(), processed_at = now() where id = p_id;
  update public.transactions set status = 'success', balance_after = v_bal where reference_id = p_id and type = 'withdrawal';
  if not found then
    insert into public.transactions (user_id, amount, type, description, status, balance_after, reference_id)
    values (w.user_id, w.amount, 'withdrawal', 'Withdrawal Approved & Paid', 'success', v_bal, p_id);
  end if;
  insert into public.notifications (user_id, title, message, type)
  values (w.user_id, 'Withdrawal Approved', 'Your withdrawal of ₦' || to_char(w.amount, 'FM999,999,999,990') ||
    ' was approved. ₦' || to_char(coalesce(w.net_amount, w.amount), 'FM999,999,999,990.00') || ' has been sent to your bank account.', 'withdrawal');
  perform public._admin_log('Approved Withdrawal #' || p_id, p_id::text);
  return json_build_object('id', p_id, 'status', 'approved', 'balance', v_bal);
end $$;

create or replace function public.admin_reject_withdrawal(p_id uuid, p_reason text)
returns json language plpgsql security definer set search_path = public as $$
declare w public.withdrawals;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into w from public.withdrawals where id = p_id for update;
  if not found then raise exception 'Withdrawal not found'; end if;
  if w.status <> 'pending' then raise exception 'Withdrawal is already %', w.status; end if;
  update public.withdrawals set status = 'rejected', rejection_reason = p_reason, processed_by = auth.uid(), processed_at = now() where id = p_id;
  update public.transactions set status = 'failed', description = 'Withdrawal Rejected: ' || coalesce(p_reason, '') where reference_id = p_id and type = 'withdrawal';
  insert into public.notifications (user_id, title, message, type)
  values (w.user_id, 'Withdrawal Rejected', 'Your withdrawal request of ₦' || to_char(w.amount, 'FM999,999,999,990') || ' was rejected. Reason: ' || coalesce(p_reason, 'not specified'), 'withdrawal');
  perform public._admin_log('Rejected Withdrawal #' || p_id || coalesce('. Reason: ' || p_reason, ''), p_id::text);
  return json_build_object('id', p_id, 'status', 'rejected');
end $$;

-- p_amount > 0 credits, p_amount < 0 deducts (never below zero).
create or replace function public.admin_adjust_balance(p_user_id uuid, p_amount numeric, p_note text)
returns json language plpgsql security definer set search_path = public as $$
declare v_bal numeric;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'Amount must be non-zero'; end if;
  select balance into v_bal from public.wallets where user_id = p_user_id for update;
  if v_bal is null then raise exception 'Wallet not found'; end if;
  if v_bal + p_amount < 0 then raise exception 'Insufficient balance: user has ₦%', v_bal; end if;
  update public.wallets set balance = balance + p_amount, updated_at = now() where user_id = p_user_id returning balance into v_bal;
  insert into public.transactions (user_id, amount, type, description, status, balance_after)
  values (p_user_id, abs(p_amount), case when p_amount > 0 then 'bonus' else 'adjustment' end,
    coalesce(nullif(trim(p_note), ''), case when p_amount > 0 then 'Balance credited by admin' else 'Balance deducted by admin' end), 'success', v_bal);
  insert into public.notifications (user_id, title, message, type)
  values (p_user_id, case when p_amount > 0 then 'Balance Credited' else 'Balance Adjusted' end,
    '₦' || to_char(abs(p_amount), 'FM999,999,999,990') || case when p_amount > 0 then ' was added to your wallet by admin.' else ' was deducted from your wallet by admin.' end
    || coalesce(' Reason: ' || nullif(trim(p_note), ''), ''), 'system');
  perform public._admin_log((case when p_amount > 0 then 'Added ₦' else 'Deducted ₦' end) || abs(p_amount) || ' for user #' || left(p_user_id::text, 8) || coalesce(' — ' || nullif(trim(p_note), ''), ''), p_user_id::text);
  return json_build_object('user_id', p_user_id, 'balance', v_bal);
end $$;

-- Activates a plan for a user without charging their wallet. p_amount defaults to the plan's min_amount.
create or replace function public.admin_assign_plan(p_user_id uuid, p_plan_id uuid, p_amount numeric default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_plan public.investment_plans;
  v_amount numeric;
  v_daily numeric;
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'User not found'; end if;
  select * into v_plan from public.investment_plans where id = p_plan_id;
  if not found then raise exception 'Investment plan not found'; end if;
  v_amount := coalesce(p_amount, v_plan.min_amount, v_plan.price);
  if v_amount is null or v_amount <= 0 then raise exception 'Enter a valid amount'; end if;
  v_daily := round(v_amount * v_plan.daily_profit_percent / 100, 2);

  insert into public.investments (user_id, plan_id, plan_name, amount, daily_profit, daily_rate, profit_percent,
    duration, expected_return, start_date, end_date, status)
  values (p_user_id, v_plan.id, v_plan.name, v_amount, v_daily, v_plan.daily_profit_percent, v_plan.daily_profit_percent,
    v_plan.duration_days, v_daily * v_plan.duration_days, now(), now() + make_interval(days => v_plan.duration_days), 'active')
  returning id into v_id;
  insert into public.transactions (user_id, investment_id, amount, type, description, status)
  values (p_user_id, v_id, v_amount, 'investment', 'Admin-assigned investment: ' || v_plan.name, 'success');
  insert into public.notifications (user_id, title, message, type)
  values (p_user_id, 'Investment Plan Assigned', 'An administrator has activated the "' || v_plan.name || '" plan (₦' || to_char(v_amount, 'FM999,999,999,990') || ') on your account.', 'investment');
  perform public._admin_log('Assigned plan "' || v_plan.name || '" (₦' || v_amount || ') to user #' || left(p_user_id::text, 8), p_user_id::text);
  return json_build_object('investment_id', v_id, 'amount', v_amount, 'daily_profit', v_daily);
end $$;

-- @@CHUNK 6: daily earnings + cron + grants
create or replace function public.process_daily_earnings()
returns json language plpgsql security definer set search_path = public as $$
declare
  inv record;
  v_profit numeric;
  v_bal numeric;
  v_processed int := 0;
  v_completed int := 0;
  v_failed int := 0;
  v_total numeric := 0;
  v_enabled boolean;
begin
  select coalesce(enable_earnings, true) into v_enabled from public.platform_settings where id = 1;
  if v_enabled is false then
    insert into public.scheduler_logs (run_date, status, details) values (current_date, 'skipped', 'enable_earnings is off');
    return json_build_object('status', 'skipped');
  end if;

  for inv in
    select i.* from public.investments i join public.profiles p on p.id = i.user_id
     where i.status = 'active' and p.status = 'active'
  loop
    begin
      if inv.end_date is not null and inv.end_date <= now() then
        update public.investments set status = 'completed' where id = inv.id;
        insert into public.notifications (user_id, title, message, type)
        values (inv.user_id, 'Investment Completed', 'Your ' || coalesce(inv.plan_name, 'investment') || ' has reached its end date and is now completed.', 'investment');
        v_completed := v_completed + 1;
        continue;
      end if;
      -- already credited today (UTC)?
      if inv.last_earning_at is not null and (inv.last_earning_at at time zone 'UTC')::date >= (now() at time zone 'UTC')::date then
        continue;
      end if;
      v_profit := coalesce(inv.daily_profit, round(inv.amount * coalesce(inv.daily_rate, inv.profit_percent, 0) / 100, 2));
      if v_profit is null or v_profit <= 0 then continue; end if;

      update public.wallets set balance = balance + v_profit, updated_at = now() where user_id = inv.user_id returning balance into v_bal;
      if not found then raise exception 'wallet missing'; end if;
      insert into public.transactions (user_id, investment_id, amount, type, description, status, balance_after)
      values (inv.user_id, inv.id, v_profit, 'earning', 'Daily profit: ' || coalesce(inv.plan_name, 'investment'), 'success', v_bal);
      update public.investments set total_earned = total_earned + v_profit, last_earning_at = now() where id = inv.id;
      insert into public.notifications (user_id, title, message, type)
      values (inv.user_id, 'Daily Earnings Credited', '₦' || to_char(v_profit, 'FM999,999,990.00') || ' profit from your ' || coalesce(inv.plan_name, 'investment') || ' was added to your wallet.', 'earning');
      v_processed := v_processed + 1;
      v_total := v_total + v_profit;
    exception when others then
      v_failed := v_failed + 1;
      insert into public.error_logs (module, reference_id, error_message) values ('earnings', inv.id::text, sqlerrm);
    end;
  end loop;

  insert into public.scheduler_logs (run_date, status, processed_count, failed_count, total_amount, details)
  values (current_date, case when v_failed = 0 then 'success' else 'partial_success' end, v_processed, v_failed, v_total,
          v_completed || ' investment(s) completed');
  return json_build_object('processed', v_processed, 'completed', v_completed, 'failed', v_failed, 'total', v_total);
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'process-daily-earnings') then
    perform cron.unschedule('process-daily-earnings');
  end if;
  perform cron.schedule('process-daily-earnings', '0 0 * * *', 'select public.process_daily_earnings()');
end $$;

-- Function privileges: user/admin RPCs callable by signed-in users; internal ones service-only.
revoke execute on function public.process_daily_earnings() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public._admin_log(text, text) from public, anon, authenticated;

revoke execute on function public.create_investment(uuid, numeric) from public, anon;
revoke execute on function public.redeem_gift_code(text) from public, anon;
revoke execute on function public.create_deposit(numeric, text, text, text, text, text) from public, anon;
revoke execute on function public.request_withdrawal(numeric, text, text, text) from public, anon;
revoke execute on function public.admin_approve_deposit(uuid) from public, anon;
revoke execute on function public.admin_reject_deposit(uuid, text) from public, anon;
revoke execute on function public.admin_approve_withdrawal(uuid) from public, anon;
revoke execute on function public.admin_reject_withdrawal(uuid, text) from public, anon;
revoke execute on function public.admin_adjust_balance(uuid, numeric, text) from public, anon;
revoke execute on function public.admin_assign_plan(uuid, uuid, numeric) from public, anon;

grant execute on function public.create_investment(uuid, numeric) to authenticated;
grant execute on function public.redeem_gift_code(text) to authenticated;
grant execute on function public.create_deposit(numeric, text, text, text, text, text) to authenticated;
grant execute on function public.request_withdrawal(numeric, text, text, text) to authenticated;
grant execute on function public.admin_approve_deposit(uuid) to authenticated;
grant execute on function public.admin_reject_deposit(uuid, text) to authenticated;
grant execute on function public.admin_approve_withdrawal(uuid) to authenticated;
grant execute on function public.admin_reject_withdrawal(uuid, text) to authenticated;
grant execute on function public.admin_adjust_balance(uuid, numeric, text) to authenticated;
grant execute on function public.admin_assign_plan(uuid, uuid, numeric) to authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.username_available(text) to anon, authenticated;

-- @@CHUNK 7: storage
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true)
  on conflict (id) do update set public = true;
insert into storage.buckets (id, name, public) values ('public', 'public', true)
  on conflict (id) do update set public = true;

drop policy if exists "top public read" on storage.objects;
create policy "top public read" on storage.objects for select to anon, authenticated
  using (bucket_id in ('avatars', 'public'));
drop policy if exists "top users insert own folder" on storage.objects;
create policy "top users insert own folder" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars', 'public') and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "top users update own folder" on storage.objects;
create policy "top users update own folder" on storage.objects for update to authenticated
  using (bucket_id in ('avatars', 'public') and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id in ('avatars', 'public') and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "top users delete own folder" on storage.objects;
create policy "top users delete own folder" on storage.objects for delete to authenticated
  using (bucket_id in ('avatars', 'public') and (storage.foldername(name))[1] = auth.uid()::text);
-- Let an admin grant or remove admin access from the Admin > Users page.
create or replace function public.admin_set_admin(p_user_id uuid, p_make_admin boolean)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_user_id = auth.uid() and not p_make_admin then
    raise exception 'You cannot remove your own admin access';
  end if;
  update public.profiles set is_admin = p_make_admin where id = p_user_id returning full_name into v_name;
  if not found then raise exception 'User not found'; end if;
  perform public._admin_log(
    case when p_make_admin then 'Granted admin access' else 'Removed admin access' end,
    coalesce(v_name, p_user_id::text));
  insert into public.notifications (user_id, title, message, type)
  values (p_user_id,
    case when p_make_admin then 'Admin Access Granted' else 'Admin Access Removed' end,
    case when p_make_admin then 'You now have administrator access to the TOP admin panel.'
         else 'Your administrator access to the TOP admin panel has been removed.' end,
    'system');
  return json_build_object('user_id', p_user_id, 'is_admin', p_make_admin);
end $$;
revoke execute on function public.admin_set_admin(uuid, boolean) from public, anon;
grant execute on function public.admin_set_admin(uuid, boolean) to authenticated;
