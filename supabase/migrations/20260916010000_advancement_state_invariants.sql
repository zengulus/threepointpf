-- Advancement state is authored JSON, while BAB/saves/HD are derived from it.
-- Keep database rows unambiguous even if a non-TypeScript client writes them.
-- Earlier advancement rows could retain ignored legacy values; advancement
-- always won at evaluation time, so canonicalizing them to NULL is lossless.
update public.characters
set base_bab = null,
    base_saves = null,
    hit_dice_count = null
where jsonb_typeof(advancement_slots) = 'array'
  and case when jsonb_typeof(advancement_slots) = 'array' then jsonb_array_length(advancement_slots) > 0 else false end;

-- A default of 1 would silently create an illegal manual HD baseline for a
-- direct advancement-mode insert that correctly omits hit_dice_count.
alter table public.characters alter column hit_dice_count drop default;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'characters_advancement_slots_array') then
    alter table public.characters add constraint characters_advancement_slots_array
      check (jsonb_typeof(advancement_slots) = 'array');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'characters_advancement_mode_baselines') then
    alter table public.characters add constraint characters_advancement_mode_baselines
      check (case when jsonb_typeof(advancement_slots) = 'array'
        then case when jsonb_array_length(advancement_slots) = 0
          then (base_bab is not null and base_saves is not null and hit_dice_count is not null)
          else (base_bab is null and base_saves is null and hit_dice_count is null)
        end
        else false end);
  end if;
end
$$;
