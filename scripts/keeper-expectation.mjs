/**
 * The ONE place a keeper count is written down in this repo.
 *
 * ============================================================================
 * WHY THIS FILE EXISTS
 * ============================================================================
 *
 * The count belongs to the assembled board, and the app derives it there —
 * `slots.filter((s) => s.isKeeper).length` in `src/lib/smartdraft.ts` is the
 * single origin, and every `keeperCount` in `src/` forwards that value. Nothing
 * in the application reads a count from this file or from any JSON field.
 *
 * But a verification script needs an EXPECTATION, not a derivation. A check that
 * says "the board's count equals the board's count" passes while nineteen
 * keepers quietly become eighteen, which is the one failure these scripts exist
 * to catch. So the expectation has to be stated by a human somewhere.
 *
 * It was stated in four places — `seed-verify-board-keepers.mts`,
 * `seed-verify-round1.mts` and `seed-verify-pages.mts` twice — and that is how
 * a stale number survives: one gets updated and the others do not. Now there is
 * one literal, here, and the scripts import it.
 *
 * ============================================================================
 * WHEN TO CHANGE THE NUMBER
 * ============================================================================
 *
 * ONLY when the board genuinely changes — a manager declares, withdraws, or a
 * declaration is ruled invalid. Then:
 *
 *   1. Make the data change (usually `data/keeper-declarations.json`).
 *   2. `npm run db:seed`, which refuses to guess a cost round or place a keeper
 *      on a pick the franchise does not hold.
 *   3. `npm run verify:board-keepers` and read the number it prints.
 *   4. Set `EXPECTED_KEEPERS` to that number, and only that number.
 *
 * Never edit it to make a failing check pass. A failing check here means the
 * board moved without anyone deciding it should.
 *
 * ============================================================================
 * WHY .mjs AND NOT .mts
 * ============================================================================
 *
 * The importers are `.mts` scripts, but `tsconfig.json` uses
 * `moduleResolution: "bundler"` without `allowImportingTsExtensions`, so a
 * `./foo.mts` specifier fails `next build`'s type check — while plain `node`
 * needs the explicit extension to resolve it at all. Extensionless satisfies
 * TypeScript and breaks Node; `.mts` satisfies Node and breaks the build.
 *
 * `.mjs` satisfies both, and costs nothing: this file is four numbers with no
 * types to declare. The alternative was widening the shared tsconfig for one
 * import, which is a worse trade.
 */

/**
 * How many keepers the assembled board carries.
 *
 * COMMISSIONER RULING, Aug 28 2026: there are **19 locked keepers and all ten
 * teams have declared**. This app and its database are the source of truth for
 * keepers; Smart Draft has not been updated since he began building this app.
 *
 * The 19 is 16 from the frozen Smart Draft room plus 3 that never reached it —
 * Zach's Justin Jefferson (R7) and Ladd McConkey (R6), and Joe's Jayden Daniels
 * (R9). Joe keeping one is a deliberate choice, not an outstanding declaration,
 * which is what `closesList` in `data/keeper-declarations.json` records.
 */
export const EXPECTED_KEEPERS = 19;

/**
 * How many of those 19 the Smart Draft room holds.
 *
 * Frozen: the room is a historical import and is not being updated, so this is
 * a constant rather than a moving figure. It is asserted so the divergence the
 * app reports stays exactly three — if the room were ever updated, the check
 * fails loudly instead of the overlay silently double-placing a keeper.
 *
 * These 16 are the 14 in `data/keepers-2026-resolved.json` plus Scott Elbe's
 * Javonte Williams (R7) and Cam Skattebo (R9), which reached the room after
 * that file was generated. **Adding 14 + 3 to get 17 is the classic error here
 * and it drops Elbe's two twice over.**
 */
export const KEEPERS_IN_FROZEN_ROOM = 16;

/** The declarations the overlay supplies because they never reached the room. */
export const KEEPERS_FROM_DECLARATION_FILE =
  EXPECTED_KEEPERS - KEEPERS_IN_FROZEN_ROOM;

/** Keepers whose 2026 season is their last, after which they return to the pool. */
export const EXPECTED_FINAL_SEASON_KEEPERS = 6;
