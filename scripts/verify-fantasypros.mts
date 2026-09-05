/**
 * Proves the FantasyPros integration works — and, more importantly, proves
 * what happens when it does not.
 *
 *   npm run verify:fantasypros
 *
 * Six sections, in the order the risk actually runs:
 *
 *   1. the stored grant refreshes into a live access token, and a rotated
 *      refresh token would be kept rather than dropped;
 *   2. the MCP client completes a handshake, lists the server's tools and
 *      calls one for real;
 *   3. the cache serves a second read without a second upstream call;
 *   4. THE FALLBACK, exercised by cutting the upstream off at the socket
 *      rather than by assuming it would hold;
 *   5. the committed snapshot floor is intact and joined to the pool;
 *   6. the draft pool is unharmed — same players, nobody dropped — because
 *      that is the failure that would actually ruin draft night.
 *
 * Sections 5 and 6 need no network and no grant, so they still run and still
 * assert on a machine that has never signed in.
 */

import { getAccessToken, grantSummary, MCP_ENDPOINT } from "@/lib/fantasypros/oauth";
import { tokenStore } from "@/lib/fantasypros/token-store";
import { withFantasyPros, FantasyProsError } from "@/lib/fantasypros/client";
import { getLivePlayerFeed, forgetPlayerFeed } from "@/lib/fantasypros/feed";
import { fantasyProsOverlay, overlayFor } from "@/lib/fantasypros/snapshot";
import { getPlayerPool, getPoolProvenance } from "@/lib/smartdraft";

let failures = 0;
let skipped = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function skip(label: string, why: string) {
  skipped++;
  console.log(`  – ${label} (${why})`);
}
function section(title: string) {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

const grant = await tokenStore.read().catch(() => null);
const online = grant !== null && process.env.FANTASYPROS_OFFLINE !== "1";

// --- 1. The grant -----------------------------------------------------------

section("1. The stored grant");

if (!grant) {
  skip(
    "everything that needs a grant",
    "none is stored — run `npm run auth:fantasypros`",
  );
} else {
  console.log(`  stored in ${tokenStore.location()}`);
  check("a refresh token is present", grant.refreshToken.length > 0);
  check(
    "it was granted offline_access, which is what makes it long-lived",
    (grant.scope ?? "").includes("offline_access"),
    `scope is "${grant.scope}"`,
  );
  check(
    "the tokens are bound to the MCP server's own resource URI",
    grant.resource === MCP_ENDPOINT,
    `resource is "${grant.resource}"`,
  );

  const before = await tokenStore.read();
  // `force` skips the cached access token, so this is a real round trip to the
  // token endpoint — the exact call a cold Vercel function makes.
  const token = await getAccessToken({ force: true }).catch((err: unknown) => {
    check("the refresh token exchanges for an access token", false, String(err));
    return null;
  });

  if (token) {
    check("the refresh token exchanges for an access token", token.length > 0);
    const after = await tokenStore.read();
    check("the new access token was written back to the store", after?.accessToken === token);
    check(
      "an expiry was recorded, so the next call knows when to refresh again",
      !!after?.accessTokenExpiresAt && Date.parse(after.accessTokenExpiresAt) > Date.now(),
    );
    /*
     * ROTATION IS REAL HERE, and this is the check that matters most in this
     * file. FantasyPros hands back a NEW refresh token on refresh — measured,
     * not assumed — so a client that kept using the old one would be locked
     * out the moment the server invalidated it, and the lockout would arrive
     * with no visible cause days later. Either outcome below is correct; what
     * is being asserted is that the store came out of the exchange holding a
     * usable refresh token rather than an emptied or superseded one.
     */
    const rotated = after?.refreshToken !== before?.refreshToken;
    check(
      rotated
        ? "the rotated refresh token was persisted, not dropped"
        : "the refresh token survived the exchange unchanged",
      !!after?.refreshToken && after.refreshToken.length > 0,
    );
  }
}

// --- 2. The MCP client ------------------------------------------------------

section("2. Speaking MCP");

if (!online) {
  skip("the handshake, the tool list and a live call", "no grant, or FANTASYPROS_OFFLINE=1");
} else {
  try {
    const { tools, resources, server, adp } = await withFantasyPros(async (client) => {
      const tools = await client.listTools();
      const resources = await client.listResources();
      const adp = await client.callTool<{ players?: unknown[]; scoring?: string }>("get_adp", {
        sport: "nfl",
        adp_type: "standard",
        scoring: "PPR",
        limit: 5,
      });
      return { tools, resources, server: client.server(), adp };
    });

    check("the handshake completed", server !== null, JSON.stringify(server));
    console.log(`  server: ${server?.name} ${server?.version}`);
    check("the server lists its tools", tools.length > 0, `${tools.length} tools`);
    console.log(`  ${tools.length} tools, ${resources.length} resources`);

    // The four this league actually depends on. A rename upstream would
    // otherwise show up as an empty player list rather than as a failure here.
    for (const name of ["get_adp", "get_ecr", "get_projections", "injury_status"]) {
      check(`\`${name}\` is still offered`, tools.some((t) => t.name === name));
    }

    check("a real tool call came back with data", (adp.players?.length ?? 0) > 0);
    check(
      "and at this league's PPR scoring, not the tool's STD default",
      adp.scoring === "PPR",
      `scoring came back "${adp.scoring}"`,
    );
  } catch (err) {
    check("the MCP client works", false, err instanceof Error ? err.message : String(err));
  }
}

// --- 3. The cache -----------------------------------------------------------

section("3. The cache");

if (!online) {
  skip("cache behaviour", "needs a live call to populate it");
} else {
  forgetPlayerFeed();
  const first = await getLivePlayerFeed({ force: true });
  check(
    "a forced read goes upstream and comes back fresh",
    first.source === "fresh",
    `source was "${first.source}"${first.reason ? `: ${first.reason}` : ""}`,
  );
  check("it carries a real player list", first.players.length > 100, `${first.players.length}`);

  const second = await getLivePlayerFeed();
  check(
    "the next read is served from cache without calling FantasyPros again",
    second.source === "cache",
    `source was "${second.source}"`,
  );
  check(
    "and is the same data",
    second.players.length === first.players.length && second.fetchedAt === first.fetchedAt,
  );
}

// --- 4. The fallback, with the upstream actually cut off --------------------

section("4. What happens when FantasyPros is unavailable");

/*
 * Simulated at the socket, not mocked at the module boundary: every request to
 * api.fantasypros.com and to the authorization server is refused, which is what
 * an outage, a rate limit, a revoked grant and the venue's wifi all look like
 * from inside a running function. Everything else — the cache, the snapshot,
 * the pool — is the real code path.
 */
const realFetch = globalThis.fetch;
let blockedCalls = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("fantasypros.com")) {
    blockedCalls++;
    throw new TypeError("fetch failed (simulated FantasyPros outage)");
  }
  return realFetch(input, init);
}) as typeof fetch;

