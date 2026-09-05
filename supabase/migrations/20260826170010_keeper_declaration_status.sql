-- Ultimate Keeper League — tell "hasn't answered" apart from "keeping nobody".
--
-- A franchise with no keepers is currently indistinguishable from a franchise
-- that has thought about it and decided to keep nobody, because the only signal
-- available is the absence of rows. Those mean very different things to a
-- commissioner chasing declarations before Saturday, and no source file records
-- the difference: the Smart Draft room shows declared keepers, never a
-- declaration of "none".
--
-- So it is recorded here. When `keeper_declarations_closed_at` is set, that
-- franchise's keeper list is FINAL for the season and any unfilled slot is a
-- deliberate pass. Null means the answer is still outstanding.
--
-- Deliberately a timestamp rather than a boolean: knowing WHEN a manager closed
-- his list settles arguments about whether a late declaration beat the deadline.

alter table public.teams
  add column keeper_declarations_closed_at timestamptz;

comment on column public.teams.keeper_declarations_closed_at is
  'When set, this franchise''s keeper declarations are final for the season and any unfilled slot is a deliberate pass, not an outstanding answer. Null means still awaiting.';
