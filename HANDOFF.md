# Ultimate Keeper League — project handoff

Read this first. It carries over the context from the chat where this project was
created, which lived in a different Cursor workspace and is not visible here.

## What this is

A retrofit of the "Ron & Friends" fantasy football app (a separate, live league
belonging to the same commissioner) into a new app for the **Ultimate Keeper League**.

The source project lives at `/Users/colintracy/Desktop/RonAndFriendsApp`
(GitHub: `colin-exitFi/ron-and-friends-fantasy`, private). It is **live and in use by a
different league**. Read from it freely as a reference. Never commit, push, deploy, or
edit anything there, and never touch its Supabase database.

## The deadline

**The offline draft is Saturday, Aug 29, 2026.** Everything is prioritized around
having a working, good-looking draft board by then.

Ranked priorities, per the commissioner:

1. **Live draft board with traded picks** — the board must show who actually owns each
   slot, not just the original owner. He has the traded-pick list.
2. **Player pool with rankings/ADP** for drafting.
3. Keepers with the two-year clock, correct and visible.
4. Branding (new logo, new colors) — lands last, after the draft mechanics work.

## League facts

- **10 teams** (the source league is 12).
- **Keepers are ON**, with a **two-year clock**. In the source app keepers are disabled
  via `KEEPERS_ACTIVE_FOR_CURRENT_SEASON = false`; here they must be enabled.
- **Traded draft picks and traded players** are central to how this league operates.
- **Offline draft**, run in person — the draft room needs to work for a human
  commissioner calling picks aloud.
- **No kicker position.**
- **No transaction fees, no treasury.**
- **No draft lottery.**
- **Platform is ESPN**, not Sleeper. The ESPN league is **private**, so reading it
  programmatically needs the `espn_s2` and `SWID` browser cookies from the
  commissioner's logged-in session.

## Data sources

- **Smart Draft app** — a third-party draft tool the league was going to use. The
  commissioner is sharing a link to it. It reportedly already contains **keepers,
  traded picks, and player rankings** (the rankings come from a Reddit-sourced system).
  This link is the highest-value data source for Saturday; pull everything from it.
- The commissioner will supply the **10 managers and team names** directly.

## Setup state

- Database: a **new, separate Supabase project** named `ultimate-keeper-league` is live,
  wired up and seeded. It shares no data with the Ron & Friends project. See
  `docs/DATABASE.md` for the project ref, the migrations and the seed.
- Secrets handling: the commissioner prefers to paste the Supabase service-role key and
  the ESPN cookies into a local env file himself rather than into chat. Create the env
  file with clearly labeled empty placeholders and ask him to fill it in.
- Vercel: the project exists and is live at `https://ultimate-keeper-league.vercel.app`.
  It auto-deploys from `main`, the same way the source project does, so **a push is a
  production release.**
- GitHub: this repo is `colin-exitFi/ultimate-keeper-league`, private. The `gh` CLI has
  two accounts on this machine and the active one must stay `colin-exitFi`, or pushes
  will fail with a misleading "Repository not found" error.

## Working style that suits this commissioner

He is sharp but not a programmer. Explain in plain language, lead with the outcome, and
don't bury decisions in jargon. He moves fast and will tell you when something looks
wrong — believe him. When league facts conflict, the most recent thing he said wins.
