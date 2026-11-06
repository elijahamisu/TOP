-- Lower the withdrawal charge from 15% to 10%.
alter table public.platform_settings alter column withdrawal_fee_percent set default 10;
update public.platform_settings set withdrawal_fee_percent = 10;