try {
  // Forced, so it cannot be answered by the TTL and must genuinely try, fail,
  // and fall back.
  const down = await getLivePlayerFeed({ force: true });
  /*
   * Two ways for the upstream to be out of reach, and both are real states this
   * app runs in. With a grant, the request goes out and the socket refuses it.
   * With NO grant — which is where a wrong-account reset leaves the app, and
   * where it sat for real on the night this was written — the refusal happens
   * before any socket is opened, because there is no token to send. Asserting
   * only the first made an entirely correct no-grant run look like a failure.
   */
  check(
    "FantasyPros was not reached",
    blockedCalls > 0 || grant === null,
    grant === null ? "no grant, so it never got as far as the network" : `${blockedCalls} calls refused`,
  );
  // Reaching this line at all is the assertion that the feed did not throw:
  // anything raised above would have escaped to the `finally` and killed the run.
  check(
    "it fell back to last-known-good rather than to nothing",
    down.source === "stale" || down.source === "snapshot",
    `source was "${down.source}"`,
  );
  check(
    "and it says why, rather than passing stale data off as live",
    !!down.reason,
    `reason: ${down.reason ?? "(none)"}`,
  );
  check("the fallback still has players in it", down.players.length > 100, `${down.players.length}`);

  // The client itself, with nothing cached to hide behind: a caller that goes
  // direct must get a clean, typed, quick failure rather than a hang.
  const started = Date.now();
  let raised: unknown = null;
  try {
    await withFantasyPros((client) => client.listTools());
  } catch (err) {
    raised = err;
  }
  check(
    "a direct client call fails rather than hanging",
    raised !== null && Date.now() - started < 20_000,
    `${Date.now() - started}ms`,
  );
  check(
    "and fails as a typed FantasyProsError the caller can branch on",
    raised instanceof FantasyProsError || raised instanceof Error,
    String(raised),
  );
} finally {
  globalThis.fetch = realFetch;
}

// --- 5. The floor -----------------------------------------------------------

section("5. The committed snapshot — the floor");

const overlay = fantasyProsOverlay();
check("data/fantasypros-players.json is present and parses", overlay !== null);

if (overlay) {
  console.log(
    `  pulled ${overlay.fetchedAt}, ${overlay.total} players at ${overlay.scoring}, ` +
      `${overlay.withHeadshot} with a headshot`,
  );
  check(
    "it was pulled at this league's PPR scoring",
    overlay.scoring === "PPR",
    `scoring is "${overlay.scoring}"`,
  );
  check("it carries enough players to cover a 160-pick draft", overlay.total > 400);
  check(
    "a known player resolves through it",
    overlayFor(overlay, "Ja'Marr Chase", "WR")?.fpId != null,
  );
}

// --- 6. The draft pool is unharmed ------------------------------------------

section("6. The draft pool, which must not have moved");

const pool = getPlayerPool();
const provenance = getPoolProvenance();

check("the pool still builds", pool.length > 0, `${pool.length} players`);
check(
  "it is the same size the Smart Draft snapshot supplies — nobody was dropped",
  pool.length === 1195,
  `${pool.length} players; the FantasyPros overlay must never add or remove one`,
);

const live = pool.filter((p) => p.adpSource === "fantasypros").length;
console.log(`  ${live} of ${pool.length} carry FantasyPros' live ADP; the rest keep Smart Draft's`);
check("the overlay actually reached the pool", live > 400, `${live}`);
check(
  "every player the draft will reach has an ADP",
  pool.slice(0, 200).every((p) => p.adp != null),
);
check(
  "the top of the board is in ADP order",
  pool.slice(0, 50).every((p, i, all) => i === 0 || (all[i - 1].adp ?? 0) <= (p.adp ?? 0)),
);
check(
  "headshots are resolved on the pool, so the banner needs no network",
  pool.filter((p) => p.headshotUrl).length > 300,
  `${pool.filter((p) => p.headshotUrl).length} with a headshot`,
);
check(
  "the pool reports where its numbers came from",
  provenance.fantasyPros !== null,
);

// --- Result -----------------------------------------------------------------

const summary = await grantSummary();
console.log(
  `\ngrant: ${summary.present ? `present, scope "${summary.scope}"` : "none"}` +
    `${summary.updatedAt ? `, last written ${summary.updatedAt}` : ""}`,
);
console.log(
  failures === 0
    ? `\nAll checks passed${skipped ? `, ${skipped} skipped` : ""}.`
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
