# Roadmap — Ultimate Keeper League

Written 2026-08-26, three days before the draft, and revised the same evening
after the commissioner answered three of the five open questions.

Scoped to his own description of the product: ESPN runs the season, this app is
the ledger that makes next year's keeper draft correct.

Nothing in this document touches Saturday. The board, the keeper list and the
pick ownership for 2026 are done or in flight; everything below starts Saturday
night at the earliest.

---

## What the app is

Two moments of use, and genuinely nothing in between.

**In-season, occasionally.** A trade is approved in ESPN. Someone opens this app
and logs it: players, picks, FAAB, both directions. A few dozen times a year,
often from a phone, minutes after the trade goes through.

**Preseason, once.** Keepers are declared. Each one is priced into a round from
last year's draft board and his clock position. The board is auto-set with
traded picks already sitting in the right columns.

Plus one chore at the end of the season, now that the commissioner has agreed to
it: paste the ten final rosters and the final standings out of ESPN. Once a
year, about twenty minutes.

No waivers, no FAAB balances, no lineups, no scoring, no weekly matchups. ESPN
owns all of it. FAAB appears only as a line item inside a logged trade — a dollar
figure that moved, not a balance the app maintains. I found no evidence the
league needs a FAAB ledger and I am not proposing one. The contradictory
`WAIVERS_TRADITIONAL` + `$100 acquisitionBudget` pair in ESPN's settings is a
question about the ESPN config, not about this app.

**And there is exactly one user.** The commissioner has ruled out accounts of any
kind — not real auth, and not the per-franchise token links I offered as a
fallback. He enters everything himself, on his own machine. That is a defining
property of the design, not a limitation to work around, and it removes more
than it costs: no accounts, no invites, no password resets, no per-manager
permission model, and no multi-user concurrency anywhere. Every screen below is a
single trusted operator, so a form can assume it is the only writer. That is
roughly a week of work and an annual support burden that no longer exists.

## The honest size of this

Smaller than it looked this morning, and much less uncertain.

Three of the five open questions are now closed, and the two that closed
cleanly — rosters and auth — were the two carrying the most risk. Auth is gone
outright. The roster paste is confirmed, which turns the biggest unknown in the
rollover into a twenty-minute chore. The third answer, on draft order, *adds* a
small piece of work, but it does something more valuable than that: it corrects
an assumption that would have quietly printed a wrong board next August.

Net, this is four focused pieces of work plus one mandatory data step, and the
schema seeded tonight is most of the way there. Roughly two to three weeks of
build, spread across a year.

The reason it is this small is a property of the re-scope worth stating
explicitly. The one-year-out pick rule means the pick ledger never needs to be
deeper than two seasons, and `pick_ownership` already has exactly that shape:
`(season, round, original_team, current_team)`, with 2027 seeded untraded and
`TRADES.futurePicksSeasonsOut` already set to 1. The tradable window the code
enforces today is `[2026, 2027]`, which is precisely the confirmed rule. Nothing
to change.

And here is the load-bearing insight, now that the roster paste is confirmed.

**At the end of the season, the only things this app needs from ESPN are ten
lists of names and ten finishing positions.** Not transactions, not waiver
history, not FAAB spend. Because every player on a roster next February is in
one of three categories, and the app can tell them apart:

- He was drafted or kept by that franchise in 2026 → the app knows his round and
  his clock, so it knows his price.
- He was traded to that franchise during 2026 → the app knows, *because the trade
  was logged*, that his cost basis carried and his clock reset.
- The app has never heard of him on that roster → he is by definition a
  free-agent acquisition, and the rule prices him at round 9 with no pedigree
  needed at all.

Look at the 2026 keeper sheet and you can see how much work that third case
does: a large share of its 167 rows are round-9 free agents. The app does not
need to track the waiver churn that produced them. It needs to recognise that it
*doesn't* recognise them, which is free.

Which means logging trades is not one feature among several. It is the single
thing that closes the gap between "a list of names" and "a correctly priced
keeper board." Everything else is bookkeeping around it.

---

## The draft order rule, and why it matters more than it sounds

This was the answer I most needed and the one I would have got wrong. In the
commissioner's words:

