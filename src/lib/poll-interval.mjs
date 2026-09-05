/**
 * How often a board asks the server for picks when the websocket is not
 * carrying them.
 *
 * ============================================================================
 * THREE SECONDS, AND IT USED TO BE TEN
 * ============================================================================
 * Realtime is a websocket over a venue's wifi, and on draft night it was down.
 * Both surfaces fell back to a ten-second poll, said "syncing slowly", and the
 * commissioner asked for the obvious thing: "when the pick goes in on the draft
 * board, the cheat sheet needs to be updated, like it needs to pull more
 * frequently, every few seconds or something."
 *
 * Ten seconds is long enough for a manager to plan around a player who is
 * already gone, which is the one failure the cheat sheet exists to prevent. It
 * is also long enough that nobody can tell a slow board from a stopped one.
 *
 * Three is affordable because of what each surface asks for. The cheat sheet
 * hits `/api/players/drafted`, which is one Postgres row rendered as about 4KB;
 * the board asks for the full room view because it needs all of it, and there
 * is one board. Neither query gets slower as picks land. And none of it runs in
 * the normal case: the poll only exists while the socket is down, and stops the
 * moment it comes back.
 *
 * ============================================================================
 * WHY IT IS A `.mjs` FILE
 * ============================================================================
 * The same reason as `db-schema.mjs`, which explains it at length: the app
 * (TypeScript, bundled by Next) and the verify scripts (plain `node`) both have
 * to agree on this number, and `.mjs` is the one format both consume directly.
 * `verify:draft:poll` asserts the interval a real browser actually achieves
 * against this constant, so a second copy of the number would let the app poll
 * at one rate while the check proving it passed at another.
 *
 * It is also what the indicator prints. The room is told the interval rather
 * than the word "slowly", so "not live" reads as a number somebody can judge.
 */
export const POLL_MS = 3_000;

/** The same interval, for copy that tells the room how often this is checking. */
export const POLL_SECONDS = POLL_MS / 1000;
