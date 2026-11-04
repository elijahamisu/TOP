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
