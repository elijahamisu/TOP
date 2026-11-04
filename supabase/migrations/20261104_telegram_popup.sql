-- Dashboard Telegram popup (editable in Admin > Settings)
alter table public.platform_settings
  add column if not exists telegram_popup_enabled boolean not null default true,
  add column if not exists telegram_popup_title text default 'Join Our Community',
  add column if not exists telegram_popup_message text default 'Join our Telegram community for investment updates, announcements, and 24/7 support.',
  add column if not exists telegram_channel_link text default 'https://t.me/monvexachannel',
  add column if not exists telegram_group_button text default 'Join Telegram Group',
  add column if not exists telegram_channel_button text default 'Join Telegram Channel';
update public.platform_settings
   set telegram_link = coalesce(nullif(trim(telegram_link), ''), 'https://t.me/+jBbRS6HqIjM2YmM8')
 where id = 1;
