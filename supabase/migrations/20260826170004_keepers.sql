-- Ultimate Keeper League — keepers and the keeper-rights ledger.
--
-- ===========================================================================
-- TWO WAYS OF COUNTING THE CLOCK. DO NOT CONFLATE THEM.
-- ===========================================================================
-- This is the single most dangerous thing in the schema to get wrong, and it is
-- why the two conventions get two differently named columns instead of one
-- ambiguous `keeper_year`.
--
--   sheet_tenure_year  The league's spreadsheets write the clock as "N of 3",
--                      where N counts EVERY season the franchise has held the
--                      player, INCLUDING the season he was acquired. So
--                      "1 of 3" is the draft or pickup season and not a keeper
--                      season at all, "2 of 3" is his first keeper season, and
--                      "3 of 3" is his second and last. This column always
--                      means the "N of 3" for the season the row is FOR — the
--                      season being ENTERED, i.e. the sheets' `status2026`
--                      column on a 2026 row, never `status2025`.
--
--   seasons_kept       What `src/lib/keeper-clock.ts` counts: keeper seasons
--                      ALREADY SERVED, EXCLUDING the acquisition season. This
--                      is why `leagues.max_keeper_seasons` is 2 and not 3.
--
-- The mapping is `seasons_kept = greatest(0, sheet_tenure_year - 2)`, and the
-- CHECK constraint below enforces it so the two can never drift. Reading a "3"
-- off a sheet straight into `seasons_kept` would mark this year's five final
-- season keepers as already expired and quietly print a wrong draft board:
-- Garrett Wilson, Jaxon Smith-Njigba, Brock Bowers, Chase Brown and Trey
-- McBride would all silently fall off.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- keepers
-- ---------------------------------------------------------------------------
-- One row per declared keeper per season. Two per franchise, automatically
-- redrafted from the previous year's roster.
create table public.keepers (
  id uuid primary key default gen_random_uuid(),
  season int not null references public.leagues (season) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id text not null references public.players (player_id) on delete cascade,

  -- The round this keeper occupies on the board this season. One round lower
  -- than the round he occupied last season.
  cost_round int not null check (cost_round >= 1),

  -- The round he occupied LAST season — his draft round if he was drafted, or
  -- the cost round he was held at if he was kept. NOT his original draft round:
  -- a trade moves this price to the new franchise untouched, so the original
  -- round stops being a usable basis the moment a player changes hands.
  basis_round int check (basis_round >= 1),

  -- A free-agent acquisition has no round to his name and prices at
  -- `leagues.undrafted_cost_round` (9) in his first keeper season instead.
  is_undrafted boolean not null default false,

  -- See the counting note at the top of this file. Both columns, both named
  -- for their convention, with the mapping enforced below.
  sheet_tenure_year int check (sheet_tenure_year >= 1),
  seasons_kept int not null default 0 check (seasons_kept >= 0),

  -- A trade restarts keeper eligibility with the new team while the player
  -- retains his previous season's draft-round value. Clock resets, cost basis
  -- carries. Puka Nacua is the live 2026 case: Scott holds him at R11 with a
  -- fresh clock, which under the rule as written runs through 2028.
  acquired_by_trade boolean not null default false,
  clock_reset_by_trade boolean not null default false,

  status keeper_status not null default 'declared',

  -- Provenance, because the 2026 list was assembled from three disagreeing
  -- sources: 'smartdraft' (the live room), 'spreadsheet' (the KEEPER LIST
  -- sheets), 'commissioner' (a ruling in data/DECISIONS.md).
  source text,
  notes text,

  declared_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A franchise cannot declare the same player twice, and two franchises
  -- cannot both claim him.
  unique (season, player_id),

  -- THE OFF-BY-ONE GUARD. `2 of 3` on a 2026 sheet means no keeper seasons
  -- served yet; `3 of 3` means one served and this is the last.
  constraint keepers_clock_conventions_agree check (
    sheet_tenure_year is null
    or seasons_kept = greatest(0, sheet_tenure_year - 2)
  ),

  -- An undrafted player has no round to his name, so he cannot carry a basis.
  constraint keepers_undrafted_has_no_basis check (
    not is_undrafted or basis_round is null
  ),

  -- The clock only resets because of a trade.
  constraint keepers_clock_reset_implies_trade check (
    not clock_reset_by_trade or acquired_by_trade
  )
);

