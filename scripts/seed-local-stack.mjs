#!/usr/bin/env node
/**
 * Stand up a local, throwaway Supabase-compatible stack so the migrations, the
 * seed, and the four database-backed pages can be verified without the remote
 * project's credentials.
 *
 * WHY THIS EXISTS INSTEAD OF `supabase start`
 * -------------------------------------------
 * `supabase start` needs Docker, and there is no Docker on this machine — no
 * `docker` binary, no Docker.app, no Colima or OrbStack. What IS here is
 * Homebrew Postgres and Homebrew PostgREST, which between them provide the two
 * pieces the app actually talks to. So this script assembles the same surface
 * by hand:
 *
 *   * its OWN Postgres cluster, in `.local/pg`, on a non-default port with its
 *     own socket directory. It never touches the Postgres already running on
 *     5432 and never touches the commissioner's data.
 *   * PostgREST, which is the same server Supabase runs behind `/rest/v1`.
 *   * a ~40-line proxy that strips the `/rest/v1` prefix supabase-js adds,
 *     since PostgREST serves from the root and has no base-path setting.
 *
 * What that buys: real Postgres parsing the real migrations, real constraint
 * and trigger enforcement, and real supabase-js queries over HTTP. What it does
 * NOT cover: Supabase Auth, Storage, and Realtime, none of which the four pages
 * depend on for their first render.
 *
 * Usage:
 *   node scripts/seed-local-stack.mjs up      # init, migrate, serve
 *   node scripts/seed-local-stack.mjs down    # stop everything
 *   node scripts/seed-local-stack.mjs status
 *   node scripts/seed-local-stack.mjs reset   # drop the database and re-migrate
 *
 * `up` prints the env values to put in `.env.local` for local verification.
 * The JWT signing secret is a fixed development string with no access to
 * anything real; it is not a credential worth protecting.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const LOCAL_DIR = path.join(ROOT, ".local");
const PGDATA = path.join(LOCAL_DIR, "pg");
const SOCKET_DIR = path.join(LOCAL_DIR, "sock");
const LOG_DIR = path.join(LOCAL_DIR, "log");

const PG_PORT = 54329;
const POSTGREST_PORT = 54331;
const GATEWAY_PORT = 54330;
const DB_NAME = "ultimate_keeper_league";

/** Development-only. Signs the local anon/service tokens and nothing else. */
const JWT_SECRET = "ultimate-keeper-league-local-development-jwt-secret-value";

const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

// --- tiny helpers -----------------------------------------------------------

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return {
    ok: res.status === 0,
    code: res.status,
    out: (res.stdout ?? "").trim(),
    err: (res.stderr ?? "").trim(),
  };
}

function psql(sql, { db = DB_NAME, quiet = false } = {}) {
  const res = run("psql", [
    "-h", SOCKET_DIR,
    "-p", String(PG_PORT),
    "-U", "postgres",
    "-d", db,
    "-v", "ON_ERROR_STOP=1",
    "-q",
    "-t",
    "-A",
    "-c", sql,
  ]);
  if (!res.ok && !quiet) {
    console.error(`psql failed:\n${res.err || res.out}`);
  }
  return res;
}

function psqlFile(file, { db = DB_NAME } = {}) {
  return run("psql", [
    "-h", SOCKET_DIR,
    "-p", String(PG_PORT),
    "-U", "postgres",
    "-d", db,
    "-v", "ON_ERROR_STOP=1",
    "-q",
    "-f", file,
  ]);
}

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Mint the HS256 tokens supabase-js sends as `apikey` / `Authorization`.
 * PostgREST reads `role` out of the claims and switches to it, which is exactly
 * how the hosted anon and service_role keys work.
 */
