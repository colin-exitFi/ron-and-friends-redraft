# The league database

Postgres on Supabase, project ref `opxyeajywipsitwecgcz` ("ron-and-friends-ff",
East US / N. Virginia), schema **`redraft`**. Twenty-one tables, applied as one
idempotent script, one idempotent seed.

> **The warning here used to point the other way, and it was inverted by the
> reskin.** It read "never target `opxyeajywipsitwecgcz`" — correct in the
> Ultimate Keeper tree this repo was copied from, and exactly backwards now.
> `opxyeajywipsitwecgcz` IS this app's database. The one to stay out of is
> `xqhkhcmphvytoibjewqi` ("UltimateKeeperLeague"), which holds a real completed
> draft; `npm run db:apply:redraft` refuses to connect to it by hardcoded ref.

> **Two schemas share this project, and fourteen table names collide.**
> `public` is the live backend for `ron-and-friends-fantasy.vercel.app` —
> `ballot_votes`, `treasury_ledger`, `standings`, `lottery`. This app is in
> `redraft` and writes nothing to `public`. Because `leagues`, `teams`,
> `trades`, `draft_state`, `votes`, `keepers` and eight more exist in BOTH, a
> client that loses its `db: { schema: 'redraft' }` does not fail — it reads and
> writes the other league's rows. The name is defined once, in
> `src/lib/db-schema.mjs`.

> **This repo does not push migrations.** The project's migration ledger in
> `supabase_migrations.schema_migrations` belongs to `../RonAndFriendsApp`.
> Pushing from here would leave that repo unable to push again. Use
> `npm run db:apply:redraft`; `npm run db:push` is a refusal that explains
> itself. Full reasoning in the header of `supabase/redraft-schema.sql`.

---

## The one thing to know first

**The draft does not need this database — on a machine with a disk.** `/draft`
and `/players` read the JSON snapshots in `data/` directly and, running locally,
write the live draft to `data/draft-state-2026.json`. That is deliberate: the
venue's wifi is not trusted, and a draft that stops when the network does is not
a draft tool. Everything in this document can be unreachable on Saturday and a
board running on the commissioner's laptop still works.

**Run on the deployment, the draft does need it.** A deployed instance cannot
write to its own filesystem, so its picks go to `draft_live_state` instead. See
"Where the live board is saved" below.

`/teams`, `/keepers` and `/trades` prefer the database and fall back to the same
JSON snapshots when it is absent. `/governance` genuinely needs it — motions and
votes have no snapshot to fall back to.

---

## Commands

| | |
|---|---|
| `npm run db:push` | apply migrations to the linked remote project |
| `npm run db:seed` | load the league from `data/` (idempotent) |
| `npm run db:seed:dry` | report what the seed would change |
| `npm run db:types` | regenerate `src/lib/supabase/types.ts` from the real schema |
| `npm run db:verify` | assert the four pages read correctly, live and offline |
| `npm run verify:board-keepers` | assert the board carries all reconciled keepers, no database |
| `npm run db:import:draft` | **after the draft** — load the result into Postgres (dry run) |
| `npm run db:verify:import` | end-to-end test of the importer (scratch database only) |
| `npm run db:verify:trades` | multi-hop pick and trade-reversal tests (scratch database only) |

