# FantasyPros MCP

What the FantasyPros MCP server actually exposes, how this app is authorised to
talk to it, and what happens when it cannot. Written so nobody has to rediscover
any of it.

Everything below was read off the live server on 2026-08-29 with a real grant,
not from documentation.

---

## The short version

| | |
| --- | --- |
| Endpoint | `https://api.fantasypros.com/mcp` |
| Transport | Streamable HTTP, JSON-RPC 2.0, protocol `2025-06-18` |
| Server | `FantasyPros MCP 1.29.0` |
| Authorization server | `https://secure.fantasypros.com` |
| Scopes held | `user:read offline_access` |
| Account tier | **free**, with **no synced leagues** |
| Surface | 29 tools, 6 resources, 4 resource templates, 0 prompts |
| Sign in | `npm run auth:fantasypros` — once, ever |
| Refresh the data | `npm run pull:fantasypros` |
| Check it all still works | `npm run verify:fantasypros` |

---

## Authorisation

The MCP authorization spec is OAuth 2.1 plus four RFCs, and FantasyPros
implements all of them. Nothing in `@/lib/fantasypros/oauth` is hardcoded that
discovery can answer:

1. An unauthenticated POST to the MCP endpoint returns `401` with
   `WWW-Authenticate: Bearer resource_metadata="…", scope="user:read"`.
2. That URL serves RFC 9728 protected-resource metadata, naming
   `https://secure.fantasypros.com` as the authorization server.
3. That server's RFC 8414 metadata gives the endpoints below.

```
authorization_endpoint   https://secure.fantasypros.com/oauth/authorize/
token_endpoint           https://secure.fantasypros.com/oauth/token/
registration_endpoint    https://secure.fantasypros.com/oauth/register/
jwks_uri                 https://secure.fantasypros.com/oauth/.well-known/jwks.json
scopes_supported         user:read, offline_access
grant_types_supported    authorization_code, refresh_token
code_challenge_methods   plain, S256
token_endpoint_auth      client_secret_post, client_secret_basic, none
```

Three things follow, and they are what make a server-side integration possible
at all:

- **`offline_access` is granted.** So there is a refresh token, and the app can
  reach FantasyPros from a Vercel function with no browser anywhere near it.
- **Dynamic Client Registration works.** There is no developer portal to visit;
  the auth script registers a client itself. It comes back a public client
  (`token_endpoint_auth_method: "none"`, no secret), which is why PKCE is not
  optional.
- **The `resource` parameter is sent on both the authorization request and the
  token request**, per RFC 8707 and the MCP spec's MUST. It is what stops a
  token minted for this server working at another.

### Refresh tokens rotate

**FantasyPros issues a new refresh token when you refresh.** This is measured,
not assumed — see section 1 of `verify:fantasypros`. It is the single most
important operational fact in this document, because it rules out the obvious
design: a token pasted into an environment variable cannot be rewritten by the
function that discovered the rotation, so the first rotation would silently
strand the app and the symptom would appear days later with no visible cause.

The grant therefore lives somewhere the running app can write:

| Backend | Where | When |
| --- | --- | --- |
| `database` | `fantasypros_oauth` row | whenever Supabase is configured — deployment and laptop share one grant |
| `file` | `.local/fantasypros-oauth.json`, mode `0600`, gitignored | a checkout with no Supabase keys |

Override with `FANTASYPROS_TOKEN_STORE=file|database`. The table has RLS enabled
and **no policy at all** — deliberately unlike `draft_recap` next door — so the
browser's anon key cannot read it and only the service-role key can.

### Which account is signed in, and how to change it

**The commissioner signed in with the wrong FantasyPros account once, and
nothing on screen could have told him.** The flow succeeds identically whichever
account the browser's session holds, and worse, it succeeded *silently*: without
`prompt=login` FantasyPros reused the existing session, skipped the consent
screen entirely, and would have re-issued a grant for the same wrong account on
every retry. Both the diagnosis and the fix are load-bearing.

| Command | What it is for |
| --- | --- |
| `npm run whoami:fantasypros` | Which account the app is using. Prints synced league names, subscription tier and the tools the account can reach |
| `npm run reset:fantasypros` | Dry run: what a reset would destroy |
| `npm run reset:fantasypros -- --yes` | Revoke upstream, then delete the grant from **both** stores and every `fantasypros_cache` row |
| `npm run auth:fantasypros` | Sign in. Forces a fresh login and **names the account it got** at the end |
| `npm run diff:fantasypros` | Compare the committed pull against a fresh one, value by value |

