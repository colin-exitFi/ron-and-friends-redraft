import "server-only";

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { hasDatabase } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Where the FantasyPros OAuth grant lives between requests.
 *
 * Same two-backend shape as `@/lib/draft-store`, and chosen the same way: a
 * writable disk wins on the commissioner's laptop, Postgres is the only option
 * on a deployment. The difference is what is at stake. This is a credential, so
 * the file backend writes to `.local/`, which is gitignored, rather than to
 * `data/`, which is tracked — a refresh token in a commit is a refresh token on
 * GitHub.
 *
 * THE REFRESH TOKEN IS NOT AN ENVIRONMENT VARIABLE ON PURPOSE. FantasyPros may
 * rotate it on any refresh, and an env var cannot be rewritten by the function
 * that discovered the rotation; it would need a push, and a push here is a
 * production release. Losing a rotated token silently is the failure mode that
 * breaks this integration a week from now with no visible cause, so the store
 * has to be writable at runtime.
 */

export type FantasyProsGrant = {
  /** Authorization server that issued this, from discovery rather than hardcoded. */
  issuer: string;
  /** RFC 8707 canonical resource URI the tokens are bound to. */
  resource: string;
  clientId: string;
  /** Null for a public client, which is what DCR gives us here. */
  clientSecret: string | null;
  refreshToken: string;
  scope: string | null;
  accessToken: string | null;
  /** ISO. Null when no access token has been minted yet. */
  accessTokenExpiresAt: string | null;
  updatedAt: string;
};

export interface TokenStore {
  read(): Promise<FantasyProsGrant | null>;
  write(grant: FantasyProsGrant): Promise<void>;
  /** Destroys the stored grant. Reports what it removed; never throws on absence. */
  clear(): Promise<string | null>;
  /** Human-readable, for the auth script's console output. Never includes a token. */
  location(): string;
}

const LOCAL_DIR = path.join(process.cwd(), ".local");
const LOCAL_FILE = path.join(LOCAL_DIR, "fantasypros-oauth.json");

function isGrant(value: unknown): value is FantasyProsGrant {
  if (!value || typeof value !== "object") return false;
  const g = value as Record<string, unknown>;
  return (
    typeof g.issuer === "string" &&
    typeof g.resource === "string" &&
    typeof g.clientId === "string" &&
    typeof g.refreshToken === "string" &&
    g.refreshToken.length > 0
  );
}

class FileTokenStore implements TokenStore {
  async read(): Promise<FantasyProsGrant | null> {
    if (!existsSync(LOCAL_FILE)) return null;
    try {
      const parsed: unknown = JSON.parse(readFileSync(LOCAL_FILE, "utf8"));
      return isGrant(parsed) ? parsed : null;
    } catch {
      // A corrupt credential file is a re-auth, not a crash: `npm run
      // auth:fantasypros` rewrites it in under a minute.
      return null;
    }
  }