create index keepers_season_team_idx on public.keepers (season, team_id);

comment on column public.keepers.sheet_tenure_year is
  'The keeper sheets'' "N of 3" for the season this row is FOR, counting the acquisition season as year 1. NOT the same as seasons_kept — see the header comment in this migration.';

comment on column public.keepers.seasons_kept is
  'Keeper seasons ALREADY SERVED entering this season, excluding the acquisition season. The convention src/lib/keeper-clock.ts uses. Two is the maximum.';

-- A franchise may declare at most `leagues.keepers_per_team` keepers. Enforced
-- in a trigger rather than a CHECK because it is a per-franchise count, and
-- read off the season's own config rather than hardcoded to 2.
create function public.assert_keeper_count_within_limit()
returns trigger
language plpgsql
as $$
declare
  limit_per_team int;
  held int;
begin
  select keepers_per_team into limit_per_team
  from public.leagues where season = new.season;

  if limit_per_team is null then
    raise exception 'No leagues row for season % — seed the season first.', new.season;
  end if;

  select count(*) into held
  from public.keepers
  where season = new.season
    and team_id = new.team_id
    and status <> 'withdrawn'
    and id <> new.id;

  if held >= limit_per_team then
    raise exception 'Maximum % keepers per franchise (season %).',
      limit_per_team, new.season;
  end if;

  return new;
end;
$$;

create trigger keepers_count_limit
  before insert or update on public.keepers
  for each row
  when (new.status <> 'withdrawn')
  execute function public.assert_keeper_count_within_limit();

-- Two keepers on one franchise can compute to the same cost round, but a
-- franchise only has one pick per round, so the app bumps one of them earlier.
-- The database backs that up: no two live keepers on one franchise may share a
-- round.
create unique index keepers_one_per_round_per_team
  on public.keepers (season, team_id, cost_round)
  where status <> 'withdrawn';

-- ---------------------------------------------------------------------------
-- keeper_rights
-- ---------------------------------------------------------------------------
-- One row per player, tracking where he sits on the clock and what he would
-- cost. Outlives any single season's `keepers` row, which is what lets the app
-- price a keeper against last season rather than against a draft several years
-- back.
--
-- The source league's version carried a `fee` column. There are no keeper fees
-- in this league, so it is gone.
create table public.keeper_rights (
  player_id text primary key references public.players (player_id) on delete cascade,

  is_undrafted boolean not null default false,

  -- Round he was ORIGINALLY drafted in. Kept for the round-1 rule and for
  -- display; not used to price him.
  original_round int check (original_round >= 1),

  -- Round he occupied LAST season. Walks down one round per keeper season.
  basis_round int check (basis_round >= 1),

  current_team_id uuid references public.teams (id) on delete set null,

  -- KEEPER seasons the CURRENT franchise has already served with him,
  -- excluding the season it acquired him. Same convention as
  -- `keepers.seasons_kept`.
  consecutive_seasons int not null default 0 check (consecutive_seasons >= 0),

  -- Supports the trade-back guard: a player cannot be traded straight back to
  -- the franchise that just sent him away, before the next draft.
  last_team_id uuid references public.teams (id) on delete set null,

  -- The clock a player carried when he left each roster, keyed by team id, so a
  -- manager who drops and re-adds him does not buy a free reset.
  prior_owner_clocks jsonb not null default '{}'::jsonb,

  updated_at timestamptz not null default now(),

  constraint keeper_rights_undrafted_has_no_basis check (
    not is_undrafted or basis_round is null
  )
);

comment on column public.keeper_rights.consecutive_seasons is
  'Keeper seasons already served by the current franchise, excluding the acquisition season. Same convention as keepers.seasons_kept, NOT the sheets'' "N of 3".';
