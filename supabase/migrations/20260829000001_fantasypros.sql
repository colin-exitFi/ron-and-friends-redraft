-- FantasyPros: the OAuth grant, and the last-known-good copy of what it fetched.
--
-- Two tables, for the same reason draft_live_state exists: a deployment has no
-- writable disk, and both of these have to survive one. The refresh token in
-- particular must survive a REDEPLOY — if it lived in an environment variable,
-- every rotation would need a push, and a push to main is a production release.
-- A row can be rewritten by a running function; an env var cannot.
--
-- NEITHER TABLE GETS A READ POLICY. The recap table next door is readable by
-- anyone who can reach the app because it is league banter printed on a screen.
-- This one holds a credential that grants access to the commissioner's
-- FantasyPros account, so RLS is enabled and left with no policy at all: the
-- anon key the browser carries can reach neither table, and only the
-- service-role key — which never leaves the server — can.

create table if not exists public.fantasypros_oauth (
  -- One grant, so one row. A fixed key rather than a sequence, so an upsert
  -- from the auth script and an upsert from a token rotation touch the same
  -- row without either needing to know the other happened.
  id text primary key default 'fantasypros',
  issuer text not null,
  -- The RFC 8707 canonical resource URI the tokens are bound to. Stored so a
  -- refresh sends the same value the grant was issued for; a token minted for
  -- one resource is not valid at another.
  resource text not null,
  client_id text not null,
  -- Null for a public client. FantasyPros registers this app with
  -- token_endpoint_auth_method "none", so it is expected to stay null.
  client_secret text,
  refresh_token text not null,
  scope text,
  -- Cached so a warm process does not spend a round trip on the token endpoint
  -- before every call. Not the credential that matters; the refresh token is.
  access_token text,
  access_token_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.fantasypros_oauth is
  'The single FantasyPros MCP OAuth grant. SECRET — service role only, no read policy.';
comment on column public.fantasypros_oauth.refresh_token is
  'Long-lived credential. Rotated in place when FantasyPros issues a new one.';

alter table public.fantasypros_oauth enable row level security;
-- Deliberately no policy. See the header.

-- Last-known-good payloads from the MCP server, keyed by call.
--
-- This is the CACHE, not the floor. The floor is the committed snapshot in
-- data/ that ships with the deployment. This table sits between them: fresher
-- than the snapshot, and still present when FantasyPros is not — which is the
-- case that matters, since the draft is run off a projector in a room and an
-- upstream outage must degrade to stale numbers rather than to an error page.
--
-- Shared across every instance and every region, and it survives a deploy, so
-- the cron warmer's fetch is still there for the first request after a push.

create table if not exists public.fantasypros_cache (
  key text primary key,
  payload jsonb not null,
  -- When the upstream call that produced this actually succeeded. TTL is
  -- computed from it at read time rather than being enforced by a delete, so an
  -- expired row is still available as the fallback.
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fantasypros_cache is
  'Last-known-good FantasyPros responses. Stale rows are kept on purpose: they are the fallback.';

alter table public.fantasypros_cache enable row level security;
-- Also no policy: these payloads are served to the browser only after the
-- server has shaped them, and there is no reason for the anon key to read raw.
