-- Ultimate Keeper League — officers, motions, votes, and the decisions log.
--
-- This league has no ratified constitution, so the thresholds live in
-- `src/lib/league-config.ts` and are marked as placeholders there. What this
-- schema gives the league is somewhere to run the offseason rules agenda in
-- `data/DECISIONS.md` as actual motions with recorded votes: the
-- trade-and-reset loophole, handshake trades, single-season pick trades, and a
-- ratification requirement for anything touching keeper eligibility.

create table public.officers (
  id uuid primary key default gen_random_uuid(),
  season int not null references public.leagues (season) on delete cascade,
  role officer_role not null,
  team_id uuid references public.teams (id) on delete set null,
  manager text,
  since date,
  status officer_status not null default 'active',
  created_at timestamptz not null default now()
);

-- One holder per role per season.
create unique index officers_role_per_season
  on public.officers (season, role)
  where status <> 'removed';

create table public.motions (
  id uuid primary key default gen_random_uuid(),
  season int not null references public.leagues (season) on delete cascade,

  -- Free text rather than an enum: the motion presets in
  -- `src/lib/governance-rules.ts` are defaults offered in the UI, not a closed
  -- set the league has agreed to.
  type text not null check (length(btrim(type)) > 0),

  proposer_team uuid references public.teams (id) on delete set null,
  seconded_by_team uuid references public.teams (id) on delete set null,
  status motion_status not null default 'proposed',
  threshold motion_threshold not null default 'simple_majority',
  discussion_opens timestamptz,
  discussion_closes timestamptz,
  effective_date date,
  documentation text,
  created_at timestamptz not null default now(),

  -- A manager cannot second his own motion.
  constraint motions_seconder_differs check (
    seconded_by_team is null
    or proposer_team is null
    or seconded_by_team <> proposer_team
  )
);

create index motions_season_idx on public.motions (season, created_at desc);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  motion_id uuid not null references public.motions (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  choice vote_choice not null,
  cast_at timestamptz not null default now(),

  -- One franchise, one vote. Changing your mind updates the row.
  unique (motion_id, team_id)
);

-- The decisions log. Every commissioner ruling in `data/DECISIONS.md` belongs
-- here so the league can see what was decided unilaterally and why.
create table public.commissioner_actions (
  id uuid primary key default gen_random_uuid(),
  season int not null references public.leagues (season) on delete cascade,
  type text not null check (length(btrim(type)) > 0),
  description text,
  disclosure_note text,
  related_id uuid,
  source_ref text,
  created_at timestamptz not null default now()
);

create unique index commissioner_actions_source_ref_unique
  on public.commissioner_actions (season, source_ref)
  where source_ref is not null;

create index commissioner_actions_season_idx
  on public.commissioner_actions (season, created_at desc);
