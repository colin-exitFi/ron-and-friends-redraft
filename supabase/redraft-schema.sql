-- Ron & Friends redraft — the whole schema, as one re-runnable script.
--
-- ============================================================================
-- WHY THIS IS A SCRIPT AND NOT A MIGRATION
-- ============================================================================
-- The tables under `supabase/migrations/` are the authority for what this app
-- queries, and this file is a mechanical transformation of them into a single
-- schema-qualified script. It is not a rewrite from memory, and it should not
-- become one: when a migration there changes, change this to match.
--
-- It is applied with `npm run db:apply:redraft` (psql, or the Management API
-- query endpoint), NOT with `supabase db push`, and `supabase link` is never
-- run from this repo. The reason is the migration ledger in
-- `supabase_migrations.schema_migrations` on this project: it belongs to
-- ../RonAndFriendsApp, which holds the twelve versions currently recorded
-- there. Pushing this repo's migrations would insert versions that repo has no
-- local files for, and it would then refuse to push again — it would see remote
-- versions missing from its own migrations directory. So this repo stays out of
-- the ledger entirely and applies its schema directly.
--
-- ============================================================================
-- WHY A SCHEMA AND NOT A PROJECT
-- ============================================================================
-- `public` on this project is the live backend for ron-and-friends-fantasy.
-- vercel.app — ballots managers have already voted in, the treasury ledger, the
-- lottery. It stays exactly as it is. The commissioner is at his project limit
-- and is not buying another, so isolation is by schema.
--
-- The two schemas collide on fourteen table names: leagues, teams, draft_state,
-- draft_order, trades, traded_picks, votes, keepers, keeper_rights, motions,
-- officers, commissioner_actions, pick_ownership, trade_assets. That collision
-- is the whole reason `public` is not an option, and it is why EVERY object
-- below is schema-qualified. An unqualified `create table` here would land in
-- `public` and take the live app's table with it.
--
-- ============================================================================
-- RE-RUNNABILITY
-- ============================================================================
-- Every statement is guarded. Running this twice is a no-op, which is what
-- makes it safe to re-apply on draft morning without thinking about it.
--
-- The one thing to know: `create table if not exists` does NOT add columns to a
-- table that already exists. Columns introduced by the later migrations
-- (20260826170010 onward) are therefore BOTH folded into the create statements
-- below AND repeated as `add column if not exists`, so an older copy of this
-- schema converges to the current shape instead of silently staying behind.

begin;

create schema if not exists redraft;

comment on schema redraft is
  'Ron & Friends 10-team, 14-round Sleeper redraft league. Isolated from public, '
  'which is the live backend for ron-and-friends-fantasy.vercel.app.';

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- The source migration ran `create extension if not exists "pgcrypto"`. Not
-- repeated: pgcrypto is already installed on this project in the `extensions`
-- schema, and re-declaring an extension that exists elsewhere is either a no-op
-- or an error depending on the schema argument. Nothing here needs it anyway —
-- this is Postgres 17, where `gen_random_uuid()` is native to pg_catalog and
-- resolves without any extension at all.

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------
-- CREATED IN `redraft`, NOT REFERENCED FROM `public`, AND THE REASON MATTERS.
--
-- All nine of these type names already exist in `public`, put there by the R&F
-- app. Referencing them looks like the tidier choice and is the riskier one:
--
--   1. The values are not the same. `public.keeper_status` is
--      (declared, confirmed, withdrawn, forfeited, placed); this app declares
--      (declared, confirmed, placed, withdrawn). Enum comparison and ORDER BY
--      follow declaration order, so borrowing public's type would silently
--      reorder anything that sorts on status. `public.trade_status` and
--      `public.officer_role` likewise carry extra values (`review`,
--      `treasurer`) that this league does not have.
--
--   2. Those types belong to the other repo's migration ledger. A future
--      migration there may add, rename or reorder a value, and the draft board
--      would change behaviour without anybody touching this repo.
--
-- Creating them here is schema-qualified, so it writes nothing to `public`, and
-- it gives the app exactly the values its code was written against.
do $$
begin
  if to_regtype('redraft.draft_status') is null then
    create type redraft.draft_status as enum ('not_started', 'in_progress', 'paused', 'complete');
  end if;

  -- No `forfeited`: that value tracked an unpaid keeper fee, and this league has
  -- no keeper fees. `placed` means the keeper occupies a board slot.
  if to_regtype('redraft.keeper_status') is null then
    create type redraft.keeper_status as enum ('declared', 'confirmed', 'placed', 'withdrawn');
  end if;

  -- No `review`: that was a household trade-review window this league lacks.
  if to_regtype('redraft.trade_status') is null then
    create type redraft.trade_status as enum ('proposed', 'accepted', 'vetoed', 'reversed');
  end if;

  -- `faab` was added by 20260826170011 so a trade that moved dollars is
  -- recordable as one. Nothing derives a balance from it.
  if to_regtype('redraft.trade_asset_type') is null then
    create type redraft.trade_asset_type as enum ('player', 'pick', 'keeper_right', 'faab');
  end if;

  -- No `treasurer`: this repo keeps no treasury. (The R&F app's `public` schema
  -- does, and that is where the treasury lives.)
  if to_regtype('redraft.officer_role') is null then
    create type redraft.officer_role as enum ('commissioner', 'vice_commissioner', 'cto');
  end if;

  if to_regtype('redraft.officer_status') is null then
    create type redraft.officer_status as enum ('active', 'inactive', 'removed');
  end if;

  if to_regtype('redraft.motion_status') is null then
    create type redraft.motion_status as enum (
      'proposed', 'seconded', 'discussion', 'voting', 'ratified', 'rejected', 'withdrawn'
    );
  end if;

  if to_regtype('redraft.motion_threshold') is null then
    create type redraft.motion_threshold as enum (
      'simple_majority', 'two_thirds', 'two_thirds_excl_subject', 'commissioner_ruling'
    );
  end if;

  if to_regtype('redraft.vote_choice') is null then
    create type redraft.vote_choice as enum ('for', 'against', 'abstain');
  end if;