Three details in there are the ones that were learned the hard way:

- **`prompt=login` and `max_age=0` on the authorize request.** Without them the
  browser session is reused and the wrong account is re-authorised invisibly.
- **A reset must clear `fantasypros_cache`, not just the grant.** Deleting a
  credential does not delete the answers it fetched; those rows are served for
  their whole TTL and indefinitely past it whenever the upstream is unreachable
  — which is exactly when nobody is looking.
- **A reset must clear both stores.** A grant written before the migration was
  pushed lands in the file, and a laptop that afterwards prefers the database
  never looks at that file again. This actually happened: the wrong account's
  grant sat in `.local/` while the database row was empty, so production was
  never signed in to it at all.

FantasyPros discloses **no identifying claim** — `claims_supported` is `sub`
alone, so `userinfo` yields an opaque id and no email. The recognisable signal
is therefore the **list of leagues synced to the account**, which is what
`auth:fantasypros` and `whoami:fantasypros` print.

---

## The tools

29 tools, against the league's account: a **subscriber** account with six
leagues synced, including The Ultimate Keeper League itself.

> An earlier version of this table was written against a **free** account with
> no leagues synced, which was the wrong account. The correct account unlocks
> more, and `npm run whoami:fantasypros` prints the current answer rather than
> this document's remembered one. The two accounts return **byte-identical ADP
> and expert-consensus data** — measured with `npm run diff:fantasypros`, not
> assumed — so nothing that was pulled under the wrong account was wrong. The
> difference is in the tools listed as locked below.

### Available to this league now

| Tool | What it gives | Used here |
| --- | --- | --- |
| `get_adp` | Average draft position: `player_name, position, team, adp, rank, pos_rank, bye_week`. ~690 rows. `scoring` takes `STD`/`HALF`/`PPR`; `adp_type` takes `standard`/`dynasty`/`rookie`/`best_ball`. **No player id.** | **Yes — the live ADP feeding the board** |
| `get_ecr` | Expert consensus rankings: `player_id, player_name, position, team, pos_rank, rank_ecr`. ~520 rows. `ranking_type` DRAFT/WEEKLY/ROS/DYNASTY/ROOKIES, `scoring` STD/HALF/PPR. **This is the only tool that returns a player id.** | **Yes — joined to `get_adp` for ids and headshots** |
| `get_projections` | Full season projections with complete stat lines — `fpid`, `points`, `points_ppr`, `points_half`, and per-position raw stats including `pass_tds`, `rush_yds`, `rec_rec`, `def_sack`. 83 QBs, 128 RBs, 32 DSTs. | **Yes — `@/lib/fantasypros/projections`** |
| `get_player_stats` | Historical NFL stats by player, season/last-N-weeks/week-range | No |
| `get_leaders` | Stat leaderboards by category and position | No |
| `get_nfl_depth_charts` | Depth charts by team or player: `playerName, playerId, position, depth, ecrRank` | No |
| `get_schedule_and_strength` | Schedules and strength of schedule, by team and position | No |
| `injury_status` | Injury designations and recent player news. Returned empty in the offseason — worth re-checking in season | No |
| `get_player_ownership` | Whether a player is rostered across the user's synced leagues | No — needs a synced league |
| `get_leagues` / `set_active_league` / `clear_active_league_tool` / `resync_league` | League selection plumbing | No |
| `get_mlb_lineups` | MLB. Not this sport | No |

### Locked: needs a league synced to FantasyPros

These are free-tier tools that need the commissioner to sync a league at
<https://www.fantasypros.com/nfl/myplaybook/>. **`get_keeper_value` is the
interesting one** — it prices keeper decisions in draft-pick cost, which is
exactly this league's keeper economics, and it is free once a league is synced.

`get_keeper_value`, `get_league_settings`, `get_roster`, `get_current_starters`,
`get_player_comparisons`, `league_analyzer`, `matchup_analyzer`,
`get_mlb_player_ownership`, `get_streaming_pitchers`.

### Locked: paid tier

`trade_finder`, `trade_analyzer`, `waiver_finder`, `waiver_analyzer`,
`start_sit_assistant`, `mlb_waiver_finder`.