> "Reverse standings in terms of who gets to pick their draft pick — last gets to
> pick what slot they want and so on. So this year I got 3rd place and picked
> 10th pick (with Greg and Stefan behind me to pick their spots): Greg 9th,
> Stefan 8th. So reverse standings, pick your pick in that order."

So the mechanic is a **slot auction in reverse-standings order**, not a
reverse-standings assignment. The franchise that finished last chooses first and
takes **whichever slot it wants**. The next-worst chooses from what remains, and
so on down to the champion, who takes whatever is left.

Any implementation that assumes "worst team gets 1.01" produces a wrong board,
and the evidence is right there in his example. He finished **3rd** and took the
**10th** slot. In a sixteen-round snake, slot 10 is the turn — picks 10 and 11
back to back — so a late slot is a desirable *choice*, not a leftover. Greg and
Stefan chose after him, at 9 and 8, which means they finished 2nd and 1st: the
champion chose last and ended up at slot 8. That reconciles exactly with the
already-recorded ruling that Stefan is 8th and Colin 10th, and it now explains
*why*, which the ruling never did.

Three consequences for the plan.

**The order is not derivable from standings, even in principle.** Standings only
give you the sequence in which franchises choose. The choices themselves are ten
human decisions that must be recorded as they are made. Design for that rather
than trying to eliminate it.

**Final standings have to come back into the schema.** They were dropped earlier
as Ron & Friends cruft, correctly at the time. What has to return is minimal:
final position per franchise per season, and nothing else. No week-by-week
records, no points-for, no tiebreakers — ESPN computes the finish and he pastes
the result.

**The output already has a home.** The `draft_order` table is
`(season, slot, team_id, source, locked, locked_at)` with a primary key on
`(season, slot)` and a unique constraint on `(season, team_id)`. That is exactly
the right shape for recording chosen slots, and the constraints already make a
double-assignment impossible. No new table for the output.

### Recommendation: write this rule down where rules live

It exists nowhere in the repo. `league-config.ts` says only "Draft order is set
by the commissioner, not drawn," and `DECISIONS.md` records the 2026 slots
without the mechanic behind them. It is a league rule of the same standing as the
keeper clock, and it is exactly the kind of thing that gets guessed wrong by the
next person to touch this — I nearly did. **I would add it to
`data/DECISIONS.md` as a confirmed rule, with the commissioner's example
preserved as the worked case.** I have not edited that file, since another agent
is active in it tonight; flagging it as the recommendation instead.

---

## What already works

Worth being specific, because it changes what is left to build.

`acceptTrade()` in `src/lib/trades.ts` already runs most of the downstream
cascade. Accepting a trade moves `pick_ownership.current_team`, appends to the
`traded_picks` log, and transfers keeper rights with the clock reset that rule 5
requires. `buildBoardFromOwnership()` pushes ownership onto `draft_slots`,
matching on `(round, original owner)` rather than current holder — the right
key, and what makes a traded pick land in the correct column.
`validateAssets()` already refuses a pick the sender does not own, and refuses a
player traded straight back to the franchise that just sent him away.

Keeper pricing works. `keeper-clock.ts` is careful and holds the two counting
conventions apart with named functions, so a call site has to declare which
column it is reading. The `keepers` table carries both conventions with a CHECK
that keeps them in step. `syncBoardKeepers()` places a keeper on any pick his
franchise holds in the cost round, including an acquired one, which is settled
practice here — four of the keepers the Smart Draft room already carries sit on
someone else's pick.

So the board auto-setting from traded picks, which was priority one for
Saturday, is genuinely built. What is missing for it to run *unattended* next
year is narrower than it sounds, and it is all in Phase 4.

## The gaps

**1. There is no way to enter a trade.** The API exists (`POST /api/trades`,
`POST /api/trades/[id]`) and the logic behind it is sound. There is no form. The
only write UI anywhere outside the draft room is the franchise editor on
`/teams`. Today a trade enters the system by hand-editing a spreadsheet export
and re-running the seed. That is the product, and it does not exist yet.

**2. FAAB is not a representable asset.** The `trade_asset_type` enum is
`('player', 'pick', 'keeper_right')` — `faab` was deliberately removed as Ron &
Friends cruft, and `trade-rules.ts` mirrors that in its TypeScript union. Adding
it back is `ALTER TYPE ... ADD VALUE` plus a union member plus a label; call it
an hour. Cheap now and it stays cheap, since there is no FAAB data to migrate.

