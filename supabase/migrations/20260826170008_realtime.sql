-- Ultimate Keeper League — Realtime publication.
--
-- The draft is called aloud in one room, but everyone is also watching on a
-- phone. These are the tables whose changes have to reach those phones without
-- a refresh; `src/components/realtime-refresher.tsx` subscribes to them.
--
-- Guarded, because the `supabase_realtime` publication is created by the
-- Supabase platform. On a plain local Postgres it does not exist, and these
-- migrations are meant to apply cleanly there too.

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
    'commissioner_actions'
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
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', t);
    end if;
  end loop;
end $$;

-- Realtime sends the primary key on a DELETE unless the table replicates its
-- full old row. The board needs to know WHICH pick changed, and for updates the
-- previous owner, so replicate everything on the board tables.
alter table public.draft_slots replica identity full;
alter table public.pick_ownership replica identity full;
alter table public.keepers replica identity full;
