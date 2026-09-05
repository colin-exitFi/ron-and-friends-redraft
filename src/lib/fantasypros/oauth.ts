import "server-only";

import { tokenStore, type FantasyProsGrant } from "@/lib/fantasypros/token-store";

/**
 * OAuth 2.1 against FantasyPros, as the MCP authorization spec requires it.
 *
 * Nothing here is hardcoded that discovery can tell us. The flow is:
 *
 *   POST the MCP endpoint unauthenticated  -> 401 + WWW-Authenticate carrying
 *                                             `resource_metadata`
 *   GET that                               -> RFC 9728 protected-resource
 *                                             metadata, naming the auth server
 *   GET the auth server's metadata         -> RFC 8414 endpoints
 *
 * Two details are easy to get wrong and both are load-bearing:
 *
 *  1. **The `resource` parameter is not optional.** RFC 8707, and the MCP spec
 *     makes it a MUST on the client in BOTH the authorization request and the
 *     token request, "regardless of whether authorization servers support it".
 *     It is what stops a token minted for one MCP server working at another.
 *
 *  2. **Refresh tokens may rotate.** Every refresh response is checked for a
 *     new `refresh_token` and the store is rewritten when one appears. Dropping
 *     a rotated token is silent today and fatal a week from now, which is
 *     exactly the failure this league cannot afford to discover on draft night.
 */

/** The MCP server. Also the RFC 8707 canonical resource URI, once confirmed. */
export const MCP_ENDPOINT = "https://api.fantasypros.com/mcp";

/**
 * `offline_access` is what buys a refresh token, and therefore the whole
 * server-side integration: without it the app could only talk to FantasyPros
 * while a browser sat in front of it.
 */
export const SCOPES = "user:read offline_access";

/** Discovery and token calls are quick or they are broken. */
const DISCOVERY_TIMEOUT_MS = 8_000;

export type ProtectedResourceMetadata = {
  resource: string;
  authorizationServers: string[];
  scopesSupported: string[] | null;
};

