-- Ultimate Keeper League — trades.
--
-- Players and draft picks are the only tradable assets. There is no auction
-- budget to move, no transaction fee to charge, and no household review window.
--
-- Pick counts do NOT have to net to zero per franchise: this league lets a
-- manager end the offseason with more or fewer picks than anyone else, which is
-- why nothing here or in `pick_ownership` tries to conserve them. Scott holds
-- 16 picks including two R1s and two R3s; Zach holds three R4s.

create table public.trades (
  id uuid primary key default gen_random_uuid(),
  season int not null references public.leagues (season) on delete cascade,
  status trade_status not null default 'proposed',
  created_by uuid references public.teams (id) on delete set null,
  executed_at timestamptz,
  notes text,

  -- True for a deal that has not fired yet. The Johnston/Blome contingent 2026
  -- trade is the live example: it executes the day before the draft unless Puka
  -- Nacua is projected to miss six or more weeks, and until then Scott holds an
  -- option to cancel.
  contingent boolean not null default false,

  -- Provenance for the trades imported from the commissioner's workbook, and
  -- the idempotency key the seed re-runs against. 'Trade Log #4' etc.
  source text,
  source_ref text,

  created_at timestamptz not null default now(),

  constraint trades_executed_when_accepted check (
    status <> 'accepted' or executed_at is not null
  )
);

-- Re-running the seed updates an imported trade instead of adding a second copy.
create unique index trades_source_ref_unique
  on public.trades (season, source, source_ref)
  where source_ref is not null;

create index trades_season_idx on public.trades (season, created_at desc);

-- Each row is one asset moving one way, so a two-sided deal is several rows.
-- `ref` is the asset: a `players.player_id` for a player or keeper right, or
-- `season:round` (e.g. `2027:3`) for a pick.
create table public.trade_assets (
  id uuid primary key default gen_random_uuid(),
  trade_id uuid not null references public.trades (id) on delete cascade,
  from_team uuid not null references public.teams (id) on delete cascade,
  to_team uuid not null references public.teams (id) on delete cascade,
  asset_type trade_asset_type not null,
  ref text not null,

  -- Defaults true because the league's rule is that a trade restarts the
  -- player's keeper eligibility with his new team. Meaningless on a pick.
  keeper_clock_reset boolean not null default true,

  created_at timestamptz not null default now(),

  constraint trade_assets_two_parties check (from_team <> to_team),
  unique (trade_id, from_team, to_team, asset_type, ref)
);

create index trade_assets_trade_idx on public.trade_assets (trade_id);

-- Deferred from the draft-board migration, where `trades` did not exist yet.
alter table public.traded_picks
  add constraint traded_picks_trade_id_fkey
  foreign key (trade_id) references public.trades (id) on delete set null;
