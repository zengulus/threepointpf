-- A character's authored state is one canonical JSON document.  This lets a
-- save atomically retain newly-added authored fields (custom progressions,
-- equipment, movement, size, and future declarative content) without adding
-- a column/table every time the sheet gains an input.  Existing normalized
-- columns and child tables stay readable as a legacy fallback.
alter table public.characters
  add column if not exists authored_state jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'characters_authored_state_object'
  ) then
    alter table public.characters add constraint characters_authored_state_object
      check (authored_state is null or jsonb_typeof(authored_state) = 'object');
  end if;
end
$$;

comment on column public.characters.authored_state is
  'Canonical CharacterInput snapshot. When present it is authoritative; legacy columns/child rows are load fallback only.';