`db:push` and `db:seed` need `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`,
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`, which
is gitignored. Confirm with `git check-ignore -v .env.local` before writing keys
into it, and never paste a key into a tracked file.

---

## Schema

Ten migrations, in order. They must stay in this order: later ones depend on
enums, tables and foreign keys created by earlier ones.

| migration | what it creates |
|---|---|
| `…170001_extensions_and_enums` | `pgcrypto`; the enums (`draft_status`, `keeper_status`, `trade_status`, `trade_asset_type`, `officer_role`, `officer_status`, `motion_status`, `motion_threshold`, `vote_choice`) |
| `…170002_core_tables` | `leagues`, `teams`, `players`, `draft_order` |
| `…170003_draft_board` | `pick_ownership`, `traded_picks`, `draft_slots`, `draft_state`, and the two shape-validation triggers |
| `…170004_keepers` | `keepers`, `keeper_rights`, the per-team keeper limit trigger |
| `…170005_trades` | `trades`, `trade_assets`, and the deferred FK from `traded_picks` |
| `…170006_governance` | `officers`, `motions`, `votes`, `commissioner_actions` |
| `…170007_rls` | RLS on every table: anonymous read, writes via the service role only |
| `…170008_realtime` | adds the board tables to the realtime publication |
| `…170009_seed_conflict_targets` | makes two unique indexes non-partial so `ON CONFLICT` can target them |
| `…170010_keeper_declaration_status` | `teams.keeper_declarations_closed_at` |

### What this schema is *not*

The starting point was the Ron & Friends schema, which was built for a different
league: 12 teams, Sleeper, a draft lottery, a treasury with dues and payouts,
FAAB, and transaction fees. **None of that exists here.** `lottery`,
`treasury_ledger`, `faab_balances` and every `sleeper_*` column are gone, along
with the `faab` member of `trade_asset_type` and the `household_review` trade
status. `players_cache` became `players`, keyed on the Smart Draft player id.

### The decisions worth knowing

**Original versus current ownership is two columns, never one mutable owner.**
Traded picks are central to how this league operates, and the board's first job
on draft night is showing who actually holds each slot. So `pick_ownership`,
`traded_picks` and `draft_slots` all carry both.

**The board column belongs to the ORIGINAL owner for all 16 rounds.** A traded
pick shows up as a foreign name inside someone else's column. That is why
`draft_slots` is unique on `(season, round, original_team_id)` — the grid
invariant. Two picks claiming one cell would silently hide one of them, and the
database refuses rather than letting the room draft off a board with a pick
missing.

**A pick is an asset before it is a board cell.** `pick_ownership` exists for
seasons that have no board, which is what makes a 2027 pick tradable today.
`draft_slots` is the physical grid and only exists once a season has one.

**Rounds and slots are bounded by the season's own `leagues` row**, not by
literals, via `assert_round_within_league_shape` and
`assert_slot_within_league_shape`. A future rules change edits a row instead of
migrating a CHECK. An unknown season is waved through on `pick_ownership` so a
2027 pick can be traded before a 2027 season row exists.

**Two counting conventions for the keeper clock, and the gap between them is
two.** `keepers.sheet_tenure_year` is the sheets' `"N of 3"`, which counts the
acquisition season. `keepers.seasons_kept` and
`keeper_rights.consecutive_seasons` count keeper seasons already SERVED,
excluding the acquisition season. A CHECK constraint ties the two together so a
row cannot claim both. All conversion goes through `seasonsKeptAfterSheetSeason`
/ `seasonsKeptEnteringSheetSeason` in `src/lib/keeper-clock.ts` — never subtract
by hand. Reading a `3` off a sheet straight into `seasons_kept` marks this year's
six final-season keepers as expired and quietly prints a wrong board.

**`basis_round` is last season's round, not the original draft round.** Cost is
`basis_round - 1`, or round 9 for a free-agent acquisition. A trade carries the
basis across untouched while resetting the clock, so the original round stops
being a usable basis the moment a player changes hands. `original_round` is kept
for the round-1 rule and for display.

---

## Manager identity — read this before touching any name matching

**Four of the ten managers share a first name with someone else.** First-name
matching is unsafe everywhere in this codebase.

| short name | manager |
|---|---|
| `Scott` | Scott Johnston |
| `Elbe` | Scott Elbe |
| `Kyle` | Kyle Mertens |
| `Witte` | Kyle Witte |

The keeper sheets' "Scott" is **Johnston**. Zach Rakowski and "Ted Buckman" are
the same person.

Rules, enforced in code rather than by convention:

- `teams.short_name` is unique, case-insensitively. `assertShortNamesAreUnique`
  in both `src/lib/league-json.ts` and `scripts/seed-league.mjs` fails loudly if
  that ever stops being true.
- `franchiseByName` rejects a bare first name that matches more than one
  manager. It does not pick one.
- Keeper sheet rows are **owner-matched**: a row whose manager does not match the
  live room owner is rejected and reported as a conflict, not silently used. This
  is what stops one Scott's keeper clock being read off the other Scott's row.
- Anything crossing a module boundary keys on `teams.id` (uuid) or the Smart
  Draft team id, never on a display name.

---

## Seeding

`npm run db:seed` loads the 2026 league from `data/`:

| | |
|---|---|
| `managers.json` | the ten franchises, ESPN names, short names |
| `smartdraft-room-snapshot.json` | draft order, 160 slots, ownership, 29 traded picks, room keepers |
| `smartdraft-players.json` | the 1,195-player pool (kickers excluded — ESPN has the K slot and the K roster limit both at zero) |
| `keepers-2026-resolved.json` | resolved keeper clocks |
| `keeper-eligibility-2026.json` | the 2025 basis rounds |
| `keeper-declarations.json` | declarations taken by the commissioner but not yet keyed into Smart Draft |
| `trade-log-2026-spreadsheet.json` | the 12-trade log |

**Idempotent by design**, because the keeper room is not final and declarations
arrive all week. Tables keyed naturally (`leagues`, `teams`, `draft_order`,
`players`, `pick_ownership`, `draft_slots`) are upserted. Tables the seed owns
(`keepers`, `trades`, `trade_assets`, `traded_picks`, `commissioner_actions`) are
replaced wholesale but **only the rows whose `source` the seed owns**, so a
declaration made through the app is never wiped by a re-seed.

It refuses to rewrite a board once `draft_state.status` is anything but
`not_started`, unless `--force`.

### Adding a late keeper declaration

This is a data edit plus a re-seed. No code change, and it can be done at the
table.

1. Add an entry to `data/keeper-declarations.json`.
   - `managerShortName` **must** be the short name from `data/managers.json` —
     `Elbe`, not `Scott Elbe`; `Witte`, not `Kyle Witte`. A bare first name is
     rejected.
   - List players **by name only**. Do **not** write a cost round: it is derived
     from `data/keeper-eligibility-2026.json` by "last season's round minus one",
     or round 9 for a free-agent acquisition. Hand-entering it is how a wrong
     number reaches the board.
2. `npm run db:seed` — if the eligibility data cannot price a player, or the
   franchise holds no pick in the required round, the seed **fails with the
   reason** instead of guessing.
3. `npm run db:verify` to confirm the pages read it, and
   `npm run verify:board-keepers` to confirm the board does.

A declaration left in this file after the Smart Draft room catches up is
harmless — it is deduplicated automatically.

### Smart Draft is an input feed, not the authority

Per the commissioner's ruling: the league has not adopted this app yet, so Smart
Draft stays the operational system and this app is on the path to replacing it.
So the room supplies the **base** board and this app's reconciled data **wins on
conflict**.

`src/lib/keeper-overlay.ts` applies declarations and rulings the room does not
have, and reports the divergence so the commissioner can see what still needs
keying in over there. It reads `data/` and never touches Postgres, so it holds
with the network down. The `/keepers` page shows that divergence compactly.

---

## After the draft: importing the result

**This is the most consequential thing in this document that has not happened
yet.** Do it Saturday night or Sunday, while the draft is fresh enough that you
would notice a wrong row.

### Why it matters

After Saturday, the database knows the keeper pedigree of the players who were
kept — 19 of them, and `npm run verify:board-keepers` is what prints that figure.
Next August, pricing keepers needs the pedigree of all 160 — the round each
player was taken in, and by whom. Every other player will be sitting in a JSON
file on the laptop. Without the import there is nothing to price 2027 against, and the
answer next August is to rebuild it from the spreadsheet, which is the thing this
project exists to stop doing.

### The commands

```bash
# 1. Dry run. Prints every one of the 160 rows it would write and changes
#    nothing. Read the output — it is the only chance to notice a wrong cell
#    while you still remember the draft.
npm run db:import:draft