export type AuthServerMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string | null;
  /** RFC 7009. Not advertised by FantasyPros; see `revokeGrant`. */
  revocationEndpoint: string | null;
  userinfoEndpoint: string | null;
  scopesSupported: string[];
  codeChallengeMethodsSupported: string[];
  grantTypesSupported: string[];
  tokenEndpointAuthMethodsSupported: string[];
};

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const signal = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
  const res = await fetch(url, { ...init, signal });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} returned ${res.status}: ${body.slice(0, 400)}`);
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`${url} did not return JSON: ${body.slice(0, 200)}`);
  }
}

/**
 * Pull `resource_metadata` out of a 401's WWW-Authenticate header.
 *
 * Discovering the URL this way rather than assuming the well-known path means a
 * FantasyPros move of the metadata document is followed rather than fatal.
 */
export function resourceMetadataUrlFromChallenge(header: string | null): string | null {
  if (!header) return null;
  const match = /resource_metadata\s*=\s*"([^"]+)"/i.exec(header);
  return match?.[1] ?? null;
}

/** Ask the MCP server itself where its authorization lives. */
export async function discoverProtectedResource(
  endpoint: string = MCP_ENDPOINT,
): Promise<ProtectedResourceMetadata> {
  const probe = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });

  const url =
    resourceMetadataUrlFromChallenge(probe.headers.get("www-authenticate")) ??
    // RFC 9728's default location, for the case where the challenge is absent.
    new URL(`/.well-known/oauth-protected-resource${new URL(endpoint).pathname}`, endpoint).href;

  const doc = (await fetchJson(url)) as Record<string, unknown>;
  const servers = Array.isArray(doc.authorization_servers)
    ? (doc.authorization_servers as string[])
    : [];
  if (servers.length === 0) {
    throw new Error(`${url} named no authorization_servers, so there is nothing to authorize against.`);
  }

  return {
    resource: typeof doc.resource === "string" ? doc.resource : endpoint,
    authorizationServers: servers,
    scopesSupported: Array.isArray(doc.scopes_supported) ? (doc.scopes_supported as string[]) : null,
  };
}

/**
 * RFC 8414 metadata for the authorization server.
 *
 * Tries the OAuth document first and OpenID Connect discovery second: the spec
 * allows either, and FantasyPros publishes both.
 */
export async function discoverAuthServer(issuer: string): Promise<AuthServerMetadata> {
  const base = issuer.replace(/\/$/, "");
  const candidates = [
    `${base}/.well-known/oauth-authorization-server`,
    `${base}/.well-known/openid-configuration`,
  ];

  let lastError: unknown = null;
  for (const url of candidates) {
    try {
      const doc = (await fetchJson(url)) as Record<string, unknown>;
      const authorization = doc.authorization_endpoint;
      const token = doc.token_endpoint;
      if (typeof authorization !== "string" || typeof token !== "string") continue;
      return {
        issuer: typeof doc.issuer === "string" ? doc.issuer : base,
        authorizationEndpoint: authorization,
        tokenEndpoint: token,
        registrationEndpoint:
          typeof doc.registration_endpoint === "string" ? doc.registration_endpoint : null,
        revocationEndpoint:
          typeof doc.revocation_endpoint === "string" ? doc.revocation_endpoint : null,
        userinfoEndpoint: typeof doc.userinfo_endpoint === "string" ? doc.userinfo_endpoint : null,
        scopesSupported: Array.isArray(doc.scopes_supported) ? (doc.scopes_supported as string[]) : [],
        codeChallengeMethodsSupported: Array.isArray(doc.code_challenge_methods_supported)
          ? (doc.code_challenge_methods_supported as string[])
          : [],
        grantTypesSupported: Array.isArray(doc.grant_types_supported)
          ? (doc.grant_types_supported as string[])
          : [],
        tokenEndpointAuthMethodsSupported: Array.isArray(doc.token_endpoint_auth_methods_supported)
          ? (doc.token_endpoint_auth_methods_supported as string[])
          : [],
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `Could not read authorization server metadata for ${issuer}. Last error: ` +
      `${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

export type RegisteredClient = { clientId: string; clientSecret: string | null };

/** RFC 7591 Dynamic Client Registration — so nobody hand-creates an app. */
export async function registerClient(
  registrationEndpoint: string,
  redirectUri: string,
  clientName: string,
): Promise<RegisteredClient> {
  const doc = (await fetchJson(registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      // A public client with PKCE. FantasyPros advertises "none" as an accepted
      // token endpoint auth method, and there is no way to keep a secret in a
      // script the commissioner runs on his laptop anyway.
      token_endpoint_auth_method: "none",
      scope: SCOPES,
      application_type: "native",
    }),
  })) as Record<string, unknown>;

  if (typeof doc.client_id !== "string") {
    throw new Error(`Registration at ${registrationEndpoint} returned no client_id.`);
  }
  return {
    clientId: doc.client_id,
    clientSecret: typeof doc.client_secret === "string" ? doc.client_secret : null,
  };
}

export type TokenResponse = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scope: string | null;
  tokenType: string;
};

function parseTokenResponse(doc: Record<string, unknown>): TokenResponse {
  if (typeof doc.access_token !== "string") {
    // The body is quoted to make the failure diagnosable, so anything
    // credential-shaped is stripped first. A malformed response that carried a
    // refresh token but no access token would otherwise put a live credential
    // into a log, which is the one thing this module must never do.
    const safe = Object.fromEntries(
      Object.entries(doc).filter(([key]) => !/token|secret|code/i.test(key)),
    );
    throw new Error(
      `The token endpoint returned no access_token. Response fields: ` +
        `${Object.keys(doc).join(", ")}. Non-secret values: ${JSON.stringify(safe).slice(0, 300)}`,
    );
  }
  return {
    accessToken: doc.access_token,
    refreshToken: typeof doc.refresh_token === "string" ? doc.refresh_token : null,
    expiresIn: typeof doc.expires_in === "number" ? doc.expires_in : null,
    scope: typeof doc.scope === "string" ? doc.scope : null,
    tokenType: typeof doc.token_type === "string" ? doc.token_type : "Bearer",
  };
}