**3. There is no record of who is on a roster, and no record of finishing
position.** Sixteen tables, neither of those among them. The nearest thing to a
roster is `keeper_rights.current_team_id`, one row per player, mutated in place.
That works as a live pointer but has no season dimension and no history, so it
cannot answer "who was on Elbe's roster when 2026 ended," which is the input to
2027 pricing. It also has no stamp recording *which* season a basis round has
been walked down for, which is a live double-decrement hazard:
`applyKeeperSeason()` walks the basis and advances the clock, it is called at
declaration time from `keepers.ts`, and nothing prevents it running twice.

**4. There is no rollover.** No script, no route, nothing that advances a season.
The 2027 `leagues` row exists but its `settings` reads
`"Placeholder season so 2027 picks can be traded."` There are 160
`pick_ownership` rows for 2027 and no `draft_order`, no `draft_slots`, no
`draft_state`.

### Two defects to fix before real data lands on them

`applyAsset()` writes `traded_picks.original_team = a.fromTeamId`. That is only
correct on a pick's first move. `Sheet3` of `Draft Picks 2026.xlsx` shows the
multi-hop case is routine — round 1 pick 2 went Stefan → Witte → Zach, and the
spreadsheet has two hardcoded hop columns to cope. `pick_ownership` stays correct
because its `original_team` is immutable, so the board will still draw right; it
is the log that will lie about provenance, which is exactly what you will be
reading next August to understand why a cell looks wrong. Fix it before the first
trade is logged through the app, or you are back-filling.

`setTradeStatus(id, 'reversed')` flips the status and un-applies nothing. Pick
ownership stays moved, keeper rights stay transferred. Given that the whole point
is that a mistake in November must be catchable, a reverse that does not reverse
is worse than no reverse at all.

---

# Phases

## Phase 0 — Saturday night: get the draft into Postgres

**Half a day, and already in flight.** This is no longer a gap; it is a task with
a date.

`/draft` is deliberately file-backed — `draft-store.ts` writes
`data/draft-state-2026.json` atomically with a timestamped backup on every pick,
because the venue's wifi is not trusted. The importer is being built as a
**standalone post-draft script**, deliberately *not* wired into the live draft
path before Saturday. That is the right call: the draft path is the one thing
that must not change this week, and adding a database write to it before the
draft trades a certain small benefit for an uncertain large risk.

So the data reaches Postgres by an explicit command run Saturday night. The
script reads the state file against the board and, for each of the 160 slots,
writes `draft_slots.player_id` plus a `keeper_rights` row: `original_round` and
`basis_round` set to the round he was taken in, `current_team_id` set to the
drafting franchise, `consecutive_seasons` zero. For the keepers on the board it
walks the basis to the cost round they actually occupied and advances the clock
by one.
`recordDraftSelection()` and `applyKeeperSeason()` already do both halves.

Run it with a dry-run mode first and read the diff. Do it while the draft is
fresh enough that a wrong row would be obvious.

**Why it matters:** after Saturday the database knows the keeper pedigree of the
seeded keepers only — **19** as the board stands, per
`npm run verify:board-keepers`. Next August it needs pedigree for
essentially all 160. The rest are the draft itself. Without this step,
2027 pricing has nothing to price against and the answer is to rebuild it from
the spreadsheet, which is the thing this project exists to stop doing.

**Post-draft improvement, not a gap:** once the draft is over and the risk
window has closed, wiring the write inline — so a pick lands in Postgres as it
is entered — removes the separate step for 2027 and onward. Small, and much
safer to do in September than this week.

Also: the draft JSON and its backups are the only copy of the 2026 result. Get a
copy off the laptop.

## Phase 1 — trade entry

**The main build. Two to four days of focused work.** Needs to be live before the
first in-season trade, so realistically within a few weeks of the draft rather
than by the week 11 deadline. Trades happen early.

Depends on the FAAB enum value, and on the Phase 1b decision if a logged trade is
to move a player between rosters.

### The form

One screen. Pick the two franchises, then add line items in either direction.

