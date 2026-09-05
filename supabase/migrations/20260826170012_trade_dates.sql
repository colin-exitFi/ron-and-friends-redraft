-- Ultimate Keeper League — when a trade happened.
--
-- ============================================================================
-- WHY THIS IS A DEFECT AND NOT A MISSING NICE-TO-HAVE
-- ============================================================================
-- The keeper clock in this league cannot be computed without it, even in
-- principle. The rule turns on WHEN a player was acquired:
--
--   Acquired mid-season, he finishes that year on the new roster without
--   occupying a keeper slot. That season is his acquisition season, and the
--   keeper seasons come after it.
--
--   Acquired before the draft, there is no such season. He has to be kept to be
--   rostered at all, so the first season with his new franchise is itself a
--   keeper season.
--
-- The same trade therefore produces different keeper outcomes depending on the
-- month it happened in, and until now `trades` recorded a season and a
-- `created_at` — the moment the ROW was written, which for the twelve imported
-- trades is the moment the seed ran, not the moment the trade happened.
--
-- Puka Nacua is the live cost of this: the league holds two records of him that
-- disagree by a full season, and nobody can settle it from the data because the
-- timing was never written down. It is going to a league vote partly for that
-- reason.
--
-- ============================================================================
-- NULLABLE, DELIBERATELY
-- ============================================================================
-- The twelve trades imported from the commissioner's workbook have no date in
-- any source. The workbook is the only timing evidence for them and it is known
-- to be incomplete — it omits at least one real trade (the Stefan/Witte round-4
-- swap). So the column is nullable and those rows stay null: a guessed date
-- would be indistinguishable from a known one, and a nine-month-deferred
-- calculation run off a guess is worse than one that refuses to run. The app
-- surfaces them as needing backfill instead.
alter table public.trades
  add column if not exists traded_at date;

comment on column public.trades.traded_at is
  'The date the trade actually happened, per the commissioner. NOT created_at, '
  'which is when the row was written. Null only for trades imported from the '
  'workbook, which carries no dates — those need backfill and must not be '
  'guessed. Drives keeper-clock computation, so an inaccurate value is worse '
  'than a null one.';

create index if not exists trades_traded_at_idx on public.trades (season, traded_at);

-- ============================================================================
-- THE ACQUISITION STAMP ON KEEPER RIGHTS
-- ============================================================================
-- `keeper_rights` tracks where a player sits on his clock but has never
-- recorded WHEN the current tenure began, so every clock read has had to assume
-- rather than derive. These three columns close that.
--
-- `acquisition_season` is stored rather than derived from `acquired_at` on the
-- fly because it is the number the clock arithmetic actually uses, and because
-- the season boundary depends on the draft date — a configurable value. A stored
-- season stays true to what was decided when the trade was logged.
alter table public.keeper_rights
  add column if not exists acquired_at date,
  add column if not exists acquisition_season int;

-- Mirrors `prior_owner_clocks`, which already means "the clock a player carried
-- when he left each roster". A reversal has to put back the acquisition stamp
-- as well as the clock, or the state it restores is only approximately the one
-- it found — and an approximate restore of a keeper clock is the failure this
-- whole feature exists to prevent.
alter table public.keeper_rights
  add column if not exists prior_owner_acquisitions jsonb not null default '{}'::jsonb;

comment on column public.keeper_rights.acquired_at is
  'When the CURRENT franchise acquired this player. Set from trades.traded_at '
  'on a logged trade. Null where unknown, e.g. a player whose rights were '
  'seeded from the keeper sheets.';

comment on column public.keeper_rights.acquisition_season is
  'League season the acquisition belongs to, derived from acquired_at at the '
  'time of the trade. The clock counts from this.';

comment on column public.keeper_rights.prior_owner_acquisitions is
  'Acquisition stamp a player carried when he left each roster, keyed by team '
  'id, so a trade reversal restores it exactly rather than approximately.';
