-- Advancement mode supplies BAB, saves, and hit-die count. Legacy manual
-- baselines remain available, but must be nullable for advancement characters.
alter table public.characters add column if not exists advancement_slots jsonb not null default '[]'::jsonb;
alter table public.characters alter column base_bab drop not null;
alter table public.characters alter column base_saves drop not null;
alter table public.characters alter column hit_dice_count drop not null;