A locked tool still returns `200` with `status: "premium_required"` and an
upgrade link rather than failing, so calling one is safe.

### Resources

| URI | Contents |
| --- | --- |
| `ff://nfl/context` | `{ season, current_week }` — `current_week: 0` in the offseason |
| `ff://nfl/stat-categories` | Valid `stat` keys for `get_leaders` |
| `ff://nfl/mpb/team-codes` | NFL team codes |
| `ff://user/entitlements` | Tier, synced leagues, and which tools are accessible vs locked and why |
| `ff://user/active-league` | The session-sticky active league per sport |
| `ff://mlb/context` | MLB equivalent |

Templates: `ff://nfl/player/{player_name}` (name → FantasyPros id),
`ff://nfl/mpb/player/{player_name}`, `ff://mlb/player/{player_name}`,
`ff://user/leagues/{sport}`.

### There are no images

**No tool and no resource returns a headshot, a photo, or any image URL.** The
whole surface was searched for `image`, `headshot`, `photo`, `avatar`,
`picture`, `thumbnail` and `logo`; the only hit is the stat key
`scr`**`image`**`_yards_100`.

What does exist: `get_ecr` returns `player_id`, and FantasyPros' own CDN serves
a headshot at a URL derived from it.

```
https://images.fantasypros.com/images/players/nfl/{player_id}/headshot/250x250.png
```

`250x250`, `90x90` and `70x70` exist; `140x140` does not. A player with no
headshot **302s to a generic silhouette rather than returning 404**, so a
browser cannot tell the difference and an `<img>` would quietly show a stranger.
That is why `scripts/fantasypros-players.mjs` probes every URL at pull time and
records `headshotUrl: null` for the misses. 482 of 518 have one.

---

## Why the client is hand-rolled

`@modelcontextprotocol/sdk` was the first choice and was rejected on its
dependency graph. Its `dependencies` are unconditional and include `express`,
`hono`, `@hono/node-server`, `cors`, `express-rate-limit`, `raw-body`, `jose`,
`ajv` and `zod` — the server half of the SDK, none of which a client uses, all
of which npm installs and a Next.js function bundle then carries.

The client half of Streamable HTTP is one POST with a JSON-RPC envelope and a
reply that is either JSON or a single SSE frame. That is ~80 lines in
`@/lib/fantasypros/client`, it is a shape that has to be understood to be
operated at 8pm on a Saturday anyway, and it leaves the timeout and the 401
retry under our own control. Revisit if the transport grows a second connection
mode.

---

## Freshness, and what happens when FantasyPros is down

Four layers. The draft never depends on more than the last one.

| Layer | Where | TTL | Survives |
| --- | --- | --- | --- |
| Process memo | instance memory | 10 min | one request |
| Shared cache | `fantasypros_cache` table | 10 min, **stale rows kept on purpose** | deploys, cold starts, regions |
| Committed snapshot | `data/fantasypros-players.json` | none — refreshed by hand | everything; it ships inside the deployment |
| Smart Draft pool | `data/smartdraft-players.json` | none | everything |

**Postgres rather than Vercel's Runtime Cache**, because the requirement is not
only "avoid a round trip" but "still have Tuesday's numbers on Saturday". Runtime
Cache is per-region, best-effort and evictable; an entry evicted at the moment
the upstream goes down is exactly the case the fallback exists for. A stale row
here is never deleted at TTL — expiry decides whether to *refetch*, never
whether the row may still be served.

### The draft board does not use any of this

The board, the search and the reach/steal expectation read the **synchronous**
pool in `@/lib/smartdraft`, built from the two committed files. No render path
and no pick path awaits an API. `@/lib/fantasypros/feed` sits above that and can
only ever improve on it.

The overlay is additive: it replaces the ADP of players FantasyPros ranks and
attaches their id and headshot. It cannot add a player and cannot remove one, so
no arrangement of a stale, empty or missing snapshot can shrink the draft pool.

Proven by simulation in section 4 of `npm run verify:fantasypros`, which cuts
every request to `fantasypros.com` off at the socket and asserts the feed falls
back with a stated reason rather than throwing, and that a direct client call
fails quickly and typed rather than hanging.

### Refreshing on purpose

