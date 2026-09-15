-- Make Constitution-per-hit-die and mutable HP state explicit. This migration
-- converts the v0 absolute current_hp field before removing it.
alter table public.characters add column if not exists hit_dice_count integer;
alter table public.characters add column if not exists damage_taken integer;
alter table public.characters add column if not exists temporary_hp integer;

update public.characters
set
  hit_dice_count = coalesce(hit_dice_count, 1),
  damage_taken = coalesce(damage_taken, greatest(base_hp_before_con - current_hp, 0)),
  temporary_hp = coalesce(temporary_hp, 0);

alter table public.characters alter column hit_dice_count set default 1;
alter table public.characters alter column damage_taken set default 0;
alter table public.characters alter column temporary_hp set default 0;
alter table public.characters alter column hit_dice_count set not null;
alter table public.characters alter column damage_taken set not null;
alter table public.characters alter column temporary_hp set not null;
alter table public.characters add constraint characters_hit_dice_count_positive check (hit_dice_count > 0);
alter table public.characters add constraint characters_damage_taken_nonnegative check (damage_taken >= 0);
alter table public.characters add constraint characters_temporary_hp_nonnegative check (temporary_hp >= 0);

alter table public.characters drop column if exists current_hp;

-- Rename persisted legacy baseline effects. The engine no longer accepts the
-- ambiguous "set" name because these effects replace intrinsic baselines.
update public.character_features as feature
set effects = (
  select coalesce(jsonb_agg(
    case
      when item.effect->>'kind' = 'set'
        then (item.effect - 'kind') || jsonb_build_object('kind', 'replaceBase')
      else item.effect
    end order by item.ordinal
  ), '[]'::jsonb)
  from jsonb_array_elements(feature.effects) with ordinality as item(effect, ordinal)
)
where exists (
  select 1
  from jsonb_array_elements(feature.effects) as item(effect)
  where item.effect->>'kind' = 'set'
);
