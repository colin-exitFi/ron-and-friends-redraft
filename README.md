# Ron and Friends

The draft board for a 10-team Sleeper redraft league. Sleeper runs the season;
this app runs the offline draft, in the room, on draft night.

**Sleeper is read-only here.** Its API has no endpoint that records a pick, so
it cannot be a draft backend. The split is deliberate and it is the whole
architecture:

| | |
|---|---|
| **Sleeper** | The league's settings, its ten managers, the draft order, the scoring. Pulled with `npm run pull:sleeper`, never written to. |
| **This app** | The picks. The only thing that writes, and the record of the draft. |

## Running it locally

```bash
npm install
npm run dev        # http://localhost:3000
```

`/draft` and `/players` read the JSON snapshots in `data/` and need no database
and no network. Copy `.env.example` to `.env.local` only for the deployed
instance — `.env.local` is gitignored and no key belongs in a tracked file.

## The one thing to know before running a draft

**There are two separate draft stores, and you have to pick one.** Run locally
and picks are written to `data/draft-state-2026.json`, atomically, with a
timestamped copy in `data/draft-backups/` — no internet required at all. Run on
the production URL and picks go to Postgres instead, which is the only way two
devices see one shared draft. The board's footer tells you which store is live.
Entering picks in both leaves you with two half-drafts, so choose one and stay
on it.

## The league

Read off Sleeper league `1394372619427381248` and the 2026 Season Proposal,
which controls where the two disagree. `src/lib/league-config.ts` is the single
source of truth and every value there is marked with where it came from.

- 10 teams, snake, **14 rounds — 140 picks**, 120-second advisory clock
- 9 starters (QB, 2 RB, 2 WR, 2 FLEX, TE, DST — **no kicker**), 5 bench, 2 IR
- **Half PPR with a tight end premium**: a TE catch is a full point
- 6-point passing touchdowns; yardage and 40-yard explosive bonuses
- **Redraft.** No keepers in 2026, and **no draft-pick trading at all** — every
  slot belongs to the franchise it was born to

Two things no public ADP feed prices in, both of which make the board call a
correct pick a reach: the **tight end premium** and the **6-point passing TD**.
Tight ends and quarterbacks are both cheaper on the imported rankings than they
are worth here.

## Regenerating the board

The draft order comes from Sleeper. If it changes, re-pull and re-stamp — never
hand-edit the snapshot:

```bash
npm run pull:sleeper     # data/sleeper/*.json
npm run build:board      # 10 x 14 = 140 open slots, deterministic
```

`data/managers.json` is the one hand-maintained file: it joins Sleeper's handles
to real manager names, which the API does not carry.

## Verifying

Nothing here needs a database or a network unless it says so.

```bash
npm run lint
npx tsc --noEmit
npm run build

npm run verify:draft           # a complete 140-slot draft through the real engine
npm run verify:draft:dryrun    # the board renders and takes a pick
npm run verify:board:fit       # the board is legible at the back of the room
```

## Keepers

Not active. The league runs 2026 as a pure redraft and will vote on a keeper
framework for 2027, so **the keeper machinery is deliberately kept on disk and
importable** rather than deleted. It is switched off in the data — the keeper
declaration files are empty, so the overlay places nothing and all 140 cells are
open — and `FEATURES.keepers` gates the surfaces.

## Where things are documented

| | |
|---|---|
| `docs/DATABASE.md` | schema, seeding, the post-draft import, recovery |
| `DESIGN-BRIEF.md`, `BRANDING.md` | the look |
