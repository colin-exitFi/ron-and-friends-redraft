/**
 * Signs the league in to FantasyPros, once, so the app never has to again.
 *
 *   npm run auth:fantasypros
 *
 * WHAT THIS DOES, in the order it does it:
 *
 *   1. Asks the MCP server at api.fantasypros.com where its authorization lives
 *      (RFC 9728), then asks that server for its endpoints (RFC 8414). Nothing
 *      is hardcoded that discovery can answer.
 *   2. Registers this app with FantasyPros automatically (RFC 7591 Dynamic
 *      Client Registration). There is no developer portal to visit and no app
 *      to hand-create.
 *   3. Opens a browser at FantasyPros so the commissioner signs in with his own
 *      account and approves access. This is the ONLY step a human does.
 *   4. Takes the code back on a temporary listener on this machine, exchanges
 *      it with PKCE for a REFRESH TOKEN, and saves that.
 *
 * The refresh token is the point. It is what lets a Vercel function fetch live
 * FantasyPros data at 8pm on draft night with no browser anywhere near it.
 *
 * The listener is bound to localhost and lives for the length of the sign-in.
 * The token is written to the league database when Supabase is configured and
 * to `.local/fantasypros-oauth.json` when it is not. Neither is ever committed:
 * `.local/` is gitignored, and the database row has no read policy at all.
 *
 * Run with the loader so it uses the SAME storage the app reads from, rather
 * than a second copy of that logic that could drift:
 *
 *   node --env-file=.env.local --experimental-strip-types \
 *        --import ./scripts/draft-loader.mjs scripts/fantasypros-auth.mjs
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";

import { describeAccount, describeAccountLines } from "@/lib/fantasypros/account";
import {
  MCP_ENDPOINT,
  SCOPES,
  discoverAuthServer,
  discoverProtectedResource,
  exchangeCode,
  registerClient,
} from "@/lib/fantasypros/oauth";
import { tokenStore } from "@/lib/fantasypros/token-store";

const PREFERRED_PORT = 8976;
const CLIENT_NAME = "Ultimate Keeper League draft board";
/** Long enough to find a password, short enough not to hang a terminal all day. */
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE S256 — FantasyPros advertises it, and a public client needs it. */
function pkce() {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function openBrowser(url) {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

/** A page the commissioner can close, rather than a blank tab that looks broken. */
function resultPage(heading, body) {
  return `<!doctype html><meta charset="utf-8"><title>${heading}</title>
<style>
  body{background:#0b0b0e;color:#e8e8ea;font:16px/1.6 ui-sans-serif,system-ui,-apple-system,sans-serif;
       display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}
  div{max-width:34rem;padding:2rem}
  h1{font-size:1.35rem;margin:0 0 .5rem}
  p{color:#a1a1aa;margin:0}
</style>
<div><h1>${heading}</h1><p>${body}</p></div>`;
}

/**
 * Binds the listener BEFORE registering the client, because the redirect URI
 * has to name the port that is actually listening and a fixed port can be busy.
 */
function listen() {
  return new Promise((resolve, reject) => {
    let resolveCode;
    let rejectCode;
    const code = new Promise((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://localhost`);
      if (url.pathname !== "/callback") {
        res.writeHead(404).end();
        return;
      }
      const error = url.searchParams.get("error");
      if (error) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          resultPage(
            "FantasyPros did not grant access",
            `${error}: ${url.searchParams.get("error_description") ?? "no reason given"}. You can close this tab and re-run the command.`,
          ),
        );
        rejectCode(new Error(`FantasyPros returned "${error}" instead of an authorization code.`));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        resultPage(
          "Signed in to FantasyPros",
          "You can close this tab. The draft board has what it needs and will not ask again.",
        ),
      );
      resolveCode({
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state"),
      });
    });

    server.on("error", reject);
    server.listen(PREFERRED_PORT, "127.0.0.1", () => {
      resolve({ server, port: server.address().port, code });
    });
  });
}

// --- 1. Discovery -----------------------------------------------------------

console.log("Asking FantasyPros where its authorization lives…");
const prm = await discoverProtectedResource(MCP_ENDPOINT);
console.log(`  MCP resource       ${prm.resource}`);
console.log(`  authorization by   ${prm.authorizationServers[0]}`);

const meta = await discoverAuthServer(prm.authorizationServers[0]);
console.log(`  authorize          ${meta.authorizationEndpoint}`);
console.log(`  token              ${meta.tokenEndpoint}`);
console.log(`  register           ${meta.registrationEndpoint ?? "not offered"}`);

if (!meta.scopesSupported.includes("offline_access")) {
  console.warn(
    "\nWARNING: FantasyPros no longer advertises the `offline_access` scope.\n" +
      "Without it there is no refresh token, and the app can only reach FantasyPros\n" +
      "while a browser is signed in. Continuing anyway — the request may still work.",
  );
}
if (!meta.registrationEndpoint) {
  throw new Error(
    "FantasyPros stopped offering Dynamic Client Registration, so this script " +
      "cannot create a client on its own. A client_id would have to be issued by " +
      "FantasyPros and supplied to this script.",
  );
}

// --- 2. Listener, then registration ----------------------------------------

const { server, port, code: awaitedCode } = await listen();
const redirectUri = `http://localhost:${port}/callback`;

let client;
try {
  client = await registerClient(meta.registrationEndpoint, redirectUri, CLIENT_NAME);
} catch (err) {
  server.close();
  throw err;
}
console.log(`\nRegistered this app with FantasyPros as client ${client.clientId}.`);

// --- 3. The one human step --------------------------------------------------

const { verifier, challenge } = pkce();
const state = base64url(randomBytes(16));

