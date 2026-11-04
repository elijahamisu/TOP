-- Promoter tag: set by admins, shown on the user's cards and in their own app.
alter table public.profiles add column if not exists is_promoter boolean not null default false;

create or replace function public.guard_profile_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if public._is_end_user() then
    if new.is_admin is distinct from old.is_admin then raise exception 'Not allowed to change is_admin'; end if;
    if new.is_promoter is distinct from old.is_promoter then raise exception 'Not allowed to change is_promoter'; end if;
    if new.email is distinct from old.email then raise exception 'Not allowed to change email'; end if;
    if new.referral_by is distinct from old.referral_by then raise exception 'Not allowed to change referral_by'; end if;
    if new.status is distinct from old.status then raise exception 'Not allowed to change status'; end if;
    if new.referral_code is distinct from old.referral_code then raise exception 'Not allowed to change referral_code'; end if;
    if new.id is distinct from old.id then raise exception 'Not allowed to change id'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.admin_set_promoter(p_user_id uuid, p_is_promoter boolean)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  update public.profiles set is_promoter = p_is_promoter where id = p_user_id returning full_name into v_name;
  if not found then raise exception 'User not found'; end if;
  perform public._admin_log(
    case when p_is_promoter then 'Tagged as promoter' else 'Removed promoter tag' end,
    coalesce(v_name, p_user_id::text));
  insert into public.notifications (user_id, title, message, type)
  values (p_user_id,
    case when p_is_promoter then 'You are now a TOP Promoter' else 'Promoter Tag Removed' end,
    case when p_is_promoter then 'Congratulations! Your account has been tagged as an official TOP Promoter.'
         else 'Your TOP Promoter tag has been removed from your account.' end,
    'system');
  return json_build_object('user_id', p_user_id, 'is_promoter', p_is_promoter);
end $$;
revoke execute on function public.admin_set_promoter(uuid, boolean) from public, anon;
grant execute on function public.admin_set_promoter(uuid, boolean) to authenticated;
