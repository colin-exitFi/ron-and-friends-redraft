-- Ultimate Keeper League — extensions and enum types.
--
-- This schema is NOT a trim of the source league's. It was rebuilt for a
-- 10-team ESPN keeper league that runs its draft offline. Deliberately absent,
-- because this league does not have them: the draft lottery, the treasury and
-- dues ledger, payouts, FAAB, transaction fees, weekly matchups and brackets,
-- and every Sleeper identity column. Nothing references them, so they are gone
-- rather than switched off.
--
-- Authority for the rules encoded here is `data/DECISIONS.md`, which records
-- the commissioner's rulings and the recitals of the executed Johnston/Blome
-- trade agreement of Nov 12 2025.

create extension if not exists "pgcrypto";

-- The draft is run in person, so `in_progress` means "the commissioner is
-- calling picks aloud" rather than "a server is enforcing a clock".
create type draft_status as enum ('not_started', 'in_progress', 'paused', 'complete');

-- No `forfeited`: that value existed to track an unpaid keeper fee, and this
-- league has no keeper fees. `placed` means the keeper occupies a board slot.
create type keeper_status as enum ('declared', 'confirmed', 'placed', 'withdrawn');

-- No `review`: the source league held trades between members of one household
-- for a review window. This league has no such rule.
create type trade_status as enum ('proposed', 'accepted', 'vetoed', 'reversed');

-- No `faab`: there is no free-agent auction budget to move around. Players,
-- draft picks, and keeper rights are the only tradable assets.
create type trade_asset_type as enum ('player', 'pick', 'keeper_right');

-- No `treasurer`: there is no treasury to keep.
create type officer_role as enum ('commissioner', 'vice_commissioner', 'cto');
create type officer_status as enum ('active', 'inactive', 'removed');

create type motion_status as enum (
  'proposed',
  'seconded',
  'discussion',
  'voting',
  'ratified',
  'rejected',
  'withdrawn'
);

create type motion_threshold as enum (
  'simple_majority',
  'two_thirds',
  'two_thirds_excl_subject',
  'commissioner_ruling'
);

create type vote_choice as enum ('for', 'against', 'abstain');
