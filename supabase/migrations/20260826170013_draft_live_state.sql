-- Ultimate Keeper League — the live draft board, somewhere writable.
--
-- ============================================================================
-- WHY THIS TABLE EXISTS
-- ============================================================================
-- The board persisted to `data/draft-state-<season>.json`, written atomically
-- with a timestamped backup beside it. That is exactly right on the
-- commissioner's laptop and impossible anywhere else: a deployed instance runs
-- on a read-only filesystem, so the first pick of the draft came back
--
--   EROFS: read-only file system, open '/var/task/data/draft-state-2026.json…'
--
-- and the pick was lost. Every instance also has its own disk, so even a
-- writable one would give two phones two different drafts.
--
-- ============================================================================
-- WHY A JSON DOCUMENT AND NOT `draft_slots`
-- ============================================================================
-- `draft_slots` is the BOARD — one row per cell, one player per cell, a unique
-- index that says nobody is drafted twice. The live state is a different thing
-- and deliberately so: it is the append-only list of what the commissioner
-- TYPED, in the order he typed it, and the board is derived from it. That is
-- what makes undo exact (drop the last entry and the previous board reappears
-- by construction) and it is what lets the override rule stand — the
-- commissioner outranks the software, so a player entered twice on purpose has
-- to be storable, and `draft_slots_player_unique` would refuse it.
--
-- So the document is stored whole, in the same shape `@/lib/draft-types`
-- describes and `isDraftStateFile` validates. `db:import:draft` still lands the
-- finished draft in `draft_slots` afterwards; this table is the room's
-- scratchpad, not the record.
--
-- Not published to `supabase_realtime`. The draft board holds its own state and
-- a `router.refresh()` underneath a half-typed player name would take the
-- keystrokes with it.

create table public.draft_live_state (
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

comment on table public.draft_live_state is
  'The live draft board as a whole JSON document, one row per season. Written '
  'by the app on every pick and undo. Replaces the data/draft-state-<season>.json '
  'file, which cannot be written on a read-only deployment filesystem.';

-- ---------------------------------------------------------------------------
-- Backups
-- ---------------------------------------------------------------------------
-- The file store dropped a timestamped copy on every write, which is the
-- difference between "reboot and carry on" and "re-enter ninety picks from
-- memory in front of ten people". Same discipline, same reason.
create table public.draft_live_backups (
  id uuid primary key default gen_random_uuid(),
  season int not null,
  state jsonb not null,
  created_at timestamptz not null default now()
);

create index draft_live_backups_season_idx
  on public.draft_live_backups (season, created_at desc);

comment on table public.draft_live_backups is
  'Every saved version of draft_live_state, newest last. Pruned by the app to '
  'the most recent few hundred per season. Recovery path: copy the newest good '
  'state back into draft_live_state.';

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
-- Same model as everything else: anon reads, service role writes. The backups
-- get no read policy — nothing browses them, and the recovery path runs with
-- the service key.
alter table public.draft_live_state enable row level security;
alter table public.draft_live_backups enable row level security;

create policy draft_live_state_read on public.draft_live_state
  for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.draft_live_state
  from anon, authenticated;
revoke all on public.draft_live_backups from anon, authenticated;
