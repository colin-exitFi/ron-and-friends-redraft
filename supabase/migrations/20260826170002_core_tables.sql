-- Ultimate Keeper League — leagues, franchises, players, draft order.

-- ---------------------------------------------------------------------------
-- leagues
-- ---------------------------------------------------------------------------
-- One row per season. The rule numbers live here as columns rather than only in
-- `src/lib/league-config.ts` so a query against the database can tell you what
-- the league's rules were in a given season without reading application code.
--
-- Every default below is the real 2026 value, sourced in `data/DECISIONS.md`.
create table public.leagues (
  season int primary key check (season between 2000 and 2100),
  name text not null default 'Ultimate Keeper League',

  -- ESPN league 441239, "The Ultimate Keeper League". The league is private, so
  -- reads need the commissioner's `espn_s2` / `SWID` cookies; there is no
  -- platform sync and this column is a label, not a live integration.
  espn_league_id bigint,

  team_count int not null default 10 check (team_count > 0),
  draft_rounds int not null default 16 check (draft_rounds > 0),

  -- 10 x 16 = 160 board slots. Derived so the two can never disagree.
  total_slots int generated always as (team_count * draft_rounds) stored,

  snake_draft boolean not null default true,

  -- The draft is run in person. The clock the room sees is advisory and nothing
  -- is auto-picked when it expires.
  offline_draft boolean not null default true,

  -- Keeper rules, from the trade agreement's recitals.
  keepers_active boolean not null default true,
  keepers_per_team int not null default 2 check (keepers_per_team >= 0),

  -- KEEPER SEASONS, not seasons of tenure. See the convention note on
  -- `keepers.sheet_tenure_year`. The contract's "up to three (3) consecutive
  -- seasons" counts the acquisition season, which is why this is 2 and not 3.
  max_keeper_seasons int not null default 2 check (max_keeper_seasons >= 0),

  -- Cost round = the round the player occupied LAST season, minus this.
  cost_round_step int not null default 1,

  -- A free-agent acquisition costs the 9th round in his first keeper season.
  undrafted_cost_round int not null default 9,

  -- A trade restarts keeper eligibility with the new team while the player
  -- retains his previous season's draft-round value. Clock resets, cost basis
  -- carries. This is the loophole `data/DECISIONS.md` flags for the offseason.
  trade_resets_keeper_clock boolean not null default true,

  trade_deadline_week int default 11,

  -- Everything ESPN told us that has no column of its own: scoring spec,
  -- lineup slots, position limits, playoff format. Read-only reference.
  settings jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.leagues.max_keeper_seasons is
  'Keeper seasons a franchise may serve with one player, EXCLUDING the season it acquired him. The keeper sheets count the acquisition season and therefore write the same rule as "3".';

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------
-- The ten franchises. Three different names are in play for each one and they
-- are not interchangeable, so each gets its own column:
--
--   short_name     "Greg"                 the Smart Draft room's team name, and
--                                         the only handle that room gives us
--                                         (every team's ownerName is null). The
--                                         join key, and what a 40px board
--                                         column can actually fit.
--   franchise_name "Jimmy's Johnson"      the real ESPN franchise name.
--   manager        "Greg Blome"           the human.
--
-- Two Kyles and two Scotts, which is why the second of each has a surname as
-- his short name (Witte, Elbe).
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  short_name text not null unique,
  franchise_name text not null,
  manager text not null,
  abbrev text,

  -- Draft slot for the CURRENT season, 1-based. Per the commissioner's ruling
  -- this is the Smart Draft order, not ESPN's — ESPN had Colin 8th and Stefan
  -- 10th, which is stale. `draft_order` carries it per season; this column is
  -- the convenience copy the board and keeper placement read.
  draft_slot int check (draft_slot >= 1),

  espn_team_id int unique,

  -- Stable identity in the Smart Draft room, so re-running the seed against a
  -- fresh snapshot matches franchises by id rather than by name.
  smartdraft_team_id uuid unique,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One franchise per slot, but slots may be unassigned.
create unique index teams_draft_slot_unique
  on public.teams (draft_slot)
  where draft_slot is not null;

-- Matching a franchise by the short name the room uses is case-insensitive,
-- the same way `franchiseByShortName` in league-config is.
create unique index teams_short_name_lower_unique
  on public.teams (lower(short_name));

-- ---------------------------------------------------------------------------
-- players
-- ---------------------------------------------------------------------------
-- Replaces the source league's `players_cache`, which was keyed by
-- `sleeper_player_id`. This league is on ESPN and drafts off the Smart Draft
-- pool, so the key is the Smart Draft player id held as text.
--
-- Still a cache: the authoritative pool for the draft board is
-- `data/smartdraft-players.json`, read straight off disk so /draft and
-- /players work with no database at all. This table exists so keepers, trades
-- and board slots have something to reference.
create table public.players (
  player_id text primary key,
  full_name text not null,
  position text,
  nfl_team text,
  bye_week int check (bye_week between 1 and 22),

  -- Smart Draft's consensus ADP. Null for players nobody is drafting.
  adp numeric(6, 2),
  position_rank int,

  source text not null default 'smartdraft',
  metadata jsonb not null default '{}'::jsonb,
  refreshed_at timestamptz not null default now(),

  -- NO KICKER. ESPN has both the K lineup slot and the K roster limit at zero,
  -- so a kicker cannot be rostered and therefore cannot be referenced.
  constraint players_no_kicker check (position is null or position <> 'K')
);

create index players_full_name_idx on public.players (lower(full_name));
create index players_position_idx on public.players (position);

-- ---------------------------------------------------------------------------
-- draft_order
-- ---------------------------------------------------------------------------
-- Who picks where, per season, with its provenance. `source` matters: ESPN and
-- the Smart Draft room disagreed on slots 8 and 10 for 2026 and the
-- commissioner ruled for Smart Draft.
create table public.draft_order (
  season int not null references public.leagues (season) on delete cascade,
  slot int not null check (slot >= 1),
  team_id uuid not null references public.teams (id) on delete cascade,
  source text not null default 'smartdraft',
  locked boolean not null default false,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (season, slot),
  unique (season, team_id)
);
