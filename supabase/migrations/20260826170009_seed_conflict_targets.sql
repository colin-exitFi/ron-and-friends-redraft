-- Ultimate Keeper League — make the seed's idempotency keys usable.
--
-- `trades_source_ref_unique` and `commissioner_actions_source_ref_unique` were
-- created as PARTIAL indexes (`where source_ref is not null`). Postgres cannot
-- infer a partial index from a plain `ON CONFLICT (season, source_ref)`, so the
-- seed's upsert failed with "no unique or exclusion constraint matching the ON
-- CONFLICT specification".
--
-- The predicate was never needed. A unique index treats NULLs as distinct by
-- default, so rows created in the app — which carry no `source_ref` — never
-- collide with each other whether the predicate is there or not. Dropping it
-- costs nothing and makes the index a valid conflict target.

drop index if exists public.trades_source_ref_unique;
create unique index trades_source_ref_unique
  on public.trades (season, source, source_ref);

drop index if exists public.commissioner_actions_source_ref_unique;
create unique index commissioner_actions_source_ref_unique
  on public.commissioner_actions (season, source_ref);

comment on index public.trades_source_ref_unique is
  'Idempotency key for scripts/seed-league.mjs. Not partial: NULL source_ref rows (created in the app) are distinct from each other anyway.';