- **Players come from a combobox, never a text field.** This kills an entire
  class of error at the source rather than patching it downstream with an alias
  map. `player-combobox.tsx` and the fuzzy search in `draft-search.ts` already
  exist and are good — the draft room uses them under time pressure with ten
  people watching.
- **Picks come from a dropdown of what the sender actually holds.**
  `validateAssets()` already rejects a pick the sender does not own; the UI
  should simply not offer it. The list is short — at most 32 entries across two
  seasons — labelled "2027 R4 (originally Kyle's)".
- **FAAB is a dollar amount** and nothing else.
- **Everything derivable is derived:** season, `keeper_clock_reset` (always true,
  because it is a league rule and not a per-trade choice), `executed_at`, and the
  trade goes straight to `accepted` because ESPN already approved it. There is no
  propose/accept dance to model; the app is recording a fact that has already
  happened elsewhere.

No required free-text field anywhere. A notes box is fine; needing it is not.

Because there is exactly one writer, the form needs no optimistic locking, no
conflict resolution, and no permission checks. Worth saying out loud, because
those three things are where a form like this usually gets expensive.

### Making a November mistake visible in November

This is where the design effort belongs, and the part I would push back on if it
got cut for time. Nine months between input and payoff, with no feedback in
between, is the actual risk in this project.

**Confirm the consequence, not the input.** After saving, do not echo back what
was typed — echo back what changed. *"Zach now holds Kyle's 2027 round 6. Kyle
holds 15 picks in 2027, Zach holds 17. Ladd McConkey's clock reset; he is now in
year 1 of 2 with Zach, at a round 6 basis."* A wrong entry is far more likely to
look wrong stated as an outcome than as a form recap. Cheap, and I think the
highest-value single thing in the phase.

**Make reverse actually reverse.** Un-apply pick ownership, un-transfer rights,
append a compensating row to `traded_picks` rather than deleting history. Without
it, correcting a mis-logged trade means hand-editing Postgres, which is how you
end up not correcting it.

**A standing reconciliation view.** The 2027 pick-ownership grid — ten
franchises, sixteen rounds, who holds what — visible on the trades page all year,
not built in August. Sixteen by ten is small enough to eyeball, and a manager who
thinks he owns a pick he doesn't will say so in November. That is free validation
from ten people who care, and it is the only feedback loop available during the
quiet stretch.

**Machine-checkable invariants, on one page that is either green or a list of
problems.** Every round in 2027 has exactly ten owners. No player has rights
pointing at two franchises. No `traded_picks` row whose `original_team` disagrees
with the `pick_ownership` row it describes. An afternoon, and it is the
difference between finding out in November and finding out at the draft table.

**What I would not build:** scheduled email digests, a monthly nudge, an approval
workflow. Ten managers who see each other every week will catch a wrong pick
faster than any notification system, provided the reconciliation view exists for
them to look at.

## Phase 1b — the schema decisions to make now

**Half a day, perhaps forty lines of SQL, and it is the one thing here that gets
more expensive the longer it waits.** The database was seeded tonight, so the
window where this is free is now.

**A per-season roster snapshot.** One thin table — `(season, team_id, player_id,
source)` — written once at the end of the season from the pasted rosters. That
becomes the immutable input to the 2027 eligibility list, and combined with the
three-category logic above it is *all* the app needs. The alternative, leaning on
`keeper_rights.current_team_id` as a live pointer, cannot answer the question as
a fact, only as a current state that in-season ESPN activity has silently
invalidated. Take the table.

**A `basis_season int` stamp on `keeper_rights`.** This is what lets
`applyKeeperSeason()` refuse to walk a basis down twice for the same season.
Trivial today; unpleasant to retrofit once real declarations rest on the current
shape.

**A minimal standings table.** `(season, team_id, final_position)`, unique on
`(season, final_position)`. Ten rows a year, and it is the input to the
slot-selection order. Resist the temptation to model anything more — ESPN
computes the finish and the app only records it.

**And fix `traded_picks.original_team`** while nothing depends on the wrong
value.

One thing explicitly *not* to build: a roster with a transaction log — adds,
drops, IR moves. That is an in-season system, which has been ruled out.

## Phase 2 — the quiet stretch