end $$;

-- `add value if not exists` cannot run in the same transaction that creates the
-- type, so it is not used above — `faab` is declared inline instead. This guard
-- exists for a schema created from an older copy of this script.
do $$
begin
  if to_regtype('redraft.trade_asset_type') is not null
     and not exists (
       select 1 from pg_enum e
       where e.enumtypid = 'redraft.trade_asset_type'::regtype
         and e.enumlabel = 'faab'
     )
  then
    raise notice 'redraft.trade_asset_type is missing the faab value; add it outside this transaction.';
  end if;
end $$;

-- ===========================================================================
-- Shape validation
-- ===========================================================================
-- Rounds, columns and overall pick numbers are bounded by the season's own
-- `leagues` row rather than by literals, so this league's 14 rounds / 10 teams
-- / 140 slots are enforced without being frozen into a CHECK that a rules
-- change would have to migrate around.
--
-- `search_path` is pinned empty and every reference fully qualified, so these
-- cannot be redirected at a `public` table by a caller's search_path.

create or replace function redraft.assert_round_within_league_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  rounds int;
begin
  select draft_rounds into rounds from redraft.leagues where season = new.season;

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

create or replace function redraft.assert_slot_within_league_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  teams int;
  rounds int;
  slots int;
begin
  select team_count, draft_rounds, total_slots
    into teams, rounds, slots
  from redraft.leagues
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

