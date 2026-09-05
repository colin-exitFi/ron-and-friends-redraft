-- Ultimate Keeper League — row level security.
--
-- Same access model as the source league, because it is the right one for a
-- ten-man league with no login:
--
--   * Managers browsing on their phones use the browser anon key -> READ ONLY.
--   * Every write goes through a server route holding the service-role key,
--     which bypasses RLS entirely.
--
-- So RLS is on everywhere and the anon/authenticated roles are granted nothing
-- but SELECT. Supabase Realtime works off SELECT, so the draft board still
-- pushes updates to every phone in the room.
--
-- If per-manager passcodes ever land, replace the blanket read policies with
-- row-scoped ones rather than loosening the write side.

do $$
declare
  t text;
  tbls text[] := array[
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
    'commissioner_actions'
  ];
begin
  foreach t in array tbls loop
    execute format('alter table public.%I enable row level security;', t);

    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true);',
      t || '_read', t
    );

    -- Belt and braces. RLS with only a SELECT policy already blocks writes, but
    -- Supabase grants ALL on public tables to these roles by default, so taking
    -- the grant away means a policy added carelessly later cannot turn into a
    -- write hole.
    execute format(
      'revoke insert, update, delete, truncate on public.%I from anon, authenticated;',
      t
    );
  end loop;
end $$;