**Near zero work.** Log trades as they are approved. Glance at the reconciliation
view now and then.

One deliberate non-feature: **do not enforce the trade deadline.** ESPN's is
2026-11-20 08:00Z — 2am Central on the Friday of week 11 — and ESPN already
blocks trades after it. If the app also enforces it, the one thing that happens
is that a legitimate late-logged trade gets refused by software at the exact
moment someone is trying to do the right thing. Show the date; don't police it.

## Phase 3 — end of season: the one paste

**One to two days to build, twenty minutes a year to use.** Runs once, in
January.

One page, both inputs together, so it is one chore rather than two: ten roster
lists and ten finishing positions. The commissioner will be copying out of ESPN,
so the parser has to be forgiving about ragged formatting — position tags, NFL
team abbreviations, injury designations, and blank lines all arriving mixed into
the names.

**Name resolution is the whole job, and the risk is larger and more structured
than the two trade-log typos that bit this project already.** Checking the 2026
keeper sheet's names against the Smart Draft player pool turns up three distinct
classes:

- **Genuine misspellings.** `Oronde Gadsen` for Gadsden, `Rashid Shaeed` for
  Shaheed, `Paker Washington` for Parker, `Patrios` for Patriots. Fuzzy matching
  gets close; a human has to confirm.
- **Suffix variance.** The pool drops suffixes entirely — `Travis Etienne`,
  `Marvin Harrison`, `Patrick Mahomes`, `Michael Pittman`, `Tyrone Tracy`,
  `Chris Rodriguez` — while the sheets and ESPN write `Jr`, `Jr.` and `II`.
  Mechanical, and `seed-league.mjs` already strips suffixes.
- **D/ST uses a different convention altogether.** The pool has
  `New England Patriots` and `Houston Texans`; the sheets write `Patrios`,
  `Vikings`, `Colts`. Every one of the ten D/ST rows will fail an exact match.
  That is a whole class, not an edge case — roughly ten of about a hundred and
  seventy rows every year.

So the shape is: parse leniently, resolve against the known pool, and then show
three buckets — matched, ambiguous with candidates to choose from, and unmatched.
**Nothing commits until the unmatched bucket is empty.** A silently dropped name
is a player who becomes a round-9 free agent next August when he should have cost
a 3rd, and nobody would notice until the draft table.

The alias map currently lives as two hardcoded entries in `seed-league.mjs`.
Every confirmation made in this flow should write back to a persistent alias
table instead, so the second year is easier than the first.

## Phase 4 — the 2027 preseason

The payoff. Four pieces, none of them large.

### The rollover — two to three days, and it wants to be a script

One command with a dry-run mode, re-runnable, printing a diff before it commits.
Not a button — this runs once a year and you want to read what it intends to do
before it does it.

1. Promote the 2027 `leagues` row from placeholder to real, carrying the rule
   columns forward.
2. Create the 2028 `pick_ownership` set, untraded, so the one-year-out window
   moves with the season. The seed already does exactly this for 2027, so there
   is a working precedent.
3. Age the clocks. The six players in a final keeper season for 2026 — Garrett
   Wilson, Jaxon Smith-Njigba, Brock Bowers, Chase Brown, Trey McBride and Justin
   Jefferson — return to the pool and must be refused if declared.
4. Carry basis rounds forward from the 2026 board, using the Phase 3 roster
   snapshot to know who is still where.
5. Build the 160 `draft_slots` rows for 2027 — **but only after slot selection
   has finished**, since `pick_in_round` and `overall_pick` cannot be computed
   until the slots are known.

Steps 3, 4 and 5 are things the existing code already knows how to do in pieces.
The rollover is mostly sequencing them and refusing to run when an input is
missing — the pattern `seed-league.mjs` already follows, and follows well: it
fails with a stated reason rather than guessing. The rollover should inherit that
temperament exactly.

### Slot selection — half a day to a day

The new piece, and small. Conceptually the same shape as the draft board: someone
is on the clock, a set of choices remains, and a choice gets recorded.

