-- Ultimate Keeper League — publish the live board so remote managers see picks.
--
-- ============================================================================
-- THIS REVERSES A DECISION IN 20260826170013, ON PURPOSE
-- ============================================================================
-- That migration left `draft_live_state` out of the publication, and gave a
-- good reason:
--
--   "Not published to supabase_realtime. The draft board holds its own state
--    and a router.refresh() underneath a half-typed player name would take the
--    keystrokes with it."
--
-- The reason was sound and the conclusion no longer follows, because the
-- premise changed twice.
--
--   1. The draft is no longer one operator at one keyboard. Two managers join
--      the deployed board from elsewhere and enter their own picks, so a board
--      that only updates when YOU type is a board showing three different
--      drafts in three rooms.
--
--   2. `router.refresh()` is not how the board takes an update any more.
--      `draft-board.tsx` re-fetches `/api/draft/state` and calls `setView`,
--      which replaces the BOARD data only. The search box, the aimed cell and
--      the half-typed name live in separate state and are untouched. The
--      hazard that justified the exclusion is gone; the need it was protecting
--      against is what remains.
--
-- ============================================================================
-- WHY A COLUMN LIST
-- ============================================================================
-- `state` is the entire draft as one JSON document — every pick, growing all
-- night. Publishing it would push a full copy of the draft to every connected
-- phone on every single pick, and then the client would re-fetch the board
-- anyway, so the big column would be paid for twice and read never.
--
-- The client only needs to learn THAT the board moved; it goes and gets the
-- authoritative view itself through the API, which applies the same assembly
-- every other screen uses. So publish the notification, not the payload.
--
-- Column lists in publications require Postgres 15. Supabase is well past it.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice
      'No supabase_realtime publication — skipping. Expected on a plain local Postgres.';
    return;
  end if;

  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'draft_live_state'
  ) then
    -- Already published, possibly without the column list. Drop and re-add so
    -- re-running this lands the narrow form either way.
    execute 'alter publication supabase_realtime drop table public.draft_live_state;';
  end if;

  execute
    'alter publication supabase_realtime '
    'add table public.draft_live_state (season, revision, updated_at);';
end $$;

-- Replica identity stays DEFAULT, unlike the board tables in 20260826170008.
--
-- Those set `full` because a subscriber needs the OLD row to know which cell
-- changed hands. Here nothing reads the payload at all — an event on the season
-- row is the whole message — and `full` on a table holding the entire draft as
-- jsonb would replicate that document on every update for a client that
-- discards it. `season` is the primary key, so DEFAULT already identifies the
-- row.
