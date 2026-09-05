/**
 * Apply `supabase/redraft-schema.sql` to the Ron & Friends project.
 *
 *   npm run db:apply:redraft            # apply
 *   npm run db:apply:redraft -- --dry   # print the plan and connect, write nothing
 *
 * ============================================================================
 * WHY NOT `supabase db push`
 * ============================================================================
 * The `opxyeajywipsitwecgcz` project already has a migration ledger in
 * `supabase_migrations.schema_migrations`, and it belongs to
 * ../RonAndFriendsApp — twelve versions, none of which exist as files in this
 * repo. `supabase db push` from here would insert this repo's versions into
 * that shared ledger, and RonAndFriendsApp would then refuse to push again:
 * it would see remote versions with no local migration files. So this repo
 * never runs `db push` or `supabase link`, and applies its schema directly
 * instead. The script is idempotent, so re-applying is free.
 *
 * ============================================================================
 * THE TWO REFUSALS
 * ============================================================================
 * 1. It will not connect to `xqhkhcmphvytoibjewqi`. That is Ultimate Keeper
 *    League production and it holds a real completed draft. This repo is a copy
 *    of that app, so a stale `.env.local` pointing back at it is the single most
 *    likely way this script gets aimed at the wrong database — the tree
 *    genuinely shipped that way. Hardcoded, not configurable.
 *
 * 2. It will not run a SQL file containing an unqualified `create table`. Every
 *    object in the schema script must be `redraft.`-qualified, because an
 *    unqualified one lands in `public` — where the live R&F app keeps
 *    ballot_votes, the treasury ledger and fourteen tables whose names collide
 *    with this repo's. That check is cheap and the failure it prevents is not
 *    recoverable in an afternoon.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { DB_SCHEMA } from "../src/lib/db-schema.mjs";

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const sqlPath = join(repo, "supabase", "redraft-schema.sql");

/** Ultimate Keeper League production. Never a valid target from this repo. */
const FORBIDDEN_REF = "xqhkhcmphvytoibjewqi";

const dry = process.argv.includes("--dry");

// --- Credentials ------------------------------------------------------------
// Read out of .env.local rather than inherited, so running this by hand cannot
// pick up a ref from a shell that was pointed somewhere else earlier.
const envFile = join(repo, ".env.local");
let env;
try {
  env = Object.fromEntries(
    readFileSync(envFile, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i), line.slice(i + 1)];
      }),
  );
} catch (err) {
  console.error(`Could not read ${envFile}: ${err.message}`);
  console.error("Copy .env.example to .env.local and fill in the R&F project's values.");
  process.exit(1);
}

const ref = env.SUPABASE_PROJECT_REF;
const password = env.SUPABASE_DB_PASSWORD;

if (!ref || !password) {
  console.error(
    "SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD must both be set in .env.local.",
  );
  process.exit(1);
}

if (ref === FORBIDDEN_REF) {
  console.error(
    `\nREFUSING TO RUN.\n\n` +
      `SUPABASE_PROJECT_REF is ${ref} — that is Ultimate Keeper League\n` +
      `production, which holds a real completed draft. This repo is a copy of\n` +
      `that app and must never write to it.\n\n` +
      `Point .env.local at the Ron & Friends project and run this again.\n`,
  );
  process.exit(1);
}

// --- The SQL must be schema-qualified throughout ----------------------------
const sql = readFileSync(sqlPath, "utf8");

/*
 * Comments are stripped before scanning. The script's header talks at length
 * about `public` and about what an unqualified create would do, and matching
 * that prose would make this guard cry wolf every run — a guard that always
 * fires is a guard that gets commented out.
 */
const code = sql
  .replace(/--[^\n]*/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");

const unqualified = [
  ...code.matchAll(/\bcreate\s+(?:or\s+replace\s+)?(?:unique\s+)?(table|type|function|index|view|materialized\s+view)\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/gi),
]
  .map((m) => ({ kind: m[1].toLowerCase(), name: m[2] }))
  // An index is created ON a schema-qualified table; its own name is not
  // qualified and cannot be. The table it targets is checked by the `on` clause
  // being in the same statement, which the create-table check already covers.
  .filter(({ kind }) => kind !== "index")
  .filter(({ name }) => !name.toLowerCase().startsWith(`${DB_SCHEMA}.`));

if (unqualified.length) {
  console.error(
    `\nREFUSING TO RUN. ${unqualified.length} unqualified object(s) in redraft-schema.sql:\n`,
  );
  for (const { kind, name } of unqualified) console.error(`  create ${kind} ${name}`);
  console.error(
    `\nEvery object must be ${DB_SCHEMA}.-qualified. An unqualified create lands in\n` +
      `public, which is the live backend for ron-and-friends-fantasy.vercel.app.\n`,
  );
  process.exit(1);
}

// `SET TABLE` replaces a publication's whole member list. On this project that
// would drop the live app's tables out of supabase_realtime with no error.
if (/alter\s+publication\s+\S+\s+set\s+table/i.test(code)) {
  console.error(
    `\nREFUSING TO RUN. redraft-schema.sql contains ALTER PUBLICATION ... SET TABLE.\n\n` +
      `SET replaces the publication's entire member list, which would silently\n` +
      `drop the live R&F app's tables out of supabase_realtime. Use ADD TABLE.\n`,
  );
  process.exit(1);
}

// --- Apply ------------------------------------------------------------------
/*
 * The session pooler, not `db.<ref>.supabase.co`. The direct host resolves to
 * IPv6 only and this machine has no route to it; the pooler answers over IPv4.
 * Session mode (5432) rather than transaction mode (6543) because this script
 * runs DDL in explicit transactions.
 */
const host = `aws-1-${env.SUPABASE_DB_REGION ?? "us-east-1"}.pooler.supabase.com`;
const conn = `postgresql://postgres.${ref}@${host}:5432/postgres`;

console.log(`schema:  ${DB_SCHEMA}`);
console.log(`project: ${ref}`);
console.log(`host:    ${host}:5432`);
console.log(`file:    supabase/redraft-schema.sql`);
console.log(
  `checks:  every object ${DB_SCHEMA}.-qualified, no ALTER PUBLICATION ... SET TABLE`,
);

const psql = (args, input) =>
  execFileSync("psql", [conn, ...args], {
    env: { ...process.env, PGPASSWORD: password, PGCONNECT_TIMEOUT: "15" },
    input,
    encoding: "utf8",
    stdio: input === undefined ? ["ignore", "pipe", "inherit"] : ["pipe", "pipe", "inherit"],
  });

if (dry) {
  const who = psql(["-At", "-c", "select current_user || ' @ ' || current_database();"]);
  console.log(`\n--dry: connected as ${who.trim()}. Nothing written.`);
  process.exit(0);
}

try {
  const out = psql(["-v", "ON_ERROR_STOP=1", "-f", sqlPath]);
  process.stdout.write(out);
} catch (err) {
  console.error(`\nApply FAILED (psql exit ${err.status}).`);
  process.exit(1);
}

console.log(`\nApplied. ${DB_SCHEMA} schema is up to date on ${ref}.`);