Derive the selection sequence from the standings — worst finisher chooses first,
champion last. Show the ten slots with the taken ones marked, and for each
remaining slot show what it actually buys: its pick numbers across the snake, so
the turn at slot 10 reads as "10 and 11 back to back" rather than as "last."
That is derived, free, and it is the information a manager is actually weighing.
Record each choice into `draft_order`, and allow an undo.

Choices will arrive over days, by text, as managers get round to it — which is
the argument for a sequential screen over a ten-row form. The form would be
smaller; the screen prevents the state of "who has chosen and what is left" from
living in his head for a week.

Worth noting: slot selection and keeper declaration are independent of each
other. A traded pick moves a *round*, not a slot, and `syncBoardKeepers()` places
a keeper on any pick his franchise holds in the cost round. So the two can happen
in either order, and only step 5 of the rollover depends on selection being done.

### Keeper declaration — one to two days

Twenty rows of data. Ten franchises, two keepers each.

Pre-compute every eligible player's cost for every franchise before the page
opens, so a declaration is two clicks and no typing. The pricing already exists
and is correct; the eligibility list comes from the Phase 3 snapshot. Show the
clock in both conventions the way `/keepers` already does — "Year 2 of 2" beside
the sheet's "3 of 3" — because that is the number managers will argue about.

`teams.keeper_declarations_closed_at` already exists and already distinguishes
"hasn't answered" from "keeping nobody," which is what makes chasing
declarations possible. Use it; it was a good call.

With no manager accounts, this is a commissioner-operated screen: declarations
arrive by text and he enters them, exactly as Zach's did this week.

### The board without Smart Draft — one to two days

A dependency nobody had named. `/draft` gets its board from
`data/smartdraft-room-snapshot.json` via `getBoard()` in `smartdraft.ts`. In 2027
there will be no Smart Draft room unless one is created. So either the room keeps
getting pulled every year and this app keeps overlaying it — the current
arrangement, and fine — or `getBoard()` needs a second implementation reading
`draft_slots` from Postgres. The file says so itself at the top: *"a matter of
writing a second implementation of `getBoard` / `getPlayerPool`."*

This is the moment the app stops needing Smart Draft at all. Worth doing then,
not now, but worth knowing that "the board auto-sets next year" quietly assumes
it.

---

# Decisions still open

Two. Both were open this morning and both remain sharp.

**1. What does a round-1 keeper cost?** The rule "one round cheaper than last
season" prices a first-rounder into round 0, which does not exist. This did not
matter for 2026 — the most expensive keeper on Saturday's board is a 4th. **It
has gained urgency for 2027.** Ten players on the 2026 eligibility sheet already
price to round 0 — CeeDee Lamb, Saquon Barkley, Derrick Henry, Jonathan Taylor,
Amon-Ra St. Brown, Ashton Jeanty, Christian McCaffrey, Malik Nabers, Jahmyr
Gibbs and Bijan Robinson — and everyone taken in round 1 on Saturday joins them.
The plausible answers are that a round-1 pick cannot be kept at all, or that the
cost floors at round 1 and stays there. The code floors at 1 today as a
placeholder, not as a ruling. Cheap to decide now; ugly to decide in August with
someone's Ashton Jeanty on the line.

**2. Should the trade-and-reset loophole be closed before the rollover runs, or
after?** Rule 5 as written resets a player's keeper clock on a trade while his
cost basis carries, which is what lets Scott hold Nacua through 2028 and what let
you hold Trey McBride a third season. The rollover has to bake in one reading or
the other. If the rule is going to change, changing it before the 2027 clocks are
computed is far cheaper than changing it after — and the three live cases that
turn on it (Nacua, Skattebo, McConkey) all differ only on 2028 eligibility, so
there is time, but not unlimited time. I am not asking for the rule here, only
for whether it gets settled before the rollover.

## Recommendation, not a question

Record the draft-order rule in `data/DECISIONS.md`, with the commissioner's own
example as the worked case. It is a league rule of the same standing as the
keeper clock, it exists nowhere in the repo, and it would have been guessed
wrong.

## One small piece of housekeeping

`vercel.json` schedules a daily cron against `/api/players/refresh`, which does
not exist in this codebase — the script behind it was deleted with the rest of
the Ron & Friends cruft. It will quietly 404 once a day forever. Deleting the
cron entry is a one-line change and belongs in whatever the next commit happens
to be.