# 2. Apply it.
npm run db:import:draft -- --commit
```

That is it. The importer is **idempotent** — every value it writes is absolute,
derived from the files, never an increment — so running it twice writes the same
rows and changes nothing the second time. If in doubt, run it again.

**Note there is no `--allow-remote` on these two commands, and that is
deliberate.** Do not add one on Saturday night when it is not asked for. The
importer is the one script here whose *job* is to write to the hosted project, so
it must not need an override to do it. It is protected differently — see the next
section.

### Which scripts refuse to touch the hosted project, and why they differ

Three scripts can write to the database, and they are guarded in two different
ways on purpose. Knowing which is which prevents both accidents and confusion.

| Script | Against the hosted project | Protection |
|---|---|---|
| `npm run db:import:draft` | **Runs.** This is its job. | Dry run unless `--commit`, plus it refuses on an incomplete or ambiguous board |
| `npm run db:verify:import` | **Refuses.** Needs `-- --allow-remote` | Hard target check — it *fills* a board with a 160-pick simulation |
| `npm run db:verify:trades` | **Refuses.** Needs `-- --allow-remote` | Hard target check — it writes trades, pick ownership and keeper rights |

The two verification suites refuse because they are **destructive by design**:
`db:verify:import` writes 142 simulated picks, which against the real project
would fill Saturday's board with fake players. Its own "is the board empty?"
check cannot catch that, because before the draft the real board *is* empty — the
suite would sail straight through. So the target itself is checked, and the only
way past it is to type `--allow-remote`, which nothing in this document ever asks
you to do.

The importer needs no such guard because its safety is in the workflow rather
than the target: it prints and writes nothing by default, and every validation
runs *before* the first write, so even the `--commit` form cannot write a partial
or ambiguous board. Point either verification suite at a scratch stack instead:

```bash
node scripts/seed-local-stack.mjs up   # prints a URL and keys to export
```

### How to confirm it worked

The importer verifies itself and prints the result. A successful run ends with:

```
IMPORTED — 2026 pedigree is in the database. 142 drafted, 18 kept.
Every one of those 160 players can now be priced as a 2027 keeper.
```

It checks, against the database and not against its own intentions, that all 160
slots hold the right player, that keepers are flagged as keepers, and that every
`keeper_rights` row carries the right basis round, clock and franchise. Any
failure exits non-zero.

To check by hand: `draft_slots` for 2026 should have 160 rows with a
`player_id`, and the keepers among them should carry `is_keeper = true` — 19 as
the board stands, which `npm run verify:board-keepers` reports; `keeper_rights` should have a
row for every one of those 160 players; and `draft_state.status` should read
`complete`.

### What it reads, and what it does not

It reads two file-backed sources and unions them to the full board:

- **live picks** through the real `draftStore`, which means
  `data/draft-state-2026.json` where the draft ran on a machine with a disk and
  the `draft_live_state` row where it ran on the deployment. Each pick carries
  `playerId` — the Smart Draft id, not a name.
- **keepers** from the reconciled keeper layer. Keepers are never written to the
  state file, which is what lets a late declaration land without rewriting picks
  already entered.

It does **not** read the CSV from `/api/draft/export`. That file carries player
names and no ids, so importing it would reintroduce the "Puca Nakua" class of
error. The CSV is for humans and printers.

Nothing in the importer runs on draft night and nothing in the draft path imports
it, so the code the room executes on Saturday is byte-for-byte the code that
passed its verification suites.

### It refuses rather than guessing

It will stop, write nothing, and tell you why if: the board is not full; the
snapshot and the entered picks disagree; a pick is credited to a franchise that
does not hold the slot; the same player is on the board twice (the draft room
allows this as a deliberate override — the database does not); a keeper on the
board has no reconciled row; a keeper's board round disagrees with his priced
cost round; a drafted player is not in the `players` table; or a keeper would
finish the season over the two-season limit.

Every one of those is a wrong price in August if guessed at.

For a mid-draft snapshot rather than a finished board, `--allow-incomplete`. It
skips marking the draft complete.

### Where the live board is saved

Two places, decided per process by `@/lib/draft-store`, and the board's footer
says which one is live:

- **A writable disk wins.** Running locally, every pick writes
  `data/draft-state-2026.json` atomically — temp file, fsync, rename, so a crash
  leaves either the previous complete file or the new complete file, never half
  of one — and drops a timestamped copy in `data/draft-backups/`. The room needs
  no internet at all.
- **A deployment has no writable disk**, so it writes the `draft_live_state` row
  instead, with the same document and the same backup discipline in
  `draft_live_backups`. This is not optional: a file write there fails with
  `EROFS` and the pick is lost. It is also the only way two devices see one
  draft.

Four hundred backups are kept either way, which covers a whole draft twice over.
`DRAFT_STORE=file` or `DRAFT_STORE=database` forces the choice if the detection
ever guesses wrong.

### If the laptop dies mid-draft

**The saved state and its backups are the only copy of the 2026 result until the
import runs.**

Recovery, in order of preference:

1. **Reboot and reopen `/draft`.** The picks are saved and the board rebuilds
   from them. Nothing is stored except the picks, so the board is derived and
   comes back by construction. This is the normal case, and on the deployment it
   is the whole story — the picks are in Postgres, not on the dead machine.
2. **If `data/draft-state-2026.json` is corrupt or gone**, copy the newest file
   from `data/draft-backups/` over it. They sort chronologically by filename. Do
   not delete the bad file — move it aside. The database equivalent is the newest
   `draft_live_backups` row for the season, copied back into
   `draft_live_state.state`.
3. **If the laptop is gone** and the draft ran on it, the picks are gone with it
   unless the directory was copied off. So: **get a copy of
   `data/draft-state-2026.json` and `data/draft-backups/` off the machine when
   the draft ends**, before anything else. A copied directory is a complete
   draft; a dead laptop with no copy is ten people reconstructing 160 picks from
   memory.

The importer reads whichever store it is pointed at, and can read a file backup
directly, which is the recovery path into the rest of the schema:

```bash
npm run db:import:draft -- --state-file=data/draft-backups/draft-state-2026-<timestamp>.json
# then again with --commit
```

---

## Trades

Two defects were found and fixed here. Both corrupted data silently, and neither
had a UI exercising it yet, which is why they survived unnoticed.

**A pick's identity is (season, round, ORIGINAL owner).** The asset ref used to
be `season:round`, which does not identify a pick once it has changed hands
twice — and multi-hop is routine: `Sheet3` of the workbook tracks round 1 pick 2
going Stefan → Witte → Zach and needs two hop columns to do it. Resolving the
`pick_ownership` row from the SENDER is only correct on the first hop, so the
second hop moved *the sender's own pick* instead of the acquired one, leaving two
board cells backwards. The ref is now `season:round:originalTeamId`; the
two-segment form still means "the sender's own pick" and is accepted only when
that is true, and an ambiguous ref is **refused** with the correct ref to use.
`traded_picks.original_team` is the franchise the pick was born to;
`traded_picks.from_team` is the sender of that hop, so the chain reconstructs.

**`reversed` un-applies the trade now.** It used to flip a status word and undo
nothing: pick ownership stayed moved and keeper rights stayed transferred, so a
mis-logged trade could not be corrected and nobody found out until the board
looked wrong. A reversal now returns pick ownership to the sender, deletes the
hop rows the trade wrote (a reversed trade did not happen; the audit trail is the
trade's status and notes), and restores keeper rights.

Restoring a keeper clock needs the clock the player carried *before* the trade,
which nothing recorded. `transferRightsOnTrade` now stamps it into
`keeper_rights.prior_owner_clocks` — a column that already means exactly that,
"the clock a player carried when he left each roster". Two things fall out: a
reversal has an exact value to restore, and a manager who trades a player away
and re-acquires him resumes the clock he left with instead of getting a free
reset. A trade applied before that stamp existed cannot be reversed faithfully,
so the reversal **refuses and says so** rather than inventing a clock.

Assets are restored *before* the status flips, so a partial failure leaves the
trade marked accepted — honestly still needing attention — rather than claiming
to be undone with half its assets moved.

`npm run db:verify:trades` proves all of this against a scratch database, using
the real Stefan → Witte → Zach hop.

---

## Verification

`npm run db:verify` covers the four pages against both a live database and the
offline JSON fallback, including regression checks for the manager name
collisions above.

`npm run verify:board-keepers` proves the draft board carries every reconciled
keeper with no database and no network.

`npm run db:verify:import` and `npm run db:verify:trades` **fill the board and
create trades**, so they must only be pointed at a scratch database. Both refuse
to run against one whose 2026 draft is under way, but the real protection is the
env override.

### A scratch stack without Docker

There is no Docker on this machine, so `supabase start` is unavailable.
`scripts/seed-local-stack.mjs` assembles the same surface from Homebrew Postgres
and Homebrew PostgREST plus a small proxy that strips the `/rest/v1` prefix
supabase-js adds. Real Postgres parsing the real migrations, real constraint and
trigger enforcement, real supabase-js over HTTP. It does not cover Supabase Auth,
Storage or Realtime, none of which these pages need for a first render.

```bash
node scripts/seed-local-stack.mjs up     # own cluster in .local/pg, never 5432
# it prints the URL and keys; export them, then:
node scripts/seed-league.mjs
npm run db:verify:import
npm run db:verify:trades
node scripts/seed-local-stack.mjs down
```

`up` stays in the foreground serving the gateway. `reset` drops the database and
re-migrates, and takes PostgREST down with it — bring the stack back up
afterwards.

---

## Still open

- **Joe Murray has not declared.** The process above handles it: data edit plus
  re-seed.
- **The Nacua contingent trade** resolves the day before the draft. It is flagged
  provisional on `/trades` until then.
- **Officers are not recorded.** `officers` is empty; the governance page is
  waiting on them.
- **No trade-entry UI.** The API routes and the logic exist; there is no form.
  Today a trade enters the system by editing the spreadsheet export and
  re-seeding.
- **No roster table.** `keeper_rights.current_team_id` is a live pointer with no
  season dimension and no history, so it cannot answer "who was on Elbe's roster
  when 2026 ended". It also carries no stamp for *which* season a basis round has
  been walked down for, which is why the draft importer writes absolute values
  instead of calling `applyKeeperSeason()` — that function walks the basis and
  advances the clock, correct once and corrupting twice. This is the one schema
  decision that gets more expensive with every week of real data.
- **No season rollover.** The 2027 `leagues` row and its 160 `pick_ownership`
  rows exist; there is no `draft_order`, `draft_slots` or `draft_state`, and
  nothing that advances a season.
- **The trade-and-reset loophole** goes to a league vote in the offseason, and
  the vote should land before the 2027 keeper clocks are computed. Until then the
  app implements the rule as written. See `data/DECISIONS.md`.

### Settled since

- **First-round picks can never be kept** (ruling, Aug 26 2026). This was the
  "round 0" question. `KEEPERS.round1Eligible` is now `false` and
  `keeperCostRound` returns **null** for a barred player rather than clamping to
  round 1, so no surface can print a nonsense round. It keys on the round
  OCCUPIED last season, so it catches a round-2 pick kept down to a first as well
  as an actual first-round pick — and that case is not covered by the clock, so
  the rule does real work. Nothing about 2026 changed; `npm run verify:round1`
  proves it.