  async write(grant: FantasyProsGrant): Promise<void> {
    mkdirSync(LOCAL_DIR, { recursive: true });
    const tmp = `${LOCAL_FILE}.${process.pid}.tmp`;
    // 0600: this is a credential, and the default 0644 would leave it readable
    // by anything else running as another user on the machine.
    writeFileSync(tmp, `${JSON.stringify(grant, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, LOCAL_FILE);
  }

  async clear(): Promise<string | null> {
    if (!existsSync(LOCAL_FILE)) return null;
    rmSync(LOCAL_FILE, { force: true });
    return path.relative(process.cwd(), LOCAL_FILE);
  }

  location(): string {
    return path.relative(process.cwd(), LOCAL_FILE);
  }
}

/**
 * `fantasypros_oauth` is not in `@/lib/supabase/types` yet — those types are
 * generated against the LINKED project, so a table only appears there once its
 * migration has been pushed, and pushing is the commissioner's call. Narrowed
 * to exactly the two calls this store makes rather than widened to `any`, the
 * same shim `@/lib/recap-store` uses for `draft_recap`. Delete it and the cast
 * once `npm run db:push && npm run db:types` has run.
 */
type OAuthRow = {
  id: string;
  issuer: string;
  resource: string;
  client_id: string;
  client_secret: string | null;
  refresh_token: string;
  scope: string | null;
  access_token: string | null;
  access_token_expires_at: string | null;
  updated_at: string;
};

type OAuthTable = {
  select(columns: string): {
    eq(
      column: string,
      value: string,
    ): {
      maybeSingle(): Promise<{
        data: OAuthRow | null;
        error: { message: string } | null;
      }>;
    };
  };
  upsert(
    row: OAuthRow,
    options: { onConflict: string },
  ): Promise<{ error: { message: string } | null }>;
  delete(): {
    eq(column: string, value: string): Promise<{ error: { message: string } | null }>;
  };
};

function oauthTable(): OAuthTable {
  return (
    createServiceClient() as unknown as { from(table: string): OAuthTable }
  ).from("fantasypros_oauth");
}

const ROW_ID = "fantasypros";

class SupabaseTokenStore implements TokenStore {
  async read(): Promise<FantasyProsGrant | null> {
    const { data, error } = await oauthTable()
      .select(
        "id, issuer, resource, client_id, client_secret, refresh_token, scope, access_token, access_token_expires_at, updated_at",
      )
      .eq("id", ROW_ID)
      .maybeSingle();

    if (error) {
      throw new Error(`Reading the FantasyPros grant from the database failed: ${error.message}`);
    }
    if (!data) return null;

    return {
      issuer: data.issuer,
      resource: data.resource,
      clientId: data.client_id,
      clientSecret: data.client_secret,
      refreshToken: data.refresh_token,
      scope: data.scope,
      accessToken: data.access_token,
      accessTokenExpiresAt: data.access_token_expires_at,
      updatedAt: data.updated_at,
    };
  }

  async write(grant: FantasyProsGrant): Promise<void> {
    const { error } = await oauthTable().upsert(
      {
        id: ROW_ID,
        issuer: grant.issuer,
        resource: grant.resource,
        client_id: grant.clientId,
        client_secret: grant.clientSecret,
        refresh_token: grant.refreshToken,
        scope: grant.scope,
        access_token: grant.accessToken,
        access_token_expires_at: grant.accessTokenExpiresAt,
        updated_at: grant.updatedAt,
      },
      { onConflict: "id" },
    );
    if (error) {
      throw new Error(`Saving the FantasyPros grant to the database failed: ${error.message}`);
    }
  }

  async clear(): Promise<string | null> {
    const existing = await this.read().catch(() => null);
    const { error } = await oauthTable().delete().eq("id", ROW_ID);
    if (error) {
      throw new Error(`Deleting the FantasyPros grant from the database failed: ${error.message}`);
    }
    return existing ? "the league database (fantasypros_oauth)" : null;
  }

  location(): string {
    return "the league database (fantasypros_oauth)";
  }
}

/**
 * Which backend this process gets.
 *
 * Inverted relative to `@/lib/draft-store`, which prefers the disk. A grant is
 * one shared credential rather than one laptop's board, and the useful thing is
 * for the deployment and the laptop to be looking at the SAME grant — so the
 * database wins wherever it is configured, and the file is the development
 * fallback for a checkout with no Supabase keys.
 *
 * `FANTASYPROS_TOKEN_STORE=file|database` overrides, for when the guess is
 * wrong and it is an hour before the draft.
 */
let backend: TokenStore | null = null;
function store(): TokenStore {
  if (backend) return backend;

  const forced = process.env.FANTASYPROS_TOKEN_STORE?.toLowerCase();
  if (forced === "file") backend = new FileTokenStore();
  else if (forced === "database") backend = new SupabaseTokenStore();
  else if (hasDatabase()) backend = new SupabaseTokenStore();
  else backend = new FileTokenStore();

  return backend;
}

export const tokenStore: TokenStore = {
  read: () => store().read(),
  write: (grant) => store().write(grant),
  clear: () => store().clear(),
  location: () => store().location(),
};

/**
 * Destroys the grant in BOTH backends, whichever one is active.
 *
 * Not the same operation as `tokenStore.clear()`, and the difference is the
 * whole reason this exists. A grant written on a laptop before the migration
 * was pushed lands in the file; the same laptop afterwards reads and writes the
 * database and would never look at that file again. Clearing only the active
 * backend therefore leaves a live refresh token sitting on disk for an account
 * nobody is watching. A reset has to mean gone, so it clears both and says
 * which ones actually held something.
 */
export async function clearGrantEverywhere(): Promise<string[]> {
  const cleared: string[] = [];
  for (const backend of [new FileTokenStore(), new SupabaseTokenStore()]) {
    if (backend instanceof SupabaseTokenStore && !hasDatabase()) continue;
    try {
      const where = await backend.clear();
      if (where) cleared.push(where);
    } catch (err) {
      // One backend failing must not leave the other one holding the grant.
      cleared.push(
        `FAILED to clear ${backend.location()}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return cleared;
}

/** Reads the grant from both backends, for a reset that wants to revoke first. */
export async function readGrantEverywhere(): Promise<FantasyProsGrant[]> {
  const grants: FantasyProsGrant[] = [];
  for (const backend of [new FileTokenStore(), new SupabaseTokenStore()]) {
    if (backend instanceof SupabaseTokenStore && !hasDatabase()) continue;
    const grant = await backend.read().catch(() => null);
    if (grant) grants.push(grant);
  }
  return grants;
}

/** Whether a grant exists at all, for surfaces that must not throw without one. */
export async function hasFantasyProsGrant(): Promise<boolean> {
  try {
    return (await tokenStore.read()) !== null;
  } catch {
    return false;
  }
}