-- ===========================================================================
-- leagues
-- ===========================================================================
-- One row per season. The rule numbers live here as columns rather than only in
-- `src/lib/league-config.ts` so a query against the database can tell you what
-- the league's rules were in a given season without reading application code.
--
-- The DEFAULTS BELOW ARE NOT THIS LEAGUE'S VALUES and are not meant to be read
-- as them. They are carried over verbatim from the Ultimate Keeper migrations
-- so this script stays a faithful transformation of them; Ron & Friends is a
-- 10-team, 14-round REDRAFT league with no keepers, and the seed writes those
-- numbers explicitly. `src/lib/league-config.ts` is the authority.
create table if not exists redraft.leagues (
  season int primary key check (season between 2000 and 2100),
  name text not null default 'Ultimate Keeper League',

  espn_league_id bigint,

  team_count int not null default 10 check (team_count > 0),
  draft_rounds int not null default 16 check (draft_rounds > 0),

  -- Derived so the two can never disagree.
  total_slots int generated always as (team_count * draft_rounds) stored,

  snake_draft boolean not null default true,

  -- The clock the room sees is advisory; nothing is auto-picked when it expires.
  offline_draft boolean not null default true,

  keepers_active boolean not null default true,
  keepers_per_team int not null default 2 check (keepers_per_team >= 0),

  -- KEEPER SEASONS, not seasons of tenure. See the convention note on
  -- `keepers.sheet_tenure_year`.
  max_keeper_seasons int not null default 2 check (max_keeper_seasons >= 0),

  cost_round_step int not null default 1,
  undrafted_cost_round int not null default 9,
  trade_resets_keeper_clock boolean not null default true,
  trade_deadline_week int default 11,

  -- Scoring spec, lineup slots, position limits, playoff format. Reference only.
  settings jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column redraft.leagues.max_keeper_seasons is
  'Keeper seasons a franchise may serve with one player, EXCLUDING the season it acquired him. The keeper sheets count the acquisition season and therefore write the same rule as "3".';

-- ===========================================================================
-- teams
-- ===========================================================================
-- Three different names are in play for each franchise and they are not
-- interchangeable, so each gets its own column: `short_name` is the handle the
-- draft room gives us and the only thing a 40px board column can fit,
-- `franchise_name` is the platform's team name, `manager` is the human.
create table if not exists redraft.teams (
  id uuid primary key default gen_random_uuid(),
  short_name text not null unique,
  franchise_name text not null,
  manager text not null,
  abbrev text,

  -- Draft slot for the CURRENT season, 1-based. `draft_order` carries it per
  -- season; this column is the convenience copy the board reads.
  draft_slot int check (draft_slot >= 1),

  espn_team_id int unique,

  -- Stable identity in the draft room, so re-running the seed against a fresh
  -- snapshot matches franchises by id rather than by name.
  smartdraft_team_id uuid unique,

  -- Added by 20260826170010. When set, this franchise's keeper list is FINAL and
  -- any unfilled slot is a deliberate pass; null means still awaiting an answer.
  -- A timestamp rather than a boolean so a late declaration can be adjudicated.
  keeper_declarations_closed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table redraft.teams
  add column if not exists keeper_declarations_closed_at timestamptz;

comment on column redraft.teams.keeper_declarations_closed_at is
  'When set, this franchise''s keeper declarations are final for the season and any unfilled slot is a deliberate pass, not an outstanding answer. Null means still awaiting.';

-- One franchise per slot, but slots may be unassigned.
create unique index if not exists teams_draft_slot_unique
  on redraft.teams (draft_slot)
  where draft_slot is not null;

-- Matching a franchise by short name is case-insensitive, the same way
-- `franchiseByShortName` in league-config is.
create unique index if not exists teams_short_name_lower_unique
  on redraft.teams (lower(short_name));

-- ===========================================================================
-- players
-- ===========================================================================
-- Still a cache: the authoritative pool for the draft board is the snapshot in
-- `data/`, read straight off disk so /draft and /players work with no database
-- at all. This table exists so keepers, trades and board slots have something
-- to reference.
create table if not exists redraft.players (
  player_id text primary key,
  full_name text not null,
  position text,
  nfl_team text,
  bye_week int check (bye_week between 1 and 22),

  adp numeric(6, 2),
  position_rank int,

  source text not null default 'smartdraft',
  metadata jsonb not null default '{}'::jsonb,
  refreshed_at timestamptz not null default now(),

  -- Carried over from the Ultimate Keeper migrations, where the platform had
  -- both the K lineup slot and the K roster limit at zero, so a kicker could
  -- not be rostered and therefore could not be referenced. THIS MAY NOT HOLD
  -- FOR A SLEEPER REDRAFT LEAGUE. Nothing on draft night touches this table —
  -- the board reads the pool off disk and writes to `draft_live_state` — but a
  -- seed that imports a kicker into `players` will be rejected here. Drop the
  -- constraint if the league rosters kickers; do not work around it in code.
  constraint players_no_kicker check (position is null or position <> 'K')
);

create index if not exists players_full_name_idx on redraft.players (lower(full_name));
create index if not exists players_position_idx on redraft.players (position);

-- ===========================================================================
-- draft_order
-- ===========================================================================
-- Who picks where, per season, with its provenance.
create table if not exists redraft.draft_order (
  season int not null references redraft.leagues (season) on delete cascade,
  slot int not null check (slot >= 1),
  team_id uuid not null references redraft.teams (id) on delete cascade,
  source text not null default 'smartdraft',
  locked boolean not null default false,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (season, slot),
  unique (season, team_id)
);

-- ===========================================================================
-- pick_ownership
-- ===========================================================================
-- The pick as an ASSET. One row per (season, round, original franchise),
-- carrying who holds it now. Exists for seasons that have no board yet, which
-- is what makes a future pick tradable today.
create table if not exists redraft.pick_ownership (
  id uuid primary key default gen_random_uuid(),
  season int not null,
  round int not null check (round >= 1),

  -- The franchise the pick was born to. Immutable: it is the pick's identity,
  -- and it is the board column the pick appears in no matter who holds it.
  original_team uuid not null references redraft.teams (id) on delete cascade,

  -- Who holds it now. Equal to original_team for an untraded pick.
  current_team uuid not null references redraft.teams (id) on delete cascade,

  updated_at timestamptz not null default now(),
  unique (season, round, original_team)
);

create index if not exists pick_ownership_current_idx
  on redraft.pick_ownership (season, current_team);

-- Deliberately not FK-constrained to `leagues`: a future pick is tradable long
-- before there is a season row. The trigger bounds the round when the season is
-- known and waves it through when it is not.
drop trigger if exists pick_ownership_shape on redraft.pick_ownership;
create trigger pick_ownership_shape
  before insert or update on redraft.pick_ownership
  for each row execute function redraft.assert_round_within_league_shape();

-- ===========================================================================
-- traded_picks
-- ===========================================================================
-- Append-only log of pick movements, so the board can explain itself. Without
-- the log, a net position across two trades looks like a half-applied trade.
create table if not exists redraft.traded_picks (
  id uuid primary key default gen_random_uuid(),
  season int not null,
  round int not null check (round >= 1),
  original_team uuid not null references redraft.teams (id) on delete cascade,
  from_team uuid references redraft.teams (id) on delete set null,
  current_team uuid not null references redraft.teams (id) on delete cascade,
  trade_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists traded_picks_season_idx
  on redraft.traded_picks (season, round);

-- ===========================================================================
-- draft_slots
-- ===========================================================================
-- The pick as a BOARD CELL. One row per physical square on the grid, with its
-- coordinates, the player in it, and whether that player is a keeper.
create table if not exists redraft.draft_slots (
  id uuid primary key default gen_random_uuid(),
  season int not null references redraft.leagues (season) on delete cascade,
  round int not null check (round >= 1),

  -- Position within the round in pick order, 1-based.
  pick_in_round int not null check (pick_in_round >= 1),
  overall_pick int not null check (overall_pick >= 1),

  original_team_id uuid not null references redraft.teams (id) on delete cascade,
  current_team_id uuid not null references redraft.teams (id) on delete cascade,

  player_id text references redraft.players (player_id) on delete set null,

  -- A keeper occupies a real board slot at his cost round rather than sitting
  -- beside the board, which is why keepers and drafted players share a table.
  is_keeper boolean not null default false,

  -- The room snapshot's own slot key, so re-seeding from a newer snapshot
  -- updates rows instead of duplicating them.
  smartdraft_slot_key uuid,

  updated_at timestamptz not null default now(),

  unique (season, overall_pick),

  -- THE GRID INVARIANT. The board draws one cell per (round, column), and the
  -- column is the ORIGINAL owner's — a franchise keeps its column every round
  -- and a traded pick shows up as a foreign name inside someone else's column.
  -- Two picks claiming one cell would silently hide one of them, so the database
  -- refuses it rather than letting the room draft off a board with a missing
  -- pick.
  unique (season, round, original_team_id)
);

create unique index if not exists draft_slots_smartdraft_key_unique
  on redraft.draft_slots (season, smartdraft_slot_key)
  where smartdraft_slot_key is not null;

-- Nobody can be taken twice in one draft.
create unique index if not exists draft_slots_player_unique
  on redraft.draft_slots (season, player_id)
  where player_id is not null;

create index if not exists draft_slots_current_team_idx
  on redraft.draft_slots (season, current_team_id);
create index if not exists draft_slots_keeper_idx
  on redraft.draft_slots (season) where is_keeper;

drop trigger if exists draft_slots_shape on redraft.draft_slots;
create trigger draft_slots_shape
  before insert or update on redraft.draft_slots
  for each row execute function redraft.assert_slot_within_league_shape();

-- ===========================================================================
-- draft_state
-- ===========================================================================
-- `clock_seconds` is what the room is shown, not a timer the server enforces:
-- nothing auto-advances and nothing auto-picks.
create table if not exists redraft.draft_state (
  season int primary key references redraft.leagues (season) on delete cascade,
  status redraft.draft_status not null default 'not_started',
  current_overall_pick int check (current_overall_pick >= 1),
  clock_seconds int not null default 120,
  clock_started_at timestamptz,
  paused_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ===========================================================================
-- keepers
-- ===========================================================================
-- Ron & Friends is a REDRAFT league, so nothing is expected to write here. The
-- tables are created anyway, per the brief, so that no application code has to
-- care about which of the repo's tables exist on this backend.
--
-- ===========================================================================
-- TWO WAYS OF COUNTING THE CLOCK. DO NOT CONFLATE THEM.
-- ===========================================================================
--   sheet_tenure_year  The spreadsheets' "N of 3", counting EVERY season the
--                      franchise has held the player INCLUDING the acquisition
--                      season. So "1 of 3" is not a keeper season at all.
--   seasons_kept       Keeper seasons ALREADY SERVED, EXCLUDING the acquisition
--                      season. What `src/lib/keeper-clock.ts` counts, and why
--                      `leagues.max_keeper_seasons` is 2 and not 3.
--
-- The mapping `seasons_kept = greatest(0, sheet_tenure_year - 2)` is enforced by
-- the CHECK below so the two cannot drift. Reading a "3" off a sheet straight
-- into `seasons_kept` would mark a final-season keeper as already expired and
-- quietly print a wrong board.
create table if not exists redraft.keepers (
  id uuid primary key default gen_random_uuid(),
  season int not null references redraft.leagues (season) on delete cascade,
  team_id uuid not null references redraft.teams (id) on delete cascade,
  player_id text not null references redraft.players (player_id) on delete cascade,

  -- The round this keeper occupies this season — one lower than last season's.
  cost_round int not null check (cost_round >= 1),

  -- The round he occupied LAST season. NOT his original draft round: a trade
  -- moves this price to the new franchise untouched.
  basis_round int check (basis_round >= 1),

  -- A free-agent acquisition has no round and prices at
  -- `leagues.undrafted_cost_round` in his first keeper season instead.
  is_undrafted boolean not null default false,

  sheet_tenure_year int check (sheet_tenure_year >= 1),
  seasons_kept int not null default 0 check (seasons_kept >= 0),

  -- A trade restarts eligibility with the new team while the player retains his
  -- previous season's round value. Clock resets, cost basis carries.
  acquired_by_trade boolean not null default false,
  clock_reset_by_trade boolean not null default false,

  status redraft.keeper_status not null default 'declared',

  source text,
  notes text,

  declared_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A franchise cannot declare the same player twice, and two franchises cannot
  -- both claim him.
  unique (season, player_id),

  -- THE OFF-BY-ONE GUARD.
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

create index if not exists keepers_season_team_idx
  on redraft.keepers (season, team_id);

comment on column redraft.keepers.sheet_tenure_year is
  'The keeper sheets'' "N of 3" for the season this row is FOR, counting the acquisition season as year 1. NOT the same as seasons_kept.';

comment on column redraft.keepers.seasons_kept is
  'Keeper seasons ALREADY SERVED entering this season, excluding the acquisition season. The convention src/lib/keeper-clock.ts uses.';

-- A franchise may declare at most `leagues.keepers_per_team` keepers. A trigger
-- rather than a CHECK because it is a per-franchise count, and read off the
-- season's own config rather than hardcoded.
create or replace function redraft.assert_keeper_count_within_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  limit_per_team int;
  held int;
begin
  select keepers_per_team into limit_per_team
  from redraft.leagues where season = new.season;

  if limit_per_team is null then
    raise exception 'No leagues row for season % — seed the season first.', new.season;
  end if;

  select count(*) into held
  from redraft.keepers
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

drop trigger if exists keepers_count_limit on redraft.keepers;
create trigger keepers_count_limit
  before insert or update on redraft.keepers
  for each row
  when (new.status <> 'withdrawn')
  execute function redraft.assert_keeper_count_within_limit();

-- Two keepers on one franchise can compute to the same cost round, but a
-- franchise only has one pick per round, so the app bumps one earlier. The
-- database backs that up.
create unique index if not exists keepers_one_per_round_per_team
  on redraft.keepers (season, team_id, cost_round)
  where status <> 'withdrawn';

-- ===========================================================================
-- keeper_rights
-- ===========================================================================
-- One row per player, tracking where he sits on the clock and what he would
-- cost. Outlives any single season's `keepers` row.
create table if not exists redraft.keeper_rights (
  player_id text primary key references redraft.players (player_id) on delete cascade,

  is_undrafted boolean not null default false,

  -- Round he was ORIGINALLY drafted in. Display only; not used to price him.
  original_round int check (original_round >= 1),

  -- Round he occupied LAST season. Walks down one round per keeper season.
  basis_round int check (basis_round >= 1),

  current_team_id uuid references redraft.teams (id) on delete set null,

  consecutive_seasons int not null default 0 check (consecutive_seasons >= 0),

  -- Supports the trade-back guard: a player cannot be traded straight back to
  -- the franchise that just sent him away, before the next draft.
  last_team_id uuid references redraft.teams (id) on delete set null,

  -- The clock a player carried when he left each roster, keyed by team id, so a
  -- manager who drops and re-adds him does not buy a free reset.
  prior_owner_clocks jsonb not null default '{}'::jsonb,

  -- Added by 20260826170012. `acquisition_season` is stored rather than derived
  -- from `acquired_at` because it is the number the clock arithmetic uses, and
  -- because the season boundary depends on the configurable draft date.
  acquired_at date,
  acquisition_season int,

  -- Mirrors `prior_owner_clocks`. A trade reversal has to put back the
  -- acquisition stamp as well as the clock, or the state it restores is only
  -- approximately the one it found.
  prior_owner_acquisitions jsonb not null default '{}'::jsonb,

  updated_at timestamptz not null default now(),

  constraint keeper_rights_undrafted_has_no_basis check (
    not is_undrafted or basis_round is null
  )
);

alter table redraft.keeper_rights
  add column if not exists acquired_at date,
  add column if not exists acquisition_season int,
  add column if not exists prior_owner_acquisitions jsonb not null default '{}'::jsonb;

comment on column redraft.keeper_rights.consecutive_seasons is
  'Keeper seasons already served by the current franchise, excluding the acquisition season. Same convention as keepers.seasons_kept, NOT the sheets'' "N of 3".';

comment on column redraft.keeper_rights.acquired_at is
  'When the CURRENT franchise acquired this player. Set from trades.traded_at on a logged trade. Null where unknown.';

comment on column redraft.keeper_rights.acquisition_season is
  'League season the acquisition belongs to, derived from acquired_at at the time of the trade. The clock counts from this.';

comment on column redraft.keeper_rights.prior_owner_acquisitions is
  'Acquisition stamp a player carried when he left each roster, keyed by team id, so a trade reversal restores it exactly rather than approximately.';

-- ===========================================================================
-- trades
-- ===========================================================================
-- Pick counts do NOT have to net to zero per franchise: this league lets a
-- manager end the offseason with more or fewer picks than anyone else, which is
-- why nothing here or in `pick_ownership` tries to conserve them.
create table if not exists redraft.trades (
  id uuid primary key default gen_random_uuid(),
  season int not null references redraft.leagues (season) on delete cascade,
  status redraft.trade_status not null default 'proposed',
  created_by uuid references redraft.teams (id) on delete set null,
  executed_at timestamptz,
  notes text,

  -- True for a deal that has not fired yet.
  contingent boolean not null default false,

  -- Provenance for imported trades, and the idempotency key the seed re-runs
  -- against.
  source text,
  source_ref text,

  -- Added by 20260826170012. THE DATE THE TRADE ACTUALLY HAPPENED, which is not
  -- `created_at` — that is when the row was written. Nullable on purpose:
  -- imported trades have no date in any source, and a guessed date would be
  -- indistinguishable from a known one.
  traded_at date,

  created_at timestamptz not null default now(),

  constraint trades_executed_when_accepted check (
    status <> 'accepted' or executed_at is not null
  )
);

alter table redraft.trades
  add column if not exists traded_at date;

comment on column redraft.trades.traded_at is
  'The date the trade actually happened, per the commissioner. NOT created_at, '
  'which is when the row was written. Null only for trades imported from a '
  'workbook carrying no dates — those need backfill and must not be guessed. '
  'Drives keeper-clock computation, so an inaccurate value is worse than a null one.';

-- NOT partial, per 20260826170009. Postgres cannot infer a partial index from a
-- plain `ON CONFLICT (season, source_ref)`, which made the seed's upsert fail
-- with "no unique or exclusion constraint matching the ON CONFLICT
-- specification". The predicate was never needed: a unique index treats NULLs
-- as distinct anyway, so rows created in the app never collide.
create unique index if not exists trades_source_ref_unique
  on redraft.trades (season, source, source_ref);

comment on index redraft.trades_source_ref_unique is
  'Idempotency key for scripts/seed-league.mjs. Not partial: NULL source_ref rows (created in the app) are distinct from each other anyway.';

create index if not exists trades_season_idx
  on redraft.trades (season, created_at desc);

create index if not exists trades_traded_at_idx
  on redraft.trades (season, traded_at);

-- Each row is one asset moving one way, so a two-sided deal is several rows.
-- `ref` is the asset: a `players.player_id` for a player or keeper right,
-- `season:round` (e.g. `2027:3`) for a pick, or a whole-dollar amount for faab.
create table if not exists redraft.trade_assets (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references redraft.trades (id) on delete cascade,
  from_team uuid not null references redraft.teams (id) on delete cascade,
  to_team uuid not null references redraft.teams (id) on delete cascade,
  asset_type redraft.trade_asset_type not null,
  ref text not null,

  -- Defaults true because a trade restarts the player's keeper eligibility with
  -- his new team. Meaningless on a pick.
  keeper_clock_reset boolean not null default true,

  created_at timestamptz not null default now(),

  constraint trade_assets_two_parties check (from_team <> to_team),
  unique (trade_id, from_team, to_team, asset_type, ref)
);

create index if not exists trade_assets_trade_idx
  on redraft.trade_assets (trade_id);

-- Deferred from the draft-board section, where `trades` did not exist yet.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'traded_picks_trade_id_fkey'
      and conrelid = 'redraft.traded_picks'::regclass
  ) then
    alter table redraft.traded_picks
      add constraint traded_picks_trade_id_fkey
      foreign key (trade_id) references redraft.trades (id) on delete set null;
  end if;
end $$;

-- ===========================================================================
-- Governance — officers, motions, votes, decisions log
-- ===========================================================================
create table if not exists redraft.officers (
  id uuid primary key default gen_random_uuid(),
  season int not null references redraft.leagues (season) on delete cascade,
  role redraft.officer_role not null,
  team_id uuid references redraft.teams (id) on delete set null,
  manager text,
  since date,
  status redraft.officer_status not null default 'active',
  created_at timestamptz not null default now()
);

-- One holder per role per season.
create unique index if not exists officers_role_per_season
  on redraft.officers (season, role)
  where status <> 'removed';

create table if not exists redraft.motions (
  id uuid primary key default gen_random_uuid(),
  season int not null references redraft.leagues (season) on delete cascade,

  -- Free text rather than an enum: the motion presets in
  -- `src/lib/governance-rules.ts` are defaults offered in the UI, not a closed
  -- set the league has agreed to.
  type text not null check (length(btrim(type)) > 0),

  proposer_team uuid references redraft.teams (id) on delete set null,
  seconded_by_team uuid references redraft.teams (id) on delete set null,
  status redraft.motion_status not null default 'proposed',
  threshold redraft.motion_threshold not null default 'simple_majority',
  discussion_opens timestamptz,
  discussion_closes timestamptz,
  effective_date date,
  documentation text,
  created_at timestamptz not null default now(),

  -- A manager cannot second his own motion.
  constraint motions_seconder_differs check (
    seconded_by_team is null
    or proposer_team is null
    or seconded_by_team <> proposer_team
  )
);

create index if not exists motions_season_idx
  on redraft.motions (season, created_at desc);

create table if not exists redraft.votes (
  id uuid primary key default gen_random_uuid(),
  motion_id uuid not null references redraft.motions (id) on delete cascade,
  team_id uuid not null references redraft.teams (id) on delete cascade,
  choice redraft.vote_choice not null,
  cast_at timestamptz not null default now(),

  -- One franchise, one vote. Changing your mind updates the row.
  unique (motion_id, team_id)
);

-- The decisions log. Every commissioner ruling belongs here so the league can
-- see what was decided unilaterally and why.
create table if not exists redraft.commissioner_actions (
  id uuid primary key default gen_random_uuid(),
  season int not null references redraft.leagues (season) on delete cascade,
  type text not null check (length(btrim(type)) > 0),
  description text,
  disclosure_note text,
  related_id uuid,
  source_ref text,
  created_at timestamptz not null default now()
);

-- NOT partial, for the same ON CONFLICT reason as trades_source_ref_unique.
create unique index if not exists commissioner_actions_source_ref_unique
  on redraft.commissioner_actions (season, source_ref);

create index if not exists commissioner_actions_season_idx
  on redraft.commissioner_actions (season, created_at desc);

-- ===========================================================================
-- draft_live_state — the live board, somewhere writable
-- ===========================================================================
-- THE TABLE DRAFT NIGHT ACTUALLY DEPENDS ON.
--
-- The board used to persist to `data/draft-state-<season>.json`. That is right
-- on the commissioner's laptop and impossible anywhere else: a deployment has a
-- read-only filesystem, so the first pick came back
--
--   EROFS: read-only file system, open '/var/task/data/draft-state-2026.json…'
--
-- and the pick was lost. Every instance also has its own disk, so even a
-- writable one would give two phones two different drafts.
--
-- WHY A JSON DOCUMENT AND NOT `draft_slots`: `draft_slots` is the BOARD — one
-- row per cell, a unique index saying nobody is drafted twice. The live state is
-- the append-only list of what the commissioner TYPED, in the order he typed
-- it, and the board is derived from it. That is what makes undo exact (drop the
-- last entry and the previous board reappears by construction), and it is what
-- lets the override rule stand — the commissioner outranks the software, so a
-- player entered twice on purpose has to be storable, and
-- `draft_slots_player_unique` would refuse it.
create table if not exists redraft.draft_live_state (
  -- No FK to `leagues`. This table is the crash-safety net for draft night, and
  -- an unseeded season is not a reason to refuse to save a pick.
  season int primary key,

  -- A whole `DraftStateFile`. Validated on read by the application, which
  -- refuses to read a malformed document as an empty draft — that is how you
  -- lose ninety picks and not notice.
  state jsonb not null,

  -- Optimistic concurrency. A write names the revision it was derived from and
  -- is refused if the board has moved since, so two instances entering picks at
  -- the same moment cannot silently overwrite each other.
  revision bigint not null default 1,

  updated_at timestamptz not null default now()
);

comment on table redraft.draft_live_state is
  'The live draft board as a whole JSON document, one row per season. Written '
  'by the app on every pick and undo. Replaces data/draft-state-<season>.json, '
  'which cannot be written on a read-only deployment filesystem.';

-- The file store dropped a timestamped copy on every write, which is the
-- difference between "reboot and carry on" and "re-enter ninety picks from
-- memory in front of ten people". Same discipline, same reason.
create table if not exists redraft.draft_live_backups (
  id uuid primary key default gen_random_uuid(),
  season int not null,
  state jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists draft_live_backups_season_idx
  on redraft.draft_live_backups (season, created_at desc);

comment on table redraft.draft_live_backups is
  'Every saved version of draft_live_state, newest last. Pruned by the app to '
  'the most recent few hundred per season. Recovery path: copy the newest good '
  'state back into draft_live_state.';

-- ===========================================================================
-- draft_recap
-- ===========================================================================
-- One row per season, replaced outright on every generation. No revision column
-- and no backup table, unlike the live board: re-generating is a button press,
-- and the league's stated preference is recovery over prevention. Last write
-- wins on purpose.
create table if not exists redraft.draft_recap (
  season integer primary key,
  recap jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table redraft.draft_recap is
  'One AI-written post-draft recap per season. Replaced wholesale on re-generation.';
comment on column redraft.draft_recap.recap is
  'A RecapDocument from src/lib/recap-types.ts — blurbs, citations and usage.';

-- ===========================================================================
-- FantasyPros — the OAuth grant, and the last-known-good copy of what it fetched
-- ===========================================================================
-- The refresh token must survive a REDEPLOY. If it lived in an environment
-- variable, every rotation would need a push, and a push to main is a
-- production release. A row can be rewritten by a running function; an env var
-- cannot.
--
-- NEITHER TABLE GETS A READ POLICY OR A GRANT TO anon/authenticated. This one
-- holds a credential granting access to the commissioner's FantasyPros account,
-- so RLS is enabled and left with no policy at all: only the service-role key —
-- which never leaves the server — can reach it.
create table if not exists redraft.fantasypros_oauth (
  -- One grant, so one row. A fixed key rather than a sequence, so an upsert from
  -- the auth script and an upsert from a token rotation touch the same row.
  id text primary key default 'fantasypros',
  issuer text not null,
  -- The RFC 8707 canonical resource URI the tokens are bound to, so a refresh
  -- sends the same value the grant was issued for.
  resource text not null,
  client_id text not null,
  -- Null for a public client, which is how FantasyPros registers this app.
  client_secret text,
  refresh_token text not null,
  scope text,
  -- Cached so a warm process does not spend a round trip before every call. Not
  -- the credential that matters; the refresh token is.
  access_token text,
  access_token_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table redraft.fantasypros_oauth is
  'The single FantasyPros MCP OAuth grant. SECRET — service role only, no read policy.';
comment on column redraft.fantasypros_oauth.refresh_token is
  'Long-lived credential. Rotated in place when FantasyPros issues a new one.';

-- Last-known-good payloads from the MCP server, keyed by call. This is the
-- CACHE, not the floor — the floor is the committed snapshot in data/. It sits
-- between them: fresher than the snapshot, and still present when FantasyPros
-- is not, which is the case that matters when the draft runs off a projector.
create table if not exists redraft.fantasypros_cache (
  key text primary key,
  payload jsonb not null,
  -- When the upstream call that produced this actually succeeded. TTL is
  -- computed from it at read time rather than enforced by a delete, so an
  -- expired row is still available as the fallback.
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table redraft.fantasypros_cache is
  'Last-known-good FantasyPros responses. Stale rows are kept on purpose: they are the fallback.';

-- ===========================================================================
-- Row level security
-- ===========================================================================
-- The access model, unchanged from the source migrations because it is the
-- right one for a ten-man league with no login:
--
--   * Managers browsing on their phones use the browser anon key -> READ ONLY.
--   * Every write goes through a server route holding the service-role key,
--     which bypasses RLS entirely.
--
-- So RLS is on everywhere and anon/authenticated are granted nothing but
-- SELECT. Supabase Realtime works off SELECT, so the board still pushes updates
-- to every phone in the room.
--
-- Unlike `public`, a custom schema gets NO default privileges from Supabase, so
-- the grants below are not belt-and-braces — they are the only reason the anon
-- key can read anything at all.
do $$
declare
  t text;
  -- The sixteen tables from 20260826170007, plus draft_live_state and
  -- draft_recap, which the later migrations gave the same read-only treatment.
  readable text[] := array[
    'leagues',
    'teams',
    'players',
    'draft_order',
    'pick_ownership',
    'traded_picks',
    'draft_slots',
    'draft_state',
    'keepers',
    'keeper_rights',
    'trades',
    'trade_assets',
    'officers',
    'motions',
    'votes',
    'commissioner_actions',
    'draft_live_state'
  ];
  -- No read policy, no grant to anon/authenticated: a credential, a cache of
  -- raw upstream payloads, and the backups nothing browses.
  private_tbls text[] := array[
    'draft_live_backups',
    'fantasypros_oauth',
    'fantasypros_cache'
  ];
begin
  foreach t in array readable loop
    execute format('alter table redraft.%I enable row level security;', t);

    -- Recreated rather than guarded, so a policy edited by hand converges back
    -- to what this script says it should be.
    execute format('drop policy if exists %I on redraft.%I;', t || '_read', t);
    execute format(
      'create policy %I on redraft.%I for select to anon, authenticated using (true);',
      t || '_read', t
    );

    execute format('grant select on redraft.%I to anon, authenticated;', t);

    -- Belt and braces. RLS with only a SELECT policy already blocks writes, but
    -- taking the grant away means a policy added carelessly later cannot turn
    -- into a write hole.
    execute format(
      'revoke insert, update, delete, truncate on redraft.%I from anon, authenticated;',
      t
    );

    execute format('grant all on redraft.%I to service_role;', t);
  end loop;

  foreach t in array private_tbls loop
    execute format('alter table redraft.%I enable row level security;', t);
    -- Deliberately no policy. See the headers on those tables.
    execute format('revoke all on redraft.%I from anon, authenticated;', t);
    execute format('grant all on redraft.%I to service_role;', t);
  end loop;
end $$;

-- `draft_recap` keeps the policy name and the unrestricted `using (true)` from
-- 20260828000001, where it has no `to` clause. The recap is league banter
-- printed on a screen in a room; the draft routes next to it are
-- unauthenticated by a settled decision, and this matches them.
alter table redraft.draft_recap enable row level security;
drop policy if exists "draft_recap read" on redraft.draft_recap;
create policy "draft_recap read"
  on redraft.draft_recap for select
  using (true);
grant select on redraft.draft_recap to anon, authenticated;
revoke insert, update, delete, truncate on redraft.draft_recap from anon, authenticated;
grant all on redraft.draft_recap to service_role;

-- ===========================================================================
-- Grants on the schema itself
-- ===========================================================================
-- Without USAGE, every table grant above is unreachable and PostgREST answers
-- 404 on all of them.
grant usage on schema redraft to anon, authenticated, service_role;

-- Anything added to this schema later — by a hand-run statement, or by a future
-- version of this script — gets the same treatment without a second pass.
alter default privileges in schema redraft
  grant select on tables to anon, authenticated;
alter default privileges in schema redraft
  grant all on tables to service_role;
alter default privileges in schema redraft
  grant usage, select on sequences to anon, authenticated, service_role;

commit;

-- ===========================================================================
-- Realtime
-- ===========================================================================
-- Outside the transaction above: publication changes are best applied on their
-- own so a failure here cannot roll back the schema.
--
-- ###########################################################################
-- ADD TABLE. NEVER SET TABLE.
-- ###########################################################################
-- `supabase_realtime` on this project currently carries twenty-six `public`
-- tables belonging to the live R&F app — ballot_votes, treasury_ledger,
-- standings and the rest. `ALTER PUBLICATION supabase_realtime SET TABLE ...`
-- REPLACES the entire member list, so a single `SET` here would silently drop
-- all twenty-six and break the deployed app with no error anywhere. `ADD TABLE`
-- is additive and is the only correct form in this file.
do $$
declare
  t text;
  tbls text[] := array[
    'teams',
    'draft_slots',
    'draft_state',
    'keepers',
    'pick_ownership',
    'trades',
    'trade_assets',
    'motions',
    'votes',
    'officers',
    'commissioner_actions',
    -- Published whole, per 20260827000002. `state` is one JSON document of the
    -- picks typed so far — well under the payload limit for a full draft — and
    -- each board ignores it on arrival and re-fetches `/api/draft/state` for the
    -- assembled view. Wasteful in principle, immaterial in practice, and one
    -- fewer unusual thing to debug on draft night.
    'draft_live_state'
  ];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice
      'No supabase_realtime publication — skipping. Expected on a plain local Postgres.';
    return;
  end if;

  foreach t in array tbls loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'redraft'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table redraft.%I;', t);
    end if;
  end loop;
end $$;

-- Realtime sends only the primary key on a DELETE unless the table replicates
-- its full old row. The board needs to know WHICH pick changed, and for updates
-- the previous owner, so replicate everything on the board tables.
alter table redraft.draft_slots replica identity full;
alter table redraft.pick_ownership replica identity full;
alter table redraft.keepers replica identity full;

-- `draft_live_state` keeps replica identity DEFAULT, unlike the board tables
-- above. Nothing reads its payload — an event on the season row is the whole
-- message — and `full` on a table holding the entire draft as jsonb would
-- replicate that document on every update for a client that discards it.
-- `season` is the primary key, so DEFAULT already identifies the row.
