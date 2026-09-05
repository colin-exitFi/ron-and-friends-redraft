/**
 * The Postgres schema this app's tables live in.
 *
 * ============================================================================
 * WHY THIS IS NOT `public`
 * ============================================================================
 * Ron & Friends shares a Supabase project with the deployed R&F app at
 * ron-and-friends-fantasy.vercel.app, whose backend IS `public` — ballots
 * managers have already voted in, the treasury ledger, the lottery. The
 * commissioner is at his project limit and is not buying another, so the draft
 * board is isolated by schema instead.
 *
 * The two schemas collide on fourteen table names — leagues, teams,
 * draft_state, draft_order, trades, traded_picks, votes, keepers,
 * keeper_rights, motions, officers, commissioner_actions, pick_ownership,
 * trade_assets. `public` is therefore not merely untidy here, it is wrong: a
 * client left on the default would read and write the live app's rows.
 *
 * ============================================================================
 * WHY IT IS A `.mjs` FILE
 * ============================================================================
 * So there is exactly one of it. Both halves of the codebase have to agree on
 * this string — the app (TypeScript, bundled by Next) and the verify/seed
 * scripts (plain `node`, some without a TS loader) — and `.mjs` is the one
 * format both consume directly. A second copy of the name is the failure mode
 * this file exists to prevent: the app would talk to one schema and the script
 * proving the app works would talk to another.
 *
 * ============================================================================
 * TWO PLACES NEED IT, AND THEY ARE CONFIGURED SEPARATELY
 * ============================================================================
 * 1. `createClient(..., { db: { schema: DB_SCHEMA } })` — the REST/PostgREST
 *    side. Governs `.from(...)`.
 *
 * 2. `.on("postgres_changes", { schema: DB_SCHEMA, table: ... })` — Realtime.
 *    This does NOT inherit from the `db` option. A subscription that omits it
 *    defaults to `public`, subscribes without error, reports SUBSCRIBED, and
 *    then receives nothing at all — which on draft night looks like a board
 *    that has simply stopped updating, in front of ten people. There is no
 *    error anywhere to find. `npm run verify:draft:realtime` is the check.
 *
 * Anything added that reaches Postgres has to set whichever of the two applies.
 */
export const DB_SCHEMA = "redraft";
