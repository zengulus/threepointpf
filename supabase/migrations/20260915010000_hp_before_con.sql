do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'characters'
      and column_name = 'base_hp'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'characters'
      and column_name = 'base_hp_before_con'
  ) then
    alter table public.characters rename column base_hp to base_hp_before_con;
  end if;
end $$;
