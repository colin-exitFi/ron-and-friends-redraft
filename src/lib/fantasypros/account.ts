import "server-only";

import { FantasyProsError, withFantasyPros, type FantasyProsClient } from "@/lib/fantasypros/client";
import { identifyAccount, type AccountIdentity } from "@/lib/fantasypros/oauth";
import { tokenStore } from "@/lib/fantasypros/token-store";

/**
 * WHICH FantasyPros account is signed in, and what it is entitled to see.
 *
 * WHY THIS EXISTS. The commissioner signed in with the wrong FantasyPros
 * account. Nothing in the sign-in could have told him: the flow succeeds
 * identically whichever account the browser's session happens to hold, and the
 * console said "Done" either way. He had to take it on faith, and faith was
 * wrong.
 *
 * The obvious answer — read an email out of `userinfo` — is not available here.
 * `secure.fantasypros.com` advertises exactly one claim, `sub`, so userinfo
 * returns an opaque identifier and nothing a human recognises. So the account
 * is described instead by things a human CAN check against his own
 * expectations: the subscription tier, the names of any leagues synced to the
 * account, and the stable subject id, which at minimum proves that this
 * sign-in produced a DIFFERENT account from the last one.
 */

/** How a tool answered. The distinction is the entitlement signal. */
export type ToolAccess = "ok" | "needs-args" | "needs-league" | "paid" | "unavailable" | "error";

export type ToolProbe = {
  tool: string;
  access: ToolAccess;
  /** Rows returned when `ok`, so an empty-but-permitted answer is visible. */
  rows: number | null;
  detail: string | null;
};

/**
 * The tools whose availability actually changes what this app can do.
 *
 * `get_projections` is first because its answer decides whether projected
 * standings can be computed from FantasyPros at all. `trade_analyzer` is the
 * tier probe: it is subscriber-only, so how it refuses tells us which tier
 * this account is on without needing a billing API.
 */
const PROBES: { tool: string; args: Record<string, unknown> }[] = [
  { tool: "get_projections", args: { sport: "nfl", position: "QB", limit: 5 } },
  { tool: "get_adp", args: { sport: "nfl", adp_type: "standard", scoring: "PPR", limit: 5 } },
  { tool: "get_ecr", args: { sport: "NFL", ranking_type: "DRAFT", scoring: "PPR", limit: 5 } },
  { tool: "get_leagues", args: {} },
  { tool: "get_keeper_value", args: {} },
  { tool: "trade_analyzer", args: {} },
];

/** Counts rows in whichever envelope a tool happens to use. */
function rowCount(payload: unknown): number | null {
  if (Array.isArray(payload)) return payload.length;
  if (!payload || typeof payload !== "object") return null;
  for (const value of Object.values(payload as Record<string, unknown>)) {
    if (Array.isArray(value)) return value.length;
  }
  return null;
}

/**
 * Reads an entitlement out of a refusal.
 *
 * FantasyPros returns a premium gate as a SUCCESSFUL tool call whose content is
 * an error message, so the wording is the only signal there is.
 */
function classify(message: string): ToolAccess {
  const m = message.toLowerCase();
  // Argument validation is not an entitlement. These probes call each tool with
  // the minimum that might work, so a tool with a required argument this module
  // does not know how to supply refuses on the arguments — which means the
  // account CAN reach it. Reporting that as an error reads as "broken" and is
  // the opposite of the truth.
  if (/validation error|field required|missing|invalid|required property/.test(m)) {
    return "needs-args";
  }
  if (/no league|sync|set_active_league|active league|myplaybook/.test(m)) return "needs-league";
  if (/subscri|premium|upgrade|paid|not entitled|plan|mvp/.test(m)) return "paid";
  if (/unknown tool|not found|no such tool/.test(m)) return "unavailable";
  return "error";
}

