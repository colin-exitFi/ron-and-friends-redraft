-- Ultimate Keeper League — publish `draft_live_state` whole.
--
-- Reverts the column list added by 20260827000001, which restricted the
-- publication to `(season, revision, updated_at)` so that the entire draft
-- document would not be pushed to every phone on every pick.
--
-- ============================================================================
-- THE REASON THIS WAS WRITTEN WAS WRONG. THE CHANGE STANDS ANYWAY.
-- ============================================================================
-- It was written because `scripts/verify-draft-realtime.mjs` reported that no
-- change event ever arrived, and the column list — being the unusual thing about
-- this publication — was blamed. That conclusion was recorded here as fact:
-- "Supabase Realtime does not appear to emit for a publication whose table has a
-- column list." It is not established, and this migration is not evidence for
-- it.
--
-- The actual fault was in the test. It wrote the moment the channel reported
-- SUBSCRIBED, and delivery needs one thing more to have happened first: Realtime
-- records the subscription in `realtime.subscription`, and the replication
-- pipeline only matches WAL records against it once that row is committed. A
-- write inside that window is never matched, so the script reported silence and
-- the silence was read as a broken publication. Adding a three-second settle to
-- the script makes events arrive with the column list dropped OR present; the
-- publication was never the variable. See the comment on that wait.
--
-- ============================================================================
-- WHY IT IS NOT REVERTED BACK
-- ============================================================================
-- Because publishing whole is cheap enough that the narrow form is not worth a
-- third migration and another round of verification on the week of the draft.
-- `state` is one JSON document of the picks typed so far — 0.1 KB empty, and a
-- full 160-pick draft projects to well under 30 KB, far inside the payload
-- limit. Each connected board receives it once per pick and then re-fetches
-- `/api/draft/state` for the assembled view anyway, so the document is ignored
-- on arrival. Wasteful in principle, immaterial in practice.
--
-- What matters is that the next person to want the narrow form knows the door
-- was never actually shown to be locked.

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
    execute 'alter publication supabase_realtime drop table public.draft_live_state;';
  end if;

  execute 'alter publication supabase_realtime add table public.draft_live_state;';
end $$;
