-- ============================================================
-- DECKS AND PLAYERS — paste once into the Supabase SQL editor
-- (same ritual as garage_cards and the online table). One row
-- per deck and per player profile, own rows only: the app keeps
-- them in step across devices, last write wins per row. `data`
-- is the deck or the profile as JSON; a deleted one stays as a
-- row with deleted = true so the other devices hear of it.
--
-- Safe to run twice. Supabase warns about a destructive query
-- because of the "drop policy" lines — that is expected, run it.
--
-- The app shows this same text under Settings → Cloud sync while
-- the tables are missing (DECKS_PLAYERS_SQL in src/data/cloud.ts);
-- a test keeps the two word for word alike.
-- ============================================================

create table if not exists decks (
  user_id uuid not null default auth.uid(),
  deck_id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, deck_id)
);
alter table decks enable row level security;
drop policy if exists "own rows" on decks;
create policy "own rows" on decks for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists player_profiles (
  user_id uuid not null default auth.uid(),
  profile_id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, profile_id)
);
alter table player_profiles enable row level security;
drop policy if exists "own rows" on player_profiles;
create policy "own rows" on player_profiles for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
