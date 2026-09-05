/**
 * Says WHICH FantasyPros account the app is signed in as.
 *
 *   npm run whoami:fantasypros
 *
 * The commissioner signed in with the wrong account once and had no way to
 * tell. This is the check that makes that visible in three seconds, and it
 * prints exactly what `npm run auth:fantasypros` prints at the end of a
 * sign-in, so the two can be compared.
 *
 * Reads the stored grant. Prints no token.
 */
import { describeAccount, describeAccountLines } from "@/lib/fantasypros/account";
import { hasFantasyProsGrant } from "@/lib/fantasypros/token-store";

if (!(await hasFantasyProsGrant())) {
  console.log("\nNo FantasyPros grant is stored, so the app is signed in as nobody.");
  console.log("The draft board is unaffected — it reads the committed snapshot.");
  console.log("Sign in with `npm run auth:fantasypros`.\n");
  process.exit(0);
}

const account = await describeAccount();

console.log("\nFantasyPros account the draft board is using:\n");
for (const line of describeAccountLines(account)) console.log(line);
console.log(`\n  grant last written ${account.identity.storedAt}`);
console.log(
  "\nIf the subscription tier or the synced leagues are not what you expect,\n" +
    "this is the wrong account. Re-run `npm run auth:fantasypros`, which now\n" +
    "forces FantasyPros to ask who you are rather than reusing the browser session.\n",
);