function mintKey(role) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({ role, iss: "ukl-local", iat: now, exp: now + 60 * 60 * 24 * 365 }),
  );
  const sig = base64url(
    createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${sig}`;
}

function pgRunning() {
  return run("pg_ctl", ["-D", PGDATA, "status"]).ok;
}

function requireBinaries() {
  const missing = [];
  for (const bin of ["initdb", "pg_ctl", "psql", "postgrest"]) {
    if (!run("which", [bin]).ok) missing.push(bin);
  }
  if (missing.length) {
    console.error(
      `Missing required binaries: ${missing.join(", ")}.\n` +
        `Install with: brew install postgresql@14 postgrest`,
    );
    process.exit(1);
  }
}

// --- lifecycle --------------------------------------------------------------

function initCluster() {
  for (const d of [LOCAL_DIR, SOCKET_DIR, LOG_DIR]) {
    mkdirSync(d, { recursive: true });
  }
  if (existsSync(path.join(PGDATA, "PG_VERSION"))) return;

  console.log("initdb: creating an isolated cluster in .local/pg");
  const res = run("initdb", ["-D", PGDATA, "-U", "postgres", "--auth=trust", "-E", "UTF8"]);
  if (!res.ok) {
    console.error(res.err || res.out);
    process.exit(1);
  }
}

function startPostgres() {
  if (pgRunning()) {
    console.log(`postgres: already running on port ${PG_PORT}`);
    return;
  }
  console.log(`postgres: starting on port ${PG_PORT} (socket ${SOCKET_DIR})`);
  const res = run("pg_ctl", [
    "-D", PGDATA,
    "-l", path.join(LOG_DIR, "postgres.log"),
    // Loopback only, on a port of its own, so nothing here can reach or be
    // reached by the Postgres already running on 5432.
    "-o", `-p ${PG_PORT} -k ${SOCKET_DIR} -c listen_addresses=127.0.0.1`,
    "-w",
    "start",
  ]);
  if (!res.ok) {
    console.error(res.err || res.out);
    console.error(`See ${path.join(LOG_DIR, "postgres.log")}`);
    process.exit(1);
  }
}

function stopPostgres() {
  if (!pgRunning()) {
    console.log("postgres: not running");
    return;
  }
  console.log("postgres: stopping");
  run("pg_ctl", ["-D", PGDATA, "-m", "fast", "-w", "stop"]);
}

/**
 * Create the roles Supabase provides out of the box. The RLS migration grants
 * to `anon` and `authenticated` by name, so they have to exist before it runs.
 * `authenticator` is the low-privilege role PostgREST logs in as and switches
 * out of, mirroring how the hosted setup works.
 */
function ensureRolesAndDatabase() {
  const bootstrap = `
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin noinherit;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin noinherit;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin noinherit bypassrls;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticator') then
        create role authenticator login noinherit;
      end if;
    end $$;
    grant anon, authenticated, service_role to authenticator;
  `;
  let res = psql(bootstrap, { db: "postgres" });
  if (!res.ok) process.exit(1);

  const exists = psql(
    `select 1 from pg_database where datname = '${DB_NAME}'`,
    { db: "postgres" },
  );
  if (exists.out !== "1") {
    console.log(`postgres: creating database ${DB_NAME}`);
    res = psql(`create database ${DB_NAME} owner postgres`, { db: "postgres" });
    if (!res.ok) process.exit(1);
  }

  // Match the hosted project's default grants, which is what makes the
  // `revoke` in the RLS migration a meaningful step rather than a no-op.
  const grants = `
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public
      grant all on functions to anon, authenticated, service_role;
  `;
  psql(grants);
}

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Apply every migration inside one transaction and record what ran, so a
 * partially-applied schema is never left behind for the seed to trip over.
 */
function applyMigrations() {
  // Deliberately outside `public`: this table is an artifact of the local
  // harness, and `public` has to contain exactly what the migrations create so
  // the generated types can be checked against it.
  psql(`
    create schema if not exists _local;
    create table if not exists _local.schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const applied = new Set(
    psql("select version from _local.schema_migrations")
      .out.split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const pending = migrationFiles().filter((f) => !applied.has(f));
  if (!pending.length) {
    console.log(`migrations: ${applied.size} already applied, nothing pending`);
    return;
  }

  for (const file of pending) {
    const full = path.join(MIGRATIONS_DIR, file);
    // Wrapped so a failure rolls the whole file back.
    const wrapped = path.join(LOG_DIR, `apply-${file}`);
    writeFileSync(
      wrapped,
      `begin;\n${readFileSync(full, "utf8")}\n` +
        `insert into _local.schema_migrations (version) values ('${file}');\ncommit;\n`,
    );
    const res = psqlFile(wrapped);
    if (!res.ok) {
      console.error(`migrations: FAILED on ${file}`);
      console.error(res.err || res.out);
      process.exit(1);
    }
    console.log(`migrations: applied ${file}`);
  }

  // Tables created after the ALTER DEFAULT PRIVILEGES still need the anon role
  // to be able to SELECT through its policy.
  psql(`
    grant select on all tables in schema public to anon, authenticated;
    grant all on all tables in schema public to service_role;
    grant all on all sequences in schema public to service_role;
  `);
}

function writePostgrestConf() {
  const conf = [
    `db-uri = "postgres://authenticator@localhost:${PG_PORT}/${DB_NAME}?host=${SOCKET_DIR}"`,
    `db-schemas = "public"`,
    `db-anon-role = "anon"`,
    `jwt-secret = "${JWT_SECRET}"`,
    `server-port = ${POSTGREST_PORT}`,
    `server-host = "127.0.0.1"`,
    `db-pool = 6`,
    "",
  ].join("\n");
  const file = path.join(LOCAL_DIR, "postgrest.conf");
  writeFileSync(file, conf);
  return file;
}

function startPostgrest(conf) {
  const log = path.join(LOG_DIR, "postgrest.log");
  writeFileSync(log, "");
  // `spawn` needs a real descriptor for a file; the string shorthands `fs.open`
  // accepts are not valid stdio values.
  const logFd = openSync(log, "a");
  const child = spawn("postgrest", [conf], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
  writeFileSync(path.join(LOCAL_DIR, "postgrest.pid"), String(child.pid));
  console.log(`postgrest: started on ${POSTGREST_PORT} (pid ${child.pid}), log at ${log}`);
  return child.pid;
}

/**
 * supabase-js talks to `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1`. PostgREST serves
 * from the root, so this strips the prefix and forwards everything else through
 * untouched.
 */
function startGateway() {
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    const target = url.startsWith("/rest/v1")
      ? url.slice("/rest/v1".length) || "/"
      : url;

    const headers = { ...req.headers, host: `127.0.0.1:${POSTGREST_PORT}` };
    const proxied = new URL(`http://127.0.0.1:${POSTGREST_PORT}${target}`);

    import("node:http").then(({ request }) => {
      const upstream = request(
        { hostname: proxied.hostname, port: proxied.port, path: proxied.pathname + proxied.search, method: req.method, headers },
        (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        },
      );
      upstream.on("error", (err) => {
        res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ message: `gateway: ${err.message}` }));
      });
      req.pipe(upstream);
    });
  });

  server.listen(GATEWAY_PORT, "127.0.0.1", () => {
    console.log(`gateway: listening on http://127.0.0.1:${GATEWAY_PORT} -> postgrest`);
  });
  return server;
}

