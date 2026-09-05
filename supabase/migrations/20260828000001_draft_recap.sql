-- The post-draft AI recap, saved where a deployment can actually write it.
--
-- Same reasoning as draft_live_state: the deployment's filesystem is read-only,
-- so a recap generated in production has nowhere to go but Postgres. The
-- document stored is byte-for-byte what the file store writes, so a recap can
-- be moved between the two by copying the JSON.
--
-- One row per season, replaced outright on every generation. No revision
-- column and no backup table, unlike the live board: re-generating is a button
-- press, and the league's stated preference is recovery over prevention. The
-- last write wins on purpose.

create table if not exists public.draft_recap (
  season integer primary key,
  recap jsonb not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.draft_recap is
  'One AI-written post-draft recap per season. Replaced wholesale on re-generation.';
comment on column public.draft_recap.recap is
  'A RecapDocument from src/lib/recap-types.ts — blurbs, citations and usage.';

alter table public.draft_recap enable row level security;

-- Readable by anyone who can reach the app, writable only by the service role.
-- The recap is league banter printed on a screen in a room; the draft routes
-- next to it are unauthenticated by a settled decision, and this matches them.
drop policy if exists "draft_recap read" on public.draft_recap;
create policy "draft_recap read"
  on public.draft_recap for select
  using (true);
