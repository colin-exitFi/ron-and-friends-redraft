import { NextResponse } from "next/server";

import { getLivePlayerFeed, forgetPlayerFeed } from "@/lib/fantasypros/feed";
import { grantSummary } from "@/lib/fantasypros/oauth";
import { fantasyProsOverlay } from "@/lib/fantasypros/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The FantasyPros health and refresh endpoint.
 *
 *   GET   — warms the cache if it has expired, and reports where the data
 *           currently stands. Safe to hit repeatedly: it goes through the same
 *           TTL as everything else, so it only calls upstream when a call was
 *           due. This is what the cron uses.
 *   POST  — forces a fetch regardless of TTL. This is the commissioner's
 *           "get me the current numbers" button.
 *
 * THE CRON IS NOT REALLY ABOUT WARMTH. Keeping the cache full is worth
 * something; exercising the token refresh on a schedule is worth more. A grant
 * that has been revoked or has quietly expired is a thing to discover on
 * Thursday from a failing cron, not at 8pm on Saturday with ten people waiting.
 *
 * WHICH IS WHY IT RUNS HOURLY, AND WHY THE HOUR IS NOT AN ARBITRARY NUMBER.
 * The access token FantasyPros mints lives exactly 3600 seconds — measured from
 * the stored grant, whose `accessTokenExpiresAt` lands one hour to the
 * millisecond after the `updatedAt` that wrote it. Hourly is therefore the
 * fastest cadence at which every single run finds the cached token spent and
 * has to make a real `refresh_token` round trip to the token endpoint. That
 * round trip is the whole point: it is the only thing that can tell us the
 * grant is still alive.
 *
 * SO DO NOT "IMPROVE" THIS TO EVERY FIFTEEN MINUTES. A run inside the token's
 * hour is served by `getAccessToken()` from cache, never reaches FantasyPros,
 * and proves nothing about the grant — four times the invocations for the same
 * one useful signal per hour. The token lifetime is the floor, not the plan.
 *
 * AND THE CRON IS NOT WHAT KEEPS THE TOKEN ALIVE. `getAccessToken()` refreshes
 * lazily, a minute before expiry, on whatever request happens to need a token,
 * so the integration would survive this cron being deleted. What the cadence
 * actually buys is a bound on how long a revoked or dead grant can sit
 * undiscovered. Daily made that bound 24 hours, which is longer than the gap
 * between noticing and needing it on a draft night; hourly makes it one.
 *
 * The schedule was daily for a plan reason that no longer applies. A Hobby team
 * refuses any cron more frequent than daily, and refuses it by declining to
 * CREATE the deployment — three seconds after the push, before a build, with
 * nothing in the deployment list to look at. A six-hourly schedule here did
 * exactly that: `main` stopped reaching production and sat two hours stale
 * while every further push failed the same silent way. This project now deploys
 * from a Pro team, where per-minute crons are legal, so that constraint is
 * gone. If a push ever fails again three seconds in with no build, suspect this
 * line first — but the fix is to check the plan, not to assume daily.
 * `vercel.json` is strict JSON and cannot hold this note, so it lives here.
 *
 * NOTHING HERE CAN BREAK THE DRAFT. It touches only the FantasyPros cache; the
 * board, the pool and the pick path read the committed snapshot and never call
 * this. A failure returns 200 with `ok: false` and an explanation rather than
 * an error status, because the honest answer to "is FantasyPros reachable" is
 * data, not a 500.
 *
 * No token, and no part of one, is ever in the response.
 */

/**
 * The routes next to this one are unauthenticated by a settled decision, so a
 * secret is optional here too. It exists because this one can be made to call
 * an external API, and a scheduled job wants a way to identify itself. Set
 * FANTASYPROS_REFRESH_SECRET (or Vercel's own CRON_SECRET) to turn it on.
 */
function authorized(request: Request): boolean {
  const expected = process.env.FANTASYPROS_REFRESH_SECRET ?? process.env.CRON_SECRET;
  if (!expected) return true;
  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
  const query = new URL(request.url).searchParams.get("secret");
  return bearer === expected || query === expected;
}

async function report(force: boolean) {
  if (force) forgetPlayerFeed();

  const [feed, grant] = await Promise.all([getLivePlayerFeed({ force }), grantSummary()]);
  const snapshot = fantasyProsOverlay();

  const live = feed.source === "fresh" || feed.source === "cache";
  return NextResponse.json({
    ok: live,
    source: feed.source,
    reason: feed.reason ?? null,
    fetchedAt: feed.fetchedAt,
    scoring: feed.scoring,
    players: feed.players.length,
    /** Whether a grant exists and what it is scoped to. Never the token itself. */
    grant: {
      present: grant.present,
      issuer: grant.issuer,
      scope: grant.scope,
      /** When the grant was last written — a refresh rewrites it, so this moves. */
      updatedAt: grant.updatedAt,
    },
    /** The floor. This is what the draft board is actually reading. */
    snapshot: snapshot
      ? {
          fetchedAt: snapshot.fetchedAt,
          scoring: snapshot.scoring,
          adpType: snapshot.adpType,
          players: snapshot.total,
          withHeadshot: snapshot.withHeadshot,
        }
      : null,
  });
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });
  }
  return report(false);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 401 });
  }
  return report(true);
}
