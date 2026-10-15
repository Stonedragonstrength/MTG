-- The history of finished games, synced like decks and players.
-- Paste into the Supabase SQL editor and press Run (once is enough; running
-- it again is safe — Supabase warns about the drop-policy line, expected).
create table if not exists game_records (
  user_id uuid not null default auth.uid(),
  game_id text not null,
  data jsonb not null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);
alter table game_records enable row level security;
drop policy if exists "own rows" on game_records;
create policy "own rows" on game_records for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