| | |
| --- | --- |
| `npm run pull:fantasypros` | rewrites the committed snapshot. Commit the result |
| `POST /api/fantasypros/refresh` | forces a live fetch past the TTL — the commissioner's button |
| `GET /api/fantasypros/refresh` | warms the cache if due, and reports grant, cache and snapshot status. No token in the response |
| Vercel Cron, every 6h | hits the GET. The point is less the warmth than **exercising the token refresh on a schedule, so a dead grant is found on Thursday rather than on Saturday** |

**That route is unauthenticated, and that is the decision, not an oversight.**
It sits beside the draft routes, which are unauthenticated by a settled ruling
in `.cursor/rules/how-this-ships.mdc`, and it matches them. The code will honour
`FANTASYPROS_REFRESH_SECRET` (or `CRON_SECRET`) if one is ever set, but nobody
needs to set one.

---

## For other features

### Projections — use the typed accessor

`@/lib/fantasypros/projections` is the door. It is wired to `get_projections`
with the casing and the row limit already right, and it parses the response into
types rather than handing back `unknown`.

```ts
import { getSeasonProjections, getAllSeasonProjections } from "@/lib/fantasypros/projections";

// One position.
const qb = await getSeasonProjections("QB");
//   (position: "QB" | "RB" | "WR" | "TE" | "K" | "DST",
//    options?: { season?: number; force?: boolean; ttlMs?: number; limit?: number })
//   → Promise<ProjectionSet | null>
if (!qb) return localProjections();          // nothing upstream and nothing cached
qb.players[0].stats.pass_tds;                // raw — score it at SIX points yourself
qb.source;                                   // "fresh" | "cache" | "stale"

// All six positions, one MCP session, one cache entry.
const all = await getAllSeasonProjections();
//   (options?: { season?: number; force?: boolean; ttlMs?: number })
//   → Promise<AllProjections | null>
all?.byPosition.RB;
all?.missing;                                // positions that failed; normally []
```

`ProjectedPlayer` is `{ fpId, name, team, position, stats }`, where `fpId` is the
same FantasyPros id `get_ecr` returns — so projections join to the pool and to
headshots on an id rather than on a name. TTL is 6 hours; projections move on a
scale of days.

**Use the raw stats, not `points_ppr`.** That field is FantasyPros' four-point
passing touchdown; this league pays six. The raw line is the whole reason
projections can be made league-correct when ADP cannot.

**The tool's `limit` defaults to 25.** A call without one returns the top
quarter of a position and looks like a complete answer. The accessor passes 500.

### Anything else

Use `cachedTool` from `@/lib/fantasypros/feed`. It wraps the timeout, the auth
retry, the shared cache and the fallback, and returns `null` rather than
throwing when the call fails with nothing cached — so your fallback is a null
check, not a `try`/`catch`.

```ts
import { cachedTool } from "@/lib/fantasypros/feed";

const depth = await cachedTool<DepthChartDoc>(
  "nfl:depth-charts",
  "get_nfl_depth_charts",
  {},
  { ttlMs: 60 * 60_000 },
);
if (!depth) return localDepthCharts();   // upstream down, nothing cached
depth.value;      // the payload
depth.source;     // "fresh" | "cache" | "stale"
depth.fetchedAt;  // when it was really fetched
```

Lower-level, if you need several calls in one session:

```ts
import { withFantasyPros } from "@/lib/fantasypros/client";

const rows = await withFantasyPros(async (client) => {
  const qb = await client.callTool("get_projections", { sport: "nfl", position: "QB" });
  const rb = await client.callTool("get_projections", { sport: "nfl", position: "RB" });
  return [qb, rb];
});
```

`sport` is **lowercase** `"nfl"` for `get_adp` and `get_projections`, and
**uppercase** `"NFL"` for `get_ecr`. This is not a typo; the server validates
them differently and rejects the other case.

### The scoring trap

`get_adp` defaults to `STD` and `get_ecr` defaults to `HALF`. This league is
full PPR. A pull at the wrong scope looks identical in the file and quietly
undervalues every high-volume receiver, which is the same trap
`scripts/smartdraft-players.mjs` documents. Always pass `scoring: "PPR"`, and
the scope is recorded in the snapshot so a regression is visible in the file
rather than only in the numbers.

**No FantasyPros scoring option prices in this league's 6-point passing
touchdown.** Quarterbacks are systematically cheap on any of these numbers.
That was already true of the previous ADP source; it is unchanged, not newly
wrong. For projections it *is* fixable — `get_projections` returns raw
`pass_tds`, so league-correct points can be computed rather than taken.