/** Authorization-code exchange. `resource` is required by the MCP spec. */
export async function exchangeCode(params: {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  resource: string;
}): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
    resource: params.resource,
  });
  if (params.clientSecret) body.set("client_secret", params.clientSecret);

  const doc = (await fetchJson(params.tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })) as Record<string, unknown>;

  return parseTokenResponse(doc);
}

/**
 * Access tokens are refreshed this far before they actually expire, so a token
 * that was valid when a request started cannot expire while it is in flight.
 */
const EXPIRY_SKEW_MS = 60_000;

/**
 * A usable access token, minted from the stored grant if the cached one is
 * spent.
 *
 * ROTATION IS HANDLED HERE. If the refresh response carries a new
 * `refresh_token`, the store is rewritten with it before the access token is
 * returned — including when the rest of the request goes on to fail. An
 * authorization server that rotates on every use invalidates the old token the
 * moment it issues a new one, so a client that keeps using the old one is
 * locked out permanently, and would look to the commissioner like FantasyPros
 * "just stopped working".
 */
export async function getAccessToken(options: { force?: boolean } = {}): Promise<string> {
  const grant = await tokenStore.read();
  if (!grant) {
    throw new Error(
      "No FantasyPros grant is stored. Run `npm run auth:fantasypros` on the " +
        "commissioner's laptop to sign in once; everything after that is server-side.",
    );
  }

  if (!options.force && grant.accessToken && grant.accessTokenExpiresAt) {
    const expiresAt = Date.parse(grant.accessTokenExpiresAt);
    if (Number.isFinite(expiresAt) && expiresAt - EXPIRY_SKEW_MS > Date.now()) {
      return grant.accessToken;
    }
  }

  const meta = await discoverAuthServer(grant.issuer);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: grant.refreshToken,
    client_id: grant.clientId,
    resource: grant.resource,
  });
  if (grant.clientSecret) body.set("client_secret", grant.clientSecret);

  let doc: Record<string, unknown>;
  try {
    doc = (await fetchJson(meta.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    })) as Record<string, unknown>;
  } catch (cause) {
    throw new Error(
      `Refreshing the FantasyPros access token failed. If the grant has been ` +
        `revoked or expired, re-run \`npm run auth:fantasypros\`. ` +
        `${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }

  const token = parseTokenResponse(doc);
  const next: FantasyProsGrant = {
    ...grant,
    // Rotation. Keep the old one only when the server sent nothing back.
    refreshToken: token.refreshToken ?? grant.refreshToken,
    scope: token.scope ?? grant.scope,
    accessToken: token.accessToken,
    accessTokenExpiresAt: token.expiresIn
      ? new Date(Date.now() + token.expiresIn * 1000).toISOString()
      : null,
    updatedAt: new Date().toISOString(),
  };

  // Persisted before the token is handed out. If this write fails we would
  // rather fail loudly now than hand back a token whose rotated refresh token
  // has already been forgotten.
  await tokenStore.write(next);

  return token.accessToken;
}

/**
 * The RFC 7009 endpoint, which FantasyPros has but does not advertise.
 *
 * Neither metadata document names a `revocation_endpoint`, so a client that
 * only reads discovery would conclude revocation is impossible and settle for
 * deleting its local copy — which leaves the grant live on FantasyPros' side
 * forever. Probing the paths a Django OAuth Toolkit deployment uses found
 * `/oauth/revoke_token/` answering 401 (credentials rejected) where every other
 * candidate answered 404 (no such route), so the route exists.
 *
 * Discovery still wins when it eventually names one. This is the fallback, and
 * it is used on a best-effort basis: a revocation that fails must never stop
 * the local grant being destroyed.
 */
const UNADVERTISED_REVOCATION_PATH = "/oauth/revoke_token/";

export type RevocationOutcome = {
  attempted: boolean;
  ok: boolean;
  endpoint: string | null;
  /** HTTP status, or a transport failure message. Never contains a token. */
  detail: string;
};

/**
 * Asks FantasyPros to invalidate a grant, rather than merely forgetting it.
 *
 * Deleting the stored copy makes the app stop using a grant; it does not make
 * FantasyPros stop honouring it. For a grant on the wrong account that
 * distinction matters — an un-revoked refresh token is a live credential to an
 * account nobody is watching.
 *
 * Best effort by contract. Every failure is reported, none throws.
 */
export async function revokeGrant(grant: FantasyProsGrant): Promise<RevocationOutcome[]> {
  let endpoint: string | null = null;
  try {
    const meta = await discoverAuthServer(grant.issuer);
    endpoint =
      meta.revocationEndpoint ??
      new URL(UNADVERTISED_REVOCATION_PATH, `${grant.issuer.replace(/\/$/, "")}/`).href;
  } catch (err) {
    return [
      {
        attempted: false,
        ok: false,
        endpoint: null,
        detail: `could not reach discovery: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }

  // The refresh token first: it is the long-lived one, and on this server
  // revoking it takes its access tokens with it.
  const targets: [string, string | null][] = [
    ["refresh_token", grant.refreshToken],
    ["access_token", grant.accessToken],
  ];

  const outcomes: RevocationOutcome[] = [];
  for (const [hint, token] of targets) {
    if (!token) continue;
    const body = new URLSearchParams({
      token,
      token_type_hint: hint,
      client_id: grant.clientId,
    });
    if (grant.clientSecret) body.set("client_secret", grant.clientSecret);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      outcomes.push({
        attempted: true,
        // RFC 7009 says an unknown or already-invalid token is still a 200.
        ok: res.ok,
        endpoint,
        detail: `${hint}: HTTP ${res.status}`,
      });
    } catch (err) {
      outcomes.push({
        attempted: true,
        ok: false,
        endpoint,
        detail: `${hint}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return outcomes;
}

export type AccountIdentity = {
  /** The authorization server's stable identifier for the signed-in user. */
  subject: string | null;
  /** Everything else userinfo returned. FantasyPros advertises only `sub`. */
  claims: Record<string, unknown>;
  scope: string | null;
  clientId: string;
  /** ISO, when this grant was last written. */
  storedAt: string;
};

/**
 * WHICH FantasyPros account the stored grant belongs to.
 *
 * This exists because of a failure that already happened: the commissioner
 * signed in, the console said "Done", and the grant was for the wrong account.
 * Nothing in the output could have told him — the flow succeeds identically
 * whichever account the browser's session happens to hold. A `sub` he can
 * compare between runs is the smallest thing that makes a wrong account
 * visible at the moment it is created rather than a day later.
 */
export async function identifyAccount(): Promise<AccountIdentity> {
  const grant = await tokenStore.read();
  if (!grant) throw new Error("No FantasyPros grant is stored, so there is no account to identify.");

  const meta = await discoverAuthServer(grant.issuer);
  const claims: Record<string, unknown> = {};

  if (meta.userinfoEndpoint) {
    try {
      const token = await getAccessToken();
      const res = await fetch(meta.userinfoEndpoint, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      });
      if (res.ok) Object.assign(claims, (await res.json()) as Record<string, unknown>);
    } catch {
      // An identity we cannot read is reported as unknown, not as a failure:
      // the caller is usually mid-reset or mid-sign-in and must not be stopped.
    }
  }

  return {
    subject: typeof claims.sub === "string" ? claims.sub : null,
    claims,
    scope: grant.scope,
    clientId: grant.clientId,
    storedAt: grant.updatedAt,
  };
}

/**
 * Whether the grant looks alive, without making a call. Used by the health
 * surface; a real check is `verify:fantasypros`.
 */
export async function grantSummary(): Promise<{
  present: boolean;
  scope: string | null;
  issuer: string | null;
  updatedAt: string | null;
} > {
  const grant = await tokenStore.read().catch(() => null);
  return {
    present: grant !== null,
    scope: grant?.scope ?? null,
    issuer: grant?.issuer ?? null,
    updatedAt: grant?.updatedAt ?? null,
  };
}