function stopPostgrest() {
  const pidFile = path.join(LOCAL_DIR, "postgrest.pid");
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`postgrest: stopped (pid ${pid})`);
    } catch {
      /* already gone */
    }
  }
  rmSync(pidFile, { force: true });
}

function printEnv() {
  console.log(
    [
      "",
      "Local stack ready. For local verification only, put these in .env.local:",
      "",
      `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${GATEWAY_PORT}`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${mintKey("anon")}`,
      `SUPABASE_SERVICE_ROLE_KEY=${mintKey("service_role")}`,
      "",
      "Then: node scripts/seed-league.mjs",
      "",
    ].join("\n"),
  );
}

// --- commands ---------------------------------------------------------------

const command = process.argv[2] ?? "up";

if (command === "up") {
  requireBinaries();
  initCluster();
  startPostgres();
  ensureRolesAndDatabase();
  applyMigrations();
  stopPostgrest();
  startPostgrest(writePostgrestConf());
  const gateway = startGateway();
  printEnv();
  const shutdown = () => {
    gateway.close();
    stopPostgrest();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
} else if (command === "migrate") {
  requireBinaries();
  initCluster();
  startPostgres();
  ensureRolesAndDatabase();
  applyMigrations();
  console.log("migrations: done");
} else if (command === "down") {
  stopPostgrest();
  stopPostgres();
} else if (command === "reset") {
  requireBinaries();
  initCluster();
  startPostgres();
  stopPostgrest();
  psql(`drop database if exists ${DB_NAME}`, { db: "postgres" });
  ensureRolesAndDatabase();
  applyMigrations();
  console.log("reset: schema rebuilt from migrations");
} else if (command === "status") {
  console.log(`postgres: ${pgRunning() ? "running" : "stopped"} (port ${PG_PORT})`);
  const tables = psql(
    "select count(*) from information_schema.tables where table_schema = 'public'",
    { quiet: true },
  );
  console.log(`public tables: ${tables.ok ? tables.out : "unavailable"}`);
} else if (command === "keys") {
  printEnv();
} else {
  console.error(`Unknown command "${command}". Use up | migrate | down | reset | status | keys.`);
  process.exit(1);
}
