/**
 * Forgets the FantasyPros account completely.
 *
 *   npm run reset:fantasypros            # say what would go, change nothing
 *   npm run reset:fantasypros -- --yes   # actually do it
 *
 * WHY THIS IS A SCRIPT AND NOT A NOTE IN A DOC. The commissioner signed in with
 * the wrong FantasyPros account. Undoing that is four separate deletions in
 * three places, and the one everybody forgets is the third:
 *
 *   1. the grant on disk       `.local/fantasypros-oauth.json`
 *   2. the grant in Postgres   `fantasypros_oauth`
 *   3. THE ANSWERS IT FETCHED  `fantasypros_cache`
 *   4. the grant at FantasyPros itself, which deleting a local copy does not
 *      touch — an un-revoked refresh token stays live for an account nobody is
 *      watching
 *
 * Miss (3) and the wrong account's data keeps being served for its whole TTL,
 * and past it indefinitely whenever the upstream is unreachable, which is
 * exactly when nobody is looking. Miss (4) and the credential outlives the
 * mistake. Both are quiet failures, which is why this is one command.
 *
 * BOTH grant stores are cleared regardless of which one is live: a grant
 * written before the migration was pushed lands in the file, and a laptop that
 * later prefers the database would never look at that file again.
 *
 * WHAT THIS DOES NOT TOUCH: `data/fantasypros-players.json`. That file is the
 * floor the draft board falls back to, and the whole point of the floor is that
 * it is there when there is no grant. Removing it as part of a reset would take
 * the board's safety net away at the exact moment there is nothing above it.
 * Re-pull it after signing in again, and `npm run diff:fantasypros` will show
 * whether the new account's numbers differ from the old one's.
 *
 * Prints no token, at any point, including in errors.
 */
import { clearSharedCache } from "@/lib/fantasypros/cache";
import { revokeGrant } from "@/lib/fantasypros/oauth";
import { clearGrantEverywhere, readGrantEverywhere } from "@/lib/fantasypros/token-store";

const commit = process.argv.includes("--yes");

const grants = await readGrantEverywhere();

console.log(`\nFantasyPros grants found: ${grants.length}`);
for (const grant of grants) {
  console.log(`  client ${grant.clientId}, scope "${grant.scope ?? "unstated"}", written ${grant.updatedAt}`);
}

if (!commit) {
  console.log("\nThis is a dry run. With --yes it would:");
  console.log("  • ask FantasyPros to revoke each grant above");
  console.log("  • delete .local/fantasypros-oauth.json if it exists");
  console.log("  • delete the fantasypros_oauth row");
  console.log("  • delete EVERY fantasypros_cache row, so no answer the old account");
  console.log("    fetched can still be served");
  console.log("\nIt would leave data/fantasypros-players.json alone — that is the");
  console.log("board's fallback and the draft needs it while there is no grant.");
  console.log("\nRe-run with:  npm run reset:fantasypros -- --yes\n");
  process.exit(0);
}

// --- 1. Revoke upstream, before destroying the only copy of the token -------

for (const grant of grants) {
  const outcomes = await revokeGrant(grant);
  if (outcomes.length === 0) {
    console.log("\nNothing to revoke for this grant.");
    continue;
  }
  console.log("");
  for (const outcome of outcomes) {
    console.log(`  revoke ${outcome.ok ? "ok  " : "FAILED"}  ${outcome.detail}`);
  }
  if (outcomes.some((o) => !o.ok)) {
    console.log(
      "  Revocation is best effort — FantasyPros does not advertise the endpoint.\n" +
        "  The local copy is being destroyed regardless, so this app can no longer\n" +
        "  use the grant. If it matters, remove the app at\n" +
        "  https://secure.fantasypros.com/ under connected applications.",
    );
  }
}

// --- 2. Destroy every local copy -------------------------------------------

const cleared = await clearGrantEverywhere();
console.log("");
if (cleared.length === 0) console.log("  no stored grant to delete");
for (const where of cleared) console.log(`  deleted  ${where}`);

// --- 3. And everything it fetched ------------------------------------------

const cacheCleared = await clearSharedCache();
console.log(
  cacheCleared
    ? "  deleted  every fantasypros_cache row"
    : "  no database configured, so there was no shared cache to clear",
);

console.log("\nDone. The app is now signed in as nobody.");
console.log("The draft board is unaffected: it reads data/fantasypros-players.json,");
console.log("which is committed and still in place. Confirm with `npm run verify:draft`.");
console.log("\nWhen you are ready to sign in again:");
console.log("  1. Sign out at https://secure.fantasypros.com/accounts/logout/");
console.log("  2. npm run auth:fantasypros      (it will tell you which account it got)");
console.log("  3. npm run pull:fantasypros      (re-pull under the new account)");
console.log("  4. npm run diff:fantasypros      (see whether the numbers changed)\n");
