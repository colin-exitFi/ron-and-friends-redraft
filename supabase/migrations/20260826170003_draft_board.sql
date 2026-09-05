-- Ultimate Keeper League — the draft board, and the pick-ownership ledger
-- behind it.
--
-- Two tables, because a pick is two different things to this league:
--
--   pick_ownership  the ASSET. One row per (season, round, original franchise),
--                   carrying who holds it now. Exists for seasons that have no
--                   board yet, which is what makes a 2027 pick tradable today.
--
--   draft_slots     the BOARD CELL. One row per physical square on the 160-slot
--                   grid, with its grid coordinates, the player in it, and
--                   whether that player is a keeper.
--
-- Both record ORIGINAL versus CURRENT ownership. Traded picks are central to
-- how this league operates and the board's first job on draft night is to show
-- who actually owns each slot, so "who did this pick start with" and "who holds
-- it now" are separate columns everywhere, never one mutable owner.

-- ---------------------------------------------------------------------------
-- Shape validation
-- ---------------------------------------------------------------------------
-- Rounds, columns and overall pick numbers are bounded by the season's own
-- `leagues` row rather than by literals, so the 16 rounds / 10 teams / 160
-- slots of 2026 are enforced without being frozen into a CHECK that a future
-- rules change would have to migrate around.

create function public.assert_round_within_league_shape()
returns trigger
language plpgsql
as $$
declare
  rounds int;
begin
  select draft_rounds into rounds from public.leagues where season = new.season;

  -- A 2027 pick is tradable long before there is a 2027 season row, so an
  -- unknown season is allowed through rather than blocked.
  if rounds is null then
    return new;
  end if;

  if new.round > rounds then
    raise exception 'Round % is beyond the %-round draft for %.',
      new.round, rounds, new.season;
  end if;

  return new;
end;
$$;

create function public.assert_slot_within_league_shape()
returns trigger
language plpgsql
as $$
declare
  teams int;
  rounds int;
  slots int;
begin
  select team_count, draft_rounds, total_slots
    into teams, rounds, slots
  from public.leagues
  where season = new.season;

  if teams is null then
    raise exception 'No leagues row for season % — seed the season first.', new.season;
  end if;

  if new.round > rounds then
    raise exception 'Round % is beyond the %-round draft for %.',
      new.round, rounds, new.season;
  end if;

  if new.pick_in_round > teams then
    raise exception 'Pick % in round % is beyond the %-team draft order.',
      new.pick_in_round, new.round, teams;
  end if;

  if new.overall_pick > slots then
    raise exception 'Overall pick % is beyond the %-slot board.',
      new.overall_pick, slots;
  end if;

  -- `pick_in_round` is the position within the round in PICK order, so the
  -- overall number is fully determined by it whether the round runs forward or,
  -- on a snake round, backward. A mismatch means the board was built from a bad
  -- snapshot and would print wrong on draft night.
  if new.overall_pick <> (new.round - 1) * teams + new.pick_in_round then
    raise exception
      'Overall pick % does not match round %, pick % on a %-team board.',
      new.overall_pick, new.round, new.pick_in_round, teams;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- pick_ownership
-- ---------------------------------------------------------------------------
create table public.pick_ownership (
  id uuid primary key default gen_random_uuid(),
  season int not null,
  round int not null check (round >= 1),

  -- The franchise the pick was born to. Immutable: it is the pick's identity,
  -- and it is the board column the pick appears in no matter who ends up
  -- holding it.
  original_team uuid not null references public.teams (id) on delete cascade,

  -- Who holds it now. Equal to original_team for an untraded pick.
  current_team uuid not null references public.teams (id) on delete cascade,

  updated_at timestamptz not null default now(),
  unique (season, round, original_team)
);

create index pick_ownership_current_idx on public.pick_ownership (season, current_team);

-- Deliberately not FK-constrained to `leagues`: a 2027 pick is tradable long
-- before there is a 2027 season row. The trigger bounds the round when the
-- season is known and waves it through when it is not.
create trigger pick_ownership_shape
  before insert or update on public.pick_ownership
  for each row execute function public.assert_round_within_league_shape();

-- ---------------------------------------------------------------------------
-- traded_picks
-- ---------------------------------------------------------------------------
-- Append-only log of pick movements, so the board can explain itself. The
-- Johnston/Blome deal nets to "Greg keeps his own R1, Scott holds Greg's R3,
-- Scott keeps his own R15, Greg holds Scott's R16" across two trades, and
-- without the log that net position looks like a half-applied trade.
create table public.traded_picks (
  id uuid primary key default gen_random_uuid(),
  season int not null,
  round int not null check (round >= 1),
  original_team uuid not null references public.teams (id) on delete cascade,
  from_team uuid references public.teams (id) on delete set null,
  current_team uuid not null references public.teams (id) on delete cascade,
  trade_id uuid,
  created_at timestamptz not null default now()
);

create index traded_picks_season_idx on public.traded_picks (season, round);

-- ---------------------------------------------------------------------------
-- draft_slots
-- ---------------------------------------------------------------------------
create table public.draft_slots (
  id uuid primary key default gen_random_uuid(),
  season int not null references public.leagues (season) on delete cascade,
  round int not null check (round >= 1),

  -- Position within the round in pick order, 1-based.
  pick_in_round int not null check (pick_in_round >= 1),
  overall_pick int not null check (overall_pick >= 1),

  original_team_id uuid not null references public.teams (id) on delete cascade,
  current_team_id uuid not null references public.teams (id) on delete cascade,

  player_id text references public.players (player_id) on delete set null,

  -- A keeper occupies a real board slot at his cost round rather than sitting
  -- beside the board, which is why keepers and drafted players share a table.
  is_keeper boolean not null default false,

  -- Smart Draft's own slot key, so re-seeding from a newer room snapshot
  -- updates rows instead of duplicating them.
  smartdraft_slot_key uuid,

  updated_at timestamptz not null default now(),

  unique (season, overall_pick),

  -- THE GRID INVARIANT. The board draws one cell per (round, column), and the
  -- column is the ORIGINAL owner's — a franchise keeps its column all 16
  -- rounds and a traded pick shows up as a foreign name inside someone else's
  -- column. Two picks claiming one cell would silently hide one of them, so the
  -- database refuses it rather than letting the room draft off a board with a
  -- missing pick.
  unique (season, round, original_team_id)
);

create unique index draft_slots_smartdraft_key_unique
  on public.draft_slots (season, smartdraft_slot_key)
  where smartdraft_slot_key is not null;

-- Nobody can be taken twice in one draft.
create unique index draft_slots_player_unique
  on public.draft_slots (season, player_id)
  where player_id is not null;

create index draft_slots_current_team_idx on public.draft_slots (season, current_team_id);
create index draft_slots_keeper_idx on public.draft_slots (season) where is_keeper;

create trigger draft_slots_shape
  before insert or update on public.draft_slots
  for each row execute function public.assert_slot_within_league_shape();

-- ---------------------------------------------------------------------------
-- draft_state
-- ---------------------------------------------------------------------------
-- The draft is offline. `clock_seconds` is what the room is shown, not a timer
-- the server enforces: nothing auto-advances and nothing auto-picks.
create table public.draft_state (
  season int primary key references public.leagues (season) on delete cascade,
  status draft_status not null default 'not_started',
  current_overall_pick int check (current_overall_pick >= 1),
  clock_seconds int not null default 120,
  clock_started_at timestamptz,
  paused_at timestamptz,
  updated_at timestamptz not null default now()
);