const authorizeUrl = new URL(meta.authorizationEndpoint);
authorizeUrl.searchParams.set("response_type", "code");
authorizeUrl.searchParams.set("client_id", client.clientId);
authorizeUrl.searchParams.set("redirect_uri", redirectUri);
authorizeUrl.searchParams.set("scope", SCOPES);
authorizeUrl.searchParams.set("state", state);
authorizeUrl.searchParams.set("code_challenge", challenge);
authorizeUrl.searchParams.set("code_challenge_method", "S256");
// Required of MCP clients by the spec, in BOTH requests, whether or not the
// authorization server does anything with it.
authorizeUrl.searchParams.set("resource", prm.resource);
/*
 * Force a fresh sign-in rather than accepting whatever session the browser
 * already holds. Without this the commissioner signed in once with the wrong
 * FantasyPros account and every re-run silently re-authorised that same
 * account — the consent screen never appeared, so there was nothing on screen
 * to reveal it. `max_age=0` says the same thing to a server that ignores
 * `prompt`; sending both costs nothing and neither can make the request fail.
 */
authorizeUrl.searchParams.set("prompt", "login");
authorizeUrl.searchParams.set("max_age", "0");

console.log("\n────────────────────────────────────────────────────────────────");
console.log("  A FantasyPros sign-in page is opening in your browser.");
console.log("");
console.log("  1. CHECK WHICH ACCOUNT YOU ARE SIGNED IN AS. This has gone");
console.log("     wrong before. If you are not sure, sign out first at");
console.log("     https://secure.fantasypros.com/accounts/logout/ and come");
console.log("     back to this page.");
console.log("  2. Sign in with the account that has your leagues on it.");
console.log("  3. Approve access when it asks.");
console.log("  4. Come back here. This script will then tell you which");
console.log("     account it actually got, so you can check it is the right");
console.log("     one rather than taking it on faith.");
console.log("");
console.log("  If the browser did not open, paste this in yourself:");
console.log(`  ${authorizeUrl}`);
console.log("────────────────────────────────────────────────────────────────\n");

openBrowser(authorizeUrl.href);

const timeout = setTimeout(() => {
  console.error("\nGave up waiting for the sign-in. Re-run `npm run auth:fantasypros`.");
  server.close();
  process.exit(1);
}, SIGN_IN_TIMEOUT_MS);

const returned = await awaitedCode.finally(() => {
  clearTimeout(timeout);
  server.close();
});

if (returned.state !== state) {
  throw new Error(
    "The `state` FantasyPros sent back does not match the one this script sent. " +
      "Nothing was saved. Re-run the command; if it happens again, something is " +
      "intercepting the sign-in.",
  );
}
if (!returned.code) throw new Error("FantasyPros redirected back without an authorization code.");

// --- 4. Exchange and persist ------------------------------------------------

console.log("Exchanging the code for a token…");
const token = await exchangeCode({
  tokenEndpoint: meta.tokenEndpoint,
  clientId: client.clientId,
  clientSecret: client.clientSecret,
  code: returned.code,
  codeVerifier: verifier,
  redirectUri,
  resource: prm.resource,
});

if (!token.refreshToken) {
  throw new Error(
    "FantasyPros issued an access token but NO refresh token, so the app could " +
      "only reach it for the next hour or so and would then go dark with nobody " +
      "watching.\n" +
      `The scope granted was "${token.scope ?? "unstated"}"; \`offline_access\` is ` +
      "what buys a refresh token.\n" +
      "Nothing has been saved. Re-run and make sure the consent screen is approved " +
      "in full rather than partially.",
  );
}

await tokenStore.write({
  issuer: meta.issuer,
  resource: prm.resource,
  clientId: client.clientId,
  clientSecret: client.clientSecret,
  refreshToken: token.refreshToken,
  scope: token.scope,
  accessToken: token.accessToken,
  accessTokenExpiresAt: token.expiresIn
    ? new Date(Date.now() + token.expiresIn * 1000).toISOString()
    : null,
  updatedAt: new Date().toISOString(),
});

console.log("\nDone. FantasyPros is wired in.");
console.log(`  saved to        ${tokenStore.location()}`);

/*
 * Say WHICH account this is, out loud, before claiming success.
 *
 * The failure this prevents already happened: the sign-in completed, the
 * console said "Done", and the grant was for the wrong FantasyPros account.
 * The flow succeeds identically either way, so the only way the commissioner
 * can catch it is to be shown something he recognises. FantasyPros discloses
 * no email — `claims_supported` is `sub` alone — so the recognisable thing is
 * the list of leagues synced to the account. If his leagues are not on it,
 * this is the wrong account and he knows within a second of the flow ending.
 */
console.log("\nChecking which account that actually was…\n");
try {
  const account = await describeAccount();
  for (const line of describeAccountLines(account)) console.log(line);
  console.log("");
  if (account.leagues.length === 0) {
    console.log("  ⚠ This account has NO leagues synced to it. If you expected to see");
    console.log("    your leagues listed above, this is the wrong account — sign out at");
    console.log("    https://secure.fantasypros.com/accounts/logout/ and run this again.");
  } else {
    console.log("  ↑ Are those your leagues? If not, this is the wrong account: sign out");
    console.log("    at https://secure.fantasypros.com/accounts/logout/ and run this again.");
  }
} catch (err) {
  // The grant is saved and working; only the description failed. Saying so is
  // better than implying the sign-in did not take.
  console.log(`  Could not describe the account: ${err instanceof Error ? err.message : err}`);
  console.log("  The grant itself is saved. Try `npm run whoami:fantasypros`.");
}

console.log(
  "\nNo token is printed here or written to anywhere git can see. Check it works\n" +
    "with `npm run verify:fantasypros`, and re-check the account any time with\n" +
    "`npm run whoami:fantasypros`.",
);
