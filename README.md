# Ultimate Keeper League

The draft board and league ledger for a 10-team ESPN keeper league. ESPN runs the
season; this app runs the offline draft in person, and keeps the keeper clocks,
traded picks and trade history that make next year's board correct.

Production: **https://ultimate-keeper-league.vercel.app**

The repo is deployed from `main` by Vercel. There is no separate deploy step —
**a push to `main` is a production release.** Run the build and the relevant
`verify:*` scripts before pushing, not after.

## Running it locally

```bash
npm install
npm run dev        # http://localhost:3000
```

`/draft` and `/players` read the JSON snapshots in `data/` and need no database
and no network. `/teams`, `/keepers` and `/trades` prefer Postgres and fall back
to those same snapshots; `/governance` needs the database.

Copy `.env.example` to `.env.local` and fill it in for anything that talks to
Supabase. `.env.local` is gitignored and no key belongs in a tracked file.

## The two things to know before running a draft

**There are two separate draft stores, and you have to pick one.** Run locally
and picks are written to `data/draft-state-2026.json`, atomically, with a
timestamped copy in `data/draft-backups/` — no internet required at all. Run on
the production URL and picks go to Postgres instead, which is the only way two
devices see one shared draft. The board's footer tells you which store is live.
Entering picks in both leaves you with two half-drafts, so choose one and stay on
it.

**After the draft, the result has to be exported into the database.** Until
`npm run db:import:draft` has run, `data/draft-state-2026.json` and
`data/draft-backups/` are the *only* copy of the result — get them off the laptop
when the draft ends. Next year's keeper pricing has nothing to price against
until the import lands. `docs/DATABASE.md` has the procedure.

## Verifying

Nothing here needs a database or a network unless it says so.

```bash
npm run lint
npx tsc --noEmit
npm run build

npm run verify:board-keepers   # the board carries every reconciled keeper
npm run verify:keepers         # keeper costs match the live room, both clock conventions
npm run verify:round1          # first-round picks cannot be kept
npm run verify:draft           # a complete 160-slot draft through the real engine
npm run verify:expected        # the keeper-adjusted ADP behind reach/steal verdicts

npm run db:verify              # the pages read correctly, live and offline
```

`npm run db:verify:import` and `npm run db:verify:trades` **fill a board and
write trades**, so they only ever run against a scratch stack
(`node scripts/seed-local-stack.mjs up`), never the hosted project.

## Where things are documented

| | |
|---|---|
| `HANDOFF.md` | league facts, how this project came about, working style |
| `ROADMAP.md` | what gets built after the draft, and why |
| `docs/DATABASE.md` | schema, seeding, the post-draft import, recovery |
| `data/DECISIONS.md` | league rulings of record |
| `DESIGN-BRIEF.md`, `BRANDING.md` | the look |
