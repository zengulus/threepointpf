create extension if not exists "pgcrypto";

create table if not exists campaigns (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists characters (
  id text primary key,
  campaign_id text not null references campaigns(id) on delete cascade,
  name text not null,
  base_abilities jsonb not null,
  base_bab integer not null,
  base_saves jsonb not null,
  base_hp integer not null,
  skill_ranks jsonb not null default '{}'::jsonb,
  skill_configuration jsonb not null default '{}'::jsonb,
  current_hp integer not null,
  base_land_speed integer not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists character_features (
  character_id text not null references characters(id) on delete cascade,
  id text not null,
  definition_id text,
  name text not null,
  description text,
  enabled boolean not null default true,
  effects jsonb not null default '[]'::jsonb,
  primary key (character_id, id)
);

create table if not exists character_attacks (
  character_id text not null references characters(id) on delete cascade,
  id text not null,
  definition jsonb not null,
  primary key (character_id, id)
);

create table if not exists roll_history (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null references campaigns(id) on delete cascade,
  character_id text not null references characters(id) on delete cascade,
  roll_plan jsonb not null,
  faces jsonb not null,
  resolved jsonb not null,
  created_at timestamptz not null default now()
);

alter table campaigns enable row level security;
alter table characters enable row level security;
alter table character_features enable row level security;
alter table character_attacks enable row level security;
alter table roll_history enable row level security;

-- v0 keeps the policy surface deliberately small. Replace these with campaign membership
-- policies when campaign membership is introduced; no service-role key is used by clients.
create policy "authenticated campaign access" on campaigns for all to authenticated using (true) with check (true);
create policy "authenticated character access" on characters for all to authenticated using (true) with check (true);
create policy "authenticated feature access" on character_features for all to authenticated using (true) with check (true);
create policy "authenticated attack access" on character_attacks for all to authenticated using (true) with check (true);
create policy "authenticated roll history access" on roll_history for all to authenticated using (true) with check (true);