export async function probeTools(client: FantasyProsClient): Promise<ToolProbe[]> {
  const available = new Set((await client.listTools()).map((t) => t.name));
  const probes: ToolProbe[] = [];

  for (const { tool, args } of PROBES) {
    if (!available.has(tool)) {
      probes.push({ tool, access: "unavailable", rows: null, detail: "not in tools/list" });
      continue;
    }
    try {
      const payload = await client.callTool(tool, args);
      probes.push({ tool, access: "ok", rows: rowCount(payload), detail: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const access =
        err instanceof FantasyProsError && err.kind === "tool" ? classify(message) : "error";
      probes.push({ tool, access, rows: null, detail: message.slice(0, 240) });
    }
  }

  return probes;
}

export type AccountDescription = {
  identity: AccountIdentity;
  /** Where the grant was read from, so a laptop-only grant is obvious. */
  store: string;
  server: { name: string; version: string } | null;
  toolCount: number;
  probes: ToolProbe[];
  /** Derived from how the subscriber-only probe refused. */
  tier: "subscriber" | "free" | "unknown";
  /** Names of leagues synced to this account — the most human-legible signal. */
  leagues: string[];
};

/** Pulls league names out of whatever envelope `get_leagues` used. */
function leagueNames(payload: unknown): string[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? (Object.values(payload as Record<string, unknown>).find(Array.isArray) as unknown[]) ?? []
      : [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as Record<string, unknown>;
      const name = r.league_name ?? r.name ?? r.leagueName;
      return typeof name === "string" ? name : null;
    })
    .filter((name): name is string => name !== null);
}

/**
 * Everything about the signed-in account that a human could use to recognise
 * it, in one MCP session.
 */
export async function describeAccount(): Promise<AccountDescription> {
  const identity = await identifyAccount();
  const store = tokenStore.location();

  return withFantasyPros(
    async (client) => {
      const tools = await client.listTools();
      const probes = await probeTools(client);

      const paid = probes.find((p) => p.tool === "trade_analyzer");
      const tier =
        paid?.access === "ok" ? "subscriber" : paid?.access === "paid" ? "free" : "unknown";

      let leagues: string[] = [];
      if (probes.find((p) => p.tool === "get_leagues")?.access === "ok") {
        leagues = await client
          .callTool("get_leagues", {})
          .then(leagueNames)
          .catch(() => []);
      }

      return {
        identity,
        store,
        server: client.server(),
        toolCount: tools.length,
        probes,
        tier,
        leagues,
      };
    },
    { timeoutMs: 30_000 },
  );
}

/**
 * The block `auth:fantasypros` prints after a successful sign-in, and what
 * `whoami:fantasypros` prints on demand.
 *
 * Returned as lines rather than printed so both callers format identically —
 * the point is that the commissioner sees the SAME description in both places
 * and can compare them.
 */
export function describeAccountLines(account: AccountDescription): string[] {
  const lines: string[] = [];
  // Leagues first: it is the only line on this list a human recognises at a
  // glance, and recognising it is the entire point of the block.
  lines.push(
    `  synced leagues   ${account.leagues.length ? account.leagues.join(", ") : "none"}`,
  );
  lines.push(`  subscription     ${account.tier}`);
  lines.push(`  account id       ${account.identity.subject ?? "not disclosed by FantasyPros"}`);
  lines.push(`  scope granted    ${account.identity.scope ?? "unstated"}`);
  lines.push(`  tools offered    ${account.toolCount}`);
  lines.push(`  grant stored in  ${account.store}`);
  lines.push("");
  for (const probe of account.probes) {
    const rows = probe.rows !== null ? ` (${probe.rows} rows)` : "";
    const note =
      probe.access === "needs-args" ? "  (reachable — this probe just did not supply its arguments)" : "";
    lines.push(`  ${probe.tool.padEnd(17)}${probe.access}${rows}${note}`);
    // A refusal is only useful if its reason is visible; "error" on its own
    // sends the reader back to the server to find out what happened.
    if (probe.access === "error" && probe.detail) {
      lines.push(`  ${" ".repeat(17)}↳ ${probe.detail.replace(/\s+/g, " ")}`);
    }
  }
  return lines;
}
