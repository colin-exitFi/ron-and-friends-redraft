# Commissioner rulings and confirmed league rules

Decisions made by the commissioner, plus league rules established by primary
source documents. These override both the Smart Draft room and the ESPN league.

Recorded 2026-08-26, ahead of the Aug 29 draft.

---

## THIS APP IS THE SOURCE OF TRUTH FOR KEEPERS. THERE ARE 19. — SETTLED

**Ruling, Aug 28 2026.** Read this before you count anything.

> This app and its database are the source of truth for keepers. Smart Draft has
> not been updated since I started building this app. **There are 19 locked
> keepers and all ten teams have declared.**

Joe's single keeper is a **deliberate choice**, not an outstanding declaration.
Nobody is required to fill both slots.

**The count is DERIVED, never declared.** The assembled 160-slot board is the
authority, and one command prints it:

```
npm run verify:board-keepers
```

`src/lib/smartdraft.ts` derives it once as `slots.filter((s) => s.isKeeper).length`
and every `keeperCount` in the app forwards that value. No application code reads
a count from a JSON field. The only human-written figure in the repo is
`EXPECTED_KEEPERS` in `scripts/keeper-expectation.mts`, which exists so the
verification scripts have something to fail against; it is not consulted at
runtime.

### Do NOT add the resolved file's count to the declarations file's count

This is the specific mistake to avoid. It has caught **a human and an agent,
an hour apart**, which is why it is written at the top of this document.

| Source | Holds | Why it is that number |
|---|---|---|
| `data/keepers-2026-resolved.json` | **14** | Joined from the room on 2026-08-26, when the room held 14. Frozen. |
| `data/smartdraft-room-snapshot.json` | **16** | The same 14 **plus Scott Elbe's two** — Javonte Williams R7 and Cam Skattebo R9 — which reached the room later. Frozen. |
| `data/keeper-declarations.json` | **3** | Only the declarations that never reached the room: Zach's Justin Jefferson R7 and Ladd McConkey R6, and Joe's Jayden Daniels R9. |
| **the assembled board** | **19** | 16 + 3. |

**14 + 3 = 17 is wrong.** It drops Elbe's two twice over: once because the
resolved file predates them, and once because they never went through the
declarations file. Elbe therefore *looks* like a manager with no keepers when you
tally those two files, and he is not — he holds two, at 7.05 and 9.05, and the
board has always carried them.

**The right sum is room + declarations = 16 + 3.** Better still, do not sum
anything; run the script. `npm run db:seed` also prints all three figures on
every run, so the arithmetic never has to be reconstructed:

```
provenance: 19 declarations total — 14 in data/keepers-2026-resolved.json,
2 added to the room since that file was written, 3 from data/keeper-declarations.json.
```

### Why the stale files are kept rather than deleted

They are **provenance** — the record of how this data reached the repo — and
`src/lib/expected-pick.ts` reasons explicitly about the sources disagreeing.
Deleting them would remove the evidence for the very confusion this ruling
settles. Both now carry a non-authoritative banner in the file itself.

**Do not back-fill the resolved file to 19 either.** `npm run db:seed` diffs its
length against the room to report what has arrived since it was written, and that
diff is exactly how Elbe's two were discovered. Back-filling it destroys the
staleness signal.

---

## Primary source: the Johnston/Blome trade agreement

`Fantasy Football - 2025 Johnston Blome Trade Agreement (4918-6057-0233.1).docx.pdf`
— an executed, DocuSigned contract dated Nov 12, 2025 between Greg Blome
("Jimmy's Johnson") and Scott Johnston ("DHB Sandmen").

Its recitals state the League's keeper rules directly, which makes this the best
evidence we have. **These are rules, not assumptions:**

1. **Two keepers per team**, automatically redrafted from the previous year's
   roster.
2. **Cost round = one round lower than the player's draft round the previous
   season.** (R12 in 2025 becomes R11 in 2026.)
3. **A free-agent acquisition costs the 9th round.**
4. **Three consecutive seasons total, of which two are keeper seasons.** The
   contract's phrasing ("kept ... for up to three (3) consecutive seasons") is
   loose. Per the commissioner, the count includes the season you acquire the
   player: you get him the year you draft him, then you may keep him for the
   **two** following seasons. This matches the keeper sheets, which write the
   clock as `"N of 3"` where year 1 is the acquisition season.
5. **A trade restarts the player's keeper eligibility with his new team, but the
   player retains his previous season's draft-round value.** Clock resets; cost
   basis carries.

Rule 4 means the handoff's "two-year clock" was right after all — two keeper
seasons. Rule 3 corrects the assumed 10th-round default for undrafted players,
and confirms Colston Loveland at **R9** (he was a free-agent acquisition), which
also means the `9` values in the 2026 keeper sheet are correct rather than a
formula bug. Rule 5 contradicts the app's current `tradeResetsClock = false`.

## Puka Nacua — Scott's, keepable at R11

The contract structures two trades. The **2025 Trade**, effective Nov 12, 2025,
sent Nacua and Derrick Henry plus Scott's 2026 R15/R16 and 2027 R16 to Greg, in
exchange for Kyle Monangai plus Greg's 2026 R1/R3 and 2027 R3.

The **Contingent 2026 Trade** fires *the day before the 2026 draft* — so Friday
Aug 28 — **unless** Nacua is projected by a majority of media outlets to miss six
or more weeks of 2026 through injury. It sends Nacua back to Scott along with
Scott's own 2026 R15 and 2027 R16, and returns Greg's own 2026 R1 and 2027 R3.

**Ruling: Nacua is Scott's.** The contingency is a downside protection that has
not triggered.

The contract also removes all doubt about eligibility: *"Nacua shall retain his
2026 League Draft 11th round draft Keeper eligibility whether or not the
Contingent 2026 Trade is consummated."* Scott keeps him at **R11**, and under
rule 5 the trade restarts his clock, so Scott holds him at year 1 of 3.

This resolves the earlier worry about Greg holding three keepers. Final counts
are two each: Greg has Garrett Wilson (R4) and Rome Odunze (R6); Scott has Kyren
Williams (R7) and Puka Nacua (R11).

### The live Smart Draft room is already correct

Netting both trades across the 2026 board gives: Greg keeps his own R1, Scott
holds Greg's R3, Scott keeps his own R15, Greg holds Scott's R16. That is
*exactly* what the live room shows. An earlier reading called this a
half-applied trade; it is not, it is the correct net position. The 2027 legs
cancel out entirely.

### Still live until Friday

The contingent trade is not consummated until the day before the draft. If
Nacua suffers a qualifying injury first, **Scott — not Greg — holds the option**
to either go through with it anyway or cancel. On cancellation Greg keeps Nacua
(still at R11) and Scott keeps the picks from the 2025 trade, which would move
Greg's R1 and 2027 R3 to Scott and return Scott's R15 and 2027 R16. Worth a
check on Friday before the board is printed.

## Draft order — Smart Draft wins

ESPN had Colin 8th and Stefan 10th; the Smart Draft room had them swapped. Every
other slot agreed.

**Ruling: the Smart Draft order is correct.** ESPN's order is stale.

| Slot | Manager | Slot | Manager |
|---|---|---|---|
| 1 | Zach | 6 | Kyle |
| 2 | Witte | 7 | Scott |
| 3 | Joe | 8 | Stefan |
| 4 | Josh | 9 | Greg |
| 5 | Elbe | 10 | Colin |

### How the order is actually set — a slot auction, not a standings assignment

Recorded Aug 26 2026. This existed nowhere in writing and was pure tribal
knowledge, which matters because **a reasonable person implements it wrong**: the
obvious reading of "reverse standings order" is that the worst team is assigned
the first pick, and that is not what this league does.

**The order is a slot AUCTION conducted in reverse-standings order.** Finishing
position determines *when you choose*, not *what you get*:

1. The team that finished last chooses first, and chooses **whichever slot it
   wants** — any of the ten.
2. The next-worst finisher chooses from what remains.
3. The champion chooses last, from whatever is left.

**The worked example, from the commissioner himself.** He finished **3rd** and
chose the **10th** slot. That looks like a punishment until you remember it is a
snake: slot 10 owns picks 10 and 11 back to back — the turn — so a late slot is a
desirable *choice*, not a leftover. Greg and Stefan chose after him and landed at
9 and 8, which means the champion picked last and ended up at slot 8.

That is exactly the order recorded above, and it is why Stefan is 8th and Colin
10th. The earlier ruling on this table established *that* the Smart Draft order
was right; this explains *why* it looks the way it does.

**The consequence for this app: the order is not derivable from standings, even
in principle.** Two leagues with identical final standings can have entirely
different draft orders, because the order is the record of ten free choices. So
**ten choices must be recorded every preseason** — there is no formula to fall
back on, and any code that tries to compute an order from standings is wrong by
construction. `draft_order` is stored data, not derived data, and that is
deliberate.

## Zach Rakowski / Ted Buckman — the same person

ESPN lists the "Perpetually Impaired" franchise under Ted Buckman; the keeper
sheets and Smart Draft say Zach Rakowski.

**Ruling: same person, an inside joke on the ESPN account.** Use Zach Rakowski.

---

## Config corrections required

In `src/lib/league-config.ts` and `src/lib/keeper-clock.ts`:

| Setting | Current | Correct | Source |
|---|---|---|---|
| `KEEPERS.maxConsecutiveSeasons` | 2 | **2 — leave as is** | See note below |
| `KEEPERS.maxPerTeam` | 2 | 2 (confirmed) | Contract recital |
| `KEEPERS.undraftedDefaultRound` | 10 | **9** | Contract recital |
| `KEEPERS.undraftedYear2Round` | 9 | **8** | Recital + the −1 rule |
| `CLOCK_RULES.tradeResetsClock` | false | **true** | Contract recital |
| `ROSTER.bench` | 5 | **7** | ESPN, corroborated by sheet |
| `ROSTER.irSlots` | 2 | **1** | ESPN |
| `LEAGUE.playoffTeams` | 4 | **6** | ESPN |
| Passing TD | TBD | **6 points** | ESPN (not the 4-point default) |
| Reception | 1.0 | 1.0 (confirmed) | ESPN |
| Position caps | "Not yet defined" | QB 4, RB 8, WR 9, TE 3, D/ST 3 | ESPN |
| `TRADES.deadlineWeek` | 12 | **11** | ESPN |

### Watch the off-by-one on the clock

Two different countings are in play and they must not be conflated:

- The **keeper sheets** write `"N of 3"`, counting the acquisition season as
  year 1. `3 of 3` therefore means a player's final keeper season.
- **`keeper-clock.ts`** counts `seasonsKept`, meaning keeper seasons actually
  used, excluding the draft year. So `maxConsecutiveSeasons` is **2**, and its
  existing value is already correct.

Mapping between them, **for a season already FINISHED** (i.e. reading the
`status2025` column when pricing 2026): sheet `1 of 3` = `seasonsKept 0` (just
acquired, two keeper seasons available); `2 of 3` = `seasonsKept 1`; `3 of 3` =
`seasonsKept 2`, expired.

Which column you read changes the answer by one, so say which you mean. **For
the season being ENTERED** — the `status2026` column on a 2026 row, which is
what the app actually reads — it is one lower: `2 of 3` = `seasonsKept 0`, and
`3 of 3` = `seasonsKept 1`, the final season. `keeper-clock.ts` exposes both
directions as separate functions (`seasonsKeptAfterSheetSeason` and
`seasonsKeptEnteringSheetSeason`) precisely so a call site has to declare which
column it is holding.

Sanity check against the real data: the players the sheets mark `3 of 3` for
2026 — Garrett Wilson, Jaxon Smith-Njigba, Brock Bowers, Chase Brown, Trey
McBride and **Justin Jefferson** — must all be released after this season. The
other twelve are on their first keeper season and are keepable again in 2027.

> That figure was **eight** when this document was first written, because only
> 14 declarations existed then. There are now **19** — see "Scott Elbe has
> declared", "Zach Rakowski has declared" and "Joe Murray has declared" below —
> of which **six** are in a final keeper season and thirteen are in their first.
> Any keeper count in this document is a snapshot. The **assembled board** is
> the authority, and `npm run verify:board-keepers` prints it; do not take a
> figure from prose here or from any single JSON file's self-reported count.

Note that cost basis carries across a trade *while the clock resets*, so a
player can in principle be passed around and held indefinitely at an ever
cheaper round. That is what the contract says; flagging it as a possible
loophole rather than a bug.

## How tenure is DISPLAYED — "Year 2 of 3", never "of 2" — SETTLED

**Colin rejected the old label twice**, which is why this is written down rather
than left to taste. His words the second time:

> "Ladd McConkey, year one of two. De'Von Achane, year one of two. Tucker Kraft,
> year one of two. Realistically it's **year two of three** for all of those
> guys, because they were acquired already in the past season. ... You can have a
> player up to three years: the year you acquire him and then two keeper years."

**The convention: count SEASONS OF TENURE out of three. The acquisition season is
year 1**, however the player was acquired — drafted, traded in-season, picked off
free agency, or acquired in an offseason/pre-draft trade.

| Label | Meaning |
|---|---|
| **Year 1 of 3** | his acquisition season — drafted this year, or an offseason/pre-draft trade where the acquisition season is itself a keeper season |
| **Year 2 of 3** | acquired last season, first keeper season now. **The common case** |
| **Year 3 of 3** | final season; back to the pool afterwards |

**This is not a new counting system — it is the league's own.** The `N of 3`
column in `KEEPER LIST for 2026` already uses exactly this convention, so that
column is now the *source* of the label rather than something the app derives a
second presentation alongside. The old "of 2" label counted keeper seasons and
hid the acquisition year; it is deleted, including the comment in
`keeper-clock.ts` that had deliberately chosen it.

**Guarded by `npm run verify:tenure`**, which asserts every keeper's displayed
year against the sheet's own column on both `/keepers` and `/teams`. Two
independent agents rendered this wrong before the guard existed.

The acquisition season is printed as supporting detail — "Year 2 of 3 · acquired
2025" — so the count never has to be inferred from the label alone.

### Ladd McConkey was acquired in November or December 2025 — in-season

Confirmed by Colin. This is recorded because it is the kind of fact that gets
lost: the trade log carries **no dates at all**, and he acknowledged the
limitation himself — *"you don't know because we don't have the trade dates."*

It does not change the display, because the sheet already encodes the answer
(`2 of 3` for 2026, so acquired 2025). It matters as **corroboration** that the
sheet's column is trustworthy, and as the only surviving evidence of timing for
that trade.

### One disagreement, reported rather than quietly resolved

Colin cited **Travis Etienne as "year one of three"**, which would mean a draft or
offseason/pre-draft acquisition. **The sheet disagrees:** it has him at
`1 of 3` for 2025 and `2 of 3` for 2026 under Josh, meaning Josh acquired him
during the 2025 season. Trade #10 moved him to Josh and is consistent with that.

**The app follows the sheet and shows Year 2 of 3.** Two reasons to prefer it
here: the sheet is internally consistent across two seasons' columns, and Etienne
was named in passing while Colin was describing the *categories* rather than
auditing that row — his sentence reads as "year one of three would only apply to
draft or pre-draft trades", which is a statement about the rule, not a claim
about Etienne. Worth a one-line confirmation, but nothing turns on it for 2026:
his R7 cost is unaffected either way.

## Scott Elbe has declared — CONFIRMED by the commissioner

**Confirmed directly, Aug 26 2026: Javonte Williams and Cam Skattebo are Scott
Elbe's keepers.** This closes the item. An earlier statement that Elbe was
outstanding was mistaken; the data was right and the room was right.

**All ten franchises have now declared** — Joe Murray closed the list on Aug 27,
see "Joe Murray has declared" below.

The evidence trail below is kept because it explains the 14-versus-16 count
discrepancy, which would otherwise look like a seeding error to anyone reading
this later.

`data/keepers-2026-resolved.json` lists **14** keepers. The live Smart Draft
room has **16**. The two it does not have are Scott Elbe's:

| Player | Cost round | Corroborated by |
|---|---|---|
| Javonte Williams | R7 | keeper sheet, under "Scott Elbe", R8 in 2025, `2 of 3` |
| Cam Skattebo | R9 | keeper sheet, under "Scott Elbe", R10 in 2025, `2 of 3`; and trade #9, in which Elbe received him |

The resolved file is simply **stale**, not wrong. The archived room snapshot
`data/snapshots/smartdraft-room-2026-08-26T20-54-42Z.json` has 14 keeper slots;
the current pull has those same 14 plus Elbe's two. The resolved file was
generated from the 14-slot state.

**Scott Elbe is *not* outstanding**, and the commissioner has since confirmed it
directly (see above). With Zach's and Joe's declarations recorded (below), **no
franchise is outstanding** — the board carries 19 keepers.

If a declaration in the room is ever ruled invalid, add the player to
`DISPUTED_DECLARATIONS` in `scripts/seed-league.mjs` and re-seed; do not delete
rows by hand.

### One caveat on Skattebo, for 2027 rather than 2026

Elbe acquired him by trade, and a trade restarts the keeper clock. The sheet
still shows him at `2 of 3`. Either reading gives the **same R9 cost for 2026**,
so Saturday's board is unaffected. They differ only on whether he is keepable in
2028 as well as 2027. Worth settling in the offseason, not now.

## Smart Draft is an input feed; this app is the authority

The commissioner's ruling on whether to cut the cord, verbatim:

> "Well the league hasn't adopted my app yet, so until that's the case we will
> continue to use SmartDraft until this fully satisfies all of our
> requirements... the biggest thing is carrying keepers / options over from last
> year into the next year, tracking trades, keepers, traded picks, etc. For now
> that is manually loaded into SmartDraft, where we're headed is making this
> source of truth for league operations."

So neither "cut the cord" nor "Smart Draft wins". **The room supplies the base
board; this app's reconciled data overlays it and wins on conflict.**

What that means in the code:

- `src/lib/keeper-overlay.ts` is the reconciled layer. It is applied inside
  `buildBoard()` in `src/lib/smartdraft.ts`, which is the single funnel every
  draft surface reads through, so the board, the roster panel, the export and
  the player pool all pick it up without knowing about it.
- It is **file-backed and never touches Postgres**, so the board is correct with
  the database unreachable and the venue's wifi down.
- The divergence is **surfaced, not hidden**: `/keepers` lists what is recorded
  here but not in the room, so the commissioner knows what to key into Smart
  Draft. `BoardView.keeperDivergence` carries the same data for the draft board.

Until Zach's two are keyed into Smart Draft, that product will disagree with
this one. This app is the one that is right.

## Zach Rakowski has declared — Justin Jefferson and Ladd McConkey

Declared to the commissioner on the evening of Aug 26, **not** entered in the
Smart Draft room, so the room still shows Zach with nothing. Recorded in
`data/keeper-declarations.json`; the cost rounds below are derived from the
eligibility sheet rather than supplied.

| Player | 2025 round | How acquired | 2026 cost | Clock for 2026 |
|---|---|---|---|---|
| Justin Jefferson | R8 | held by Zach; no trade | **R7** | `3 of 3` — **final keeper season** |
| Ladd McConkey | R7 | trade: Witte → Colin (#3) → Zach (#12) | **R6** | `2 of 3` — first keeper season |

Both derivations are simply "last season's round minus one", and both agree with
the sheet's own `roundToKeep2026` column. Neither player is a free-agent
acquisition, so the round-9 rule does not apply.

**Justin Jefferson does not hit the round-0 edge case.** He was a round-**8**
pick in 2025 — cheap for a player of his calibre — so his cost lands at R7, far
from round 0. The deferred round-1 question stays deferred.

**Jefferson is a sixth final-season keeper.** The list of players who must
return to the pool after 2026 is now six, not five: Garrett Wilson, Jaxon
Smith-Njigba, Brock Bowers, Chase Brown, Trey McBride, **and Justin Jefferson**.

### Ladd McConkey sits on an acquired pick, and that is normal here

Zach traded his own R6 to Witte, so his own round-6 slot is unavailable. He
holds **Kyle's** R6, and that is where McConkey goes.

This is settled practice rather than an interpretation: **four of the keepers the
Smart Draft room already carries occupy picks their franchise acquired** — Kyle's Jaxon
Smith-Njigba on Elbe's R4, Stefan's Rashee Rice on Witte's R4, Kyle's Chase
Brown on Witte's R6, and Witte's De'Von Achane on Zach's R8. The Colston
Loveland ruling is consistent with it: Stefan holds *no* round-8 pick at all,
own or acquired, which is why R8 was unusable for him.

### One open question for the offseason, not for Saturday

McConkey was acquired by trade, and a trade restarts the keeper clock while the
cost basis carries. The sheet still shows him at `2 of 3`. **Either reading gives
the same R6 cost for 2026**, so the board is unaffected; they differ only on
whether he is keepable in 2028 as well as 2027. Same situation as Cam Skattebo.

## Joe Murray has declared — Jayden Daniels, and he is keeping ONE

Declared to the commissioner on Aug 27 2026, ahead of the Aug 29 draft. Not
entered in the Smart Draft room, so the room still shows Joe with nothing.
Recorded in `data/keeper-declarations.json`; the cost round below is derived from
the eligibility sheet rather than supplied.

| Player | 2025 round | How acquired | 2026 cost | Clock for 2026 |
|---|---|---|---|---|
| Jayden Daniels | R10 | held by Joe; no trade flag | **R9** | `2 of 3` — first keeper season |

"Last season's round minus one" gives R9, which agrees with the sheet's own
`roundToKeep2026` column. He is not a free-agent acquisition, so the round-9
rule does not apply — R9 is simply where the arithmetic lands. He sits at
**9.03**, Joe's own round-9 pick.

**This closes the declaration list. All ten franchises have now answered, and
the board carries 19 keepers.**

### One keeper, not two — a deliberate pass, not a missing answer

Joe is keeping **one**. `KEEPERS.maxPerTeam` is 2, but nobody is required to
fill every slot, and the difference between "chose to keep one" and "has not
replied" is the difference between a finished list and a commissioner still
chasing a manager who already answered.

Nothing in the Smart Draft room or the workbooks can express "my list is done" —
they only ever show declared keepers, never a declaration of none. So the
declaration carries **`closesList: true`**, which is the one place that fact is
recorded, and the seed writes it to `teams.keeper_declarations_closed_at`.
`npm run db:verify` asserts that `/keepers` calls it a deliberate pass rather
than an open slot, offline as well as online.

**Zach's declaration deliberately carries no `closesList` flag, and that is
correct.** The flag only means anything for a SHORT list. Zach declared two,
which is the maximum, so his slate is full on its face and there is nothing left
for a flag to disambiguate. Adding it would imply a distinction that does not
exist. Joe's list is the only short one on the board.

## Manager identity — first names are NOT unique

**Four of the ten managers share a first name with another manager**, and the
collision is worse than it looks:

| Manager | Short name |
|---|---|
| Scott Elbe | `Elbe` |
| Scott **Johnston** | `Scott` |
| Kyle Witte | `Witte` |
| Kyle **Mertens** | `Kyle` |

`Scott` and `Kyle` are each *both* a legitimate short name for one manager *and*
the first name of a different one. A first-name match therefore does not fail
loudly — it silently resolves to the wrong franchise, and puts a wrong name in a
wrong cell.

**The rule: match a manager on the SHORT NAME or on a stable id**
(`smartDraftTeamId`, `espnTeamId`, or the database's `teams.id`). Never on a
first name, and never on a full name without an exact match. Short names are
unique and every data source uses them.

The code enforces this rather than trusting it: `src/lib/league-json.ts` and
`scripts/seed-league.mjs` both refuse a first-name lookup with a named error,
assert that short names are unique, and — for keeper clocks — decline any
spreadsheet row whose manager disagrees with the franchise the live room says
holds the player. `npm run db:verify` carries regression checks that each Scott
and each Kyle holds only his own keepers.

## First-round picks can NEVER be kept — SETTLED

**Ruling, Aug 26 2026.** This was the "round 0" open question and it is now
closed. Presented with three options — floor the cost at a 1st, make round-1
players ineligible, or impose a forfeit penalty — the commissioner chose
**ineligible**. He was then asked explicitly to confirm the full consequence,
that **every first-round pick is a one-year rental, permanently, not merely
expensive**, and he confirmed both that this is the rule and that the league
already knows it.

**So this codifies existing practice; it does not introduce a rule.** The data
agrees: ten managers held a round-1 player going into 2026 and **not one declared
him as a keeper**.

**The rule keys on the SLOT OCCUPIED last season, not on how the player came to
occupy it.** That catches two cases:

| Situation | Effect |
|---|---|
| Drafted in round 1 | Ineligible immediately — the one-year rental |
| Kept at a round-1 cost | Ineligible the following season |

A free-agent acquisition never trips it: he has no basis round at all and prices
at R9.

### This rule is NOT redundant with the three-season clock

It was tempting to assume the two rules already agreed — that anything pricing to
round 0 had run out of clock anyway. **That is false**, and the case that proves
it is a round-2 pick:

| Season | State | Cost |
|---|---|---|
| 2025 | drafted round 2 — acquisition season, 0 keeper seasons served | — |
| 2026 | first keeper season | round 1 (legal; round 1 exists) |
| 2027 | second keeper season — **the clock still permits this**, year 2 of 2 | round 0 — does not exist |

The clock has one season left, so the clock alone does not stop him. Before this
ruling the code quietly clamped round 0 back to round 1, letting him be kept a
second time at the same price.

**The consequence: a round-2 pick gets ONE keeper season, not two.** The clock
grants two; this rule takes the second away. A round-3 pick is unaffected — he
can be kept twice, ending in a round-1 slot with his clock spent, at which point
either rule stops him.

> **This consequence was put to the commissioner and he declined to rule on it.**
> It is therefore an **open question for the offseason** — item 2 of the offseason
> rules agenda below, where the full reasoning and the available choices are
> written out. The code implements it as described here in the meantime; nothing
> about 2026 changes either way.

### It changes nothing for 2026

Verified rather than assumed, by `npm run verify:round1`:

- All **19** keepers still stand; **zero** declarations refused.
- The cheapest cost round on the board is a **4th**; the cheapest *basis* round
  among the 19 is a **5th** — four rounds clear of the rule.
- No keeper occupies a round-1 slot. Six final-season keepers and thirteen
  keepable in 2027, both unchanged. The draft board carries 19 keepers over 160
  slots.

### The cohort, and what happens next

The ten players a prior analysis flagged are confirmed exactly against
`data/keeper-eligibility-2026.json`. One correction: their round-1 slot was
**2025**, so they price to round 0 for **2026** — this season, not 2027.

| Player | Manager | Player | Manager |
|---|---|---|---|
| CeeDee Lamb | Colin | Ashton Jeanty | Kyle |
| Saquon Barkley | Joe | Christian McCaffrey | Elbe |
| Derrick Henry | Greg | Malik Nabers | Elbe |
| Jonathan Taylor | Greg | Jahmyr Gibbs | Stefan |
| Amon-Ra St. Brown | Josh | Bijan Robinson | Stefan |

All ten are ineligible under the ruling, and none was declared, so **no
franchise loses a keeper it thought it had**.

For **2027** the barred set is whoever occupies a round-1 slot in 2026 — all
**ten first-round picks made on Saturday**. None is a keeper, so all ten will be
live picks. The draft importer records `basis_round = 1` for them automatically,
so they are barred without anyone having to remember.

**Where it lives in code:** `KEEPERS.round1Eligible = false` in
`src/lib/league-config.ts`, enforced by `occupiedRound1` and
`evaluateKeeperEligibility` in `src/lib/keeper-clock.ts`. `keeperCostRound`
returns **null** rather than a clamped round 1, so no surface can print a
nonsense round; `/keepers` shows a refused declaration with the reason rather
than dropping it.

## The Stefan ↔ Witte round-4 swap is real — SETTLED

**Ruling, Aug 26 2026.** Verbatim:

> "Yes they swapped 4s — Kyle missed it on his trade log. SmartDraft is right."

The live room shows Stefan's own R4 held by Witte and Witte's own R4 held by
Stefan, while **neither leg appears in `Sheet3` or in the 12-trade log**. Two
commissioner-authored sources said no trade; the room said there was one. **The
room is correct. The workbook is incomplete.**

**No data change.** The app already follows the room, so Witte's second round-4
pick stays at **4.03** — not 4.09, six spots later, which is where the
workbook's version would have put it. Stefan's Rashee Rice occupies the other R4
slot either way. Net inventories were always identical — Witte holds two R4
picks and Stefan one — which is exactly why every count check passed and why this
went unnoticed for four weeks. It was only ever a question of **draft position
within round 4**, which is also why it was safe to leave open this long.

### The part that outlives Saturday: the trade log is incomplete

This is the reason to record the ruling rather than just fix the pick. **`Trade
Log` is Kyle Mertens' document, and it is now confirmed to omit at least one real
trade.** It is a narrative of trades, not a complete ledger of them.

That is harmless for 2026, because the room already reflects the true net
position and the app reads the room. **It is not harmless for the 2027
rollover**, where the log is the *only* source for 2027 pick obligations —
`data/RECONCILIATION.md`'s trust table lists "2027 pick obligations" as
**spreadsheet only**, because nothing in the Smart Draft room tracks future
years. So next August the log will be consulted for picks it may not fully
record, with no room snapshot to cross-check it against.

**The working rule going forward:** the log is evidence of *why* a trade
happened and what players were involved; the room is evidence of *what actually
moved*. Where they disagree on whether a trade happened at all, the room wins.
When 2027 picks are rolled over, they should be confirmed with the managers
rather than taken from the log alone.

Recorded as conflict **C3** in `data/RECONCILIATION.md`, whose recommendation to
trust the room is now this ruling. `npm run verify:picks` reports the difference
as a **ruled** divergence — still listed, so the workbook gap stays visible, but
no longer counted as something needing attention.

## Still open

- **The 2027 legs of trade #4 are logged but not applied to the 2027 ledger.**
  Trade #4 (Johnston ↔ Blome) moves **2027 R16 Scott → Greg** and **2027 R3 Greg
  → Scott**. Both are recorded in the trade log. Neither has moved in the
  database's 2027 pick ownership, which still shows all 160 picks with their
  original owners.

  **Why, and it is deliberate rather than a bug:** the seed imports the trade log
  as *history* at status `proposed`, and only accepting a trade applies it. The
  log is imported this way because the **room snapshot already reflects the net
  2026 result** — applying the log on top would move the same 2026 picks a second
  time and corrupt the board. The 2027 legs are collateral: they were never
  applied because their parent trades were never applied.

  **Harmless for Saturday** — nothing on the 2026 board depends on it, and
  `npm run verify:picks` states it explicitly every run so it cannot be
  discovered by surprise. **Wrong at the rollover**, where those two picks would
  roll to the wrong franchises.

  **The decision needed is which source is authoritative for 2027: the ledger or
  the log.** Note this interacts with the round-4 ruling above — the log is now
  known to be incomplete, which argues against making it authoritative without
  confirming it against the managers first. Also note the Nacua contingency's own
  2027 legs (R3 and R16) **cancel out entirely** if the contingent trade
  consummates, so trade #4's 2027 legs may be moot depending on Friday. Settle
  this in the offseason, before 2027 declarations open.
- **Waivers.** ESPN has traditional waivers and a $100 FAAB budget both switched
  on, which is contradictory.
- **Scoring detail** beyond what ESPN gave us is complete; no gaps remain.

**Officers are no longer open** — see the section directly below.

## Officers — Kyle Mertens is commissioner, and the only officer — SETTLED

**Confirmed directly, Aug 26 2026.** There is **no** co-commissioner, no vice
commissioner and no treasurer. One office, one holder.

| Office | Holder | Short name | Franchise |
|---|---|---|---|
| Commissioner | **Kyle Mertens** | `Kyle` | Tushy Booth Ballers (TBB) |
| Vice Commissioner | *vacant — the league has none* | — | — |
| League CTO | *vacant — the league has none* | — | — |

### Which Kyle — this was asked explicitly, not assumed

**It is Kyle *Mertens*, short name `Kyle`. NOT Kyle *Witte*, short name
`Witte`.** This is the exact collision documented under "Manager identity" above,
and it is the one that has already caused trouble: `Kyle` is simultaneously a
legitimate short name for Mertens *and* the first name of Witte, so a first-name
match resolves silently to the wrong franchise.

**The record is therefore keyed to the franchise id**, not to the string "Kyle".
`officers.team_id` is a foreign key to `teams.id`, and the seed resolves it
through the same short-name lookup that refuses a first name and asserts short
names are unique. A rename cannot detach the office from the man.

### This resolves the `sba361` puzzle

The Smart Draft room records its commissioner only as the username `sba361`,
which mapped to no franchise and was recorded above as unresolved. **`sba361` is
Kyle Mertens.** Recorded here so nobody has to rediscover it from the room
export.

### The commissioner and the operator are different people

Worth stating plainly, because it changes how everything in this app should be
read. **Colin Tracy is directing this project and will be at the keyboard on
Saturday. He is not the league commissioner.** Kyle Mertens is.

So where this app records a dispute — the Puka Nacua timeline is the live example
— it is recording it **for Kyle to rule on or to put to the group**, not
implementing the operator's own preference. Colin holds a view on Nacua and is a
party to that dispute; the app deliberately does not implement it. Nothing in the
governance or ballot copy should imply the operator holds authority he does not.

### There is no auth, and that is deliberate — not a gap

The app has **no notion of who the commissioner is for permission purposes**, and
it does not need one. There are no accounts, no logins and no roles enforced
anywhere. The model is a **single trusted operator entering everything**, which
is what actually happens: one person at one keyboard on draft night, and the
same person maintaining the data afterwards.

`officers` is therefore a **record of fact for the league to read**, not an
access-control table. Do not let a future change quietly turn it into one without
deciding to build authentication first. The offline guarantee depends on there
being no auth round-trip in the draft path.

---

## Trade dates ARE captured going forward — but not for the existing twelve

**Confirmed Aug 26 2026.** Every trade logged through this app records its date,
and that date flows into `transferRightsOnTrade` so keeper clocks compute from it
rather than from an assumption.

**This matters because of ballot item 1.** The whole Nacua argument turns on
*when* a trade happened — in-season or pre-draft — and that is exactly the fact
nobody wrote down. An in-season acquisition is played outside a keeper slot and
two keeper seasons follow; a pre-draft acquisition consumes a keeper slot in the
acquisition season and two more follow. Same three-season tenure, different
number of keeper slots. Without a date the app cannot tell the two apart.

**The twelve existing trades predate this and have no dates in any source.** The
trade log records only a trade number, the two sides, and a free-text note — **no
dates at all** — and that log is Kyle's document, now confirmed to omit at least
one real trade (see the round-4 ruling).

### But the gap has largely dissolved — NO PRE-DRAFT PLAYER TRADES THIS YEAR

**Commissioner confirmation, Aug 26 2026.** Asked what to do about the twelve
undated trades, Colin answered:

> "No pre-draft player trades this year. Just confirmed."

**This is a better answer than the question deserved.** The date was only ever
needed to establish one thing: whether an acquisition was in-season or pre-draft,
because the two produce different keeper outcomes. Ruling out pre-draft player
trades for 2026 settles that for all twelve at once.

So **every one of the twelve is an in-season trade**, and for each of them the
acquisition season is simply the season the trade occurred — which is exactly
what the keeper sheet's `N of 3` column already records. That is why the app and
the sheet agree on **every undisputed keeper** on the board — all of them bar
Puka Nacua, whose 2026 cost is settled either way. It is recorded as a
**confirmed fact**, not an unresolved gap, and the ledger check that used to fail
as an outstanding backfill now states the fact and passes. A permanently failing
check teaches people to ignore the output.

**Still do not invent dates for those twelve.** A guessed date is
indistinguishable from a recorded one. The confirmation tells us the *category*
they all fall into, which is sufficient, and it is recorded here because it will
be unknowable in a year.

### The pre-draft rule itself stays unresolved in the general case

No player hit it in 2026, but the rule is not settled: a pre-draft acquisition
consumes a keeper slot in its acquisition season while two further keeper seasons
follow, and nothing has ruled on whether that is right. The trade-entry flow now
stores dates precisely so those clocks can be **recomputed** once the league
rules, rather than needing to be reconstructed from memory.

## THE LEAGUE BALLOT — five items for a vote

**These are collected here as one ballot rather than scattered open questions,
because that is what they are.** Colin asked for a ballot of items and this is
the list as of the evening of Aug 26 2026.

**None of them changes Saturday's board.** Every item is about a *future* season,
and each was checked against the 2026 board before being placed here. The app
implements the rules as they currently stand until the league votes.

**Who decides:** Kyle Mertens is the commissioner (see above) and may rule on
these himself or put them to the group. Colin, who operates this app, is a party
to at least item 1 and has no authority over any of them. The app records the
questions; it does not resolve them.

### Deadlines — several of these are not open-ended

| # | Item | Must be settled by | Why that date |
|---|---|---|---|
| 1 | Nacua timeline | before 2027 declarations open | decides whether Scott may keep him in 2028 |
| 2 | Trade-and-reset loophole | **before the 2027 clocks are computed** | changing it later means recomputing clocks managers already planned against |
| 3 | Are contingent trades permitted | before the next trade is agreed | there is currently no rule to point at |
| 4 | How future-season picks may be traded | before the 2027 rollover | the 2027 ledger is built from these |
| 5 | Round-2 keeper consequence | before 2027 declarations open | a manager needs to know if his round-2 keeper is a one-year rental |

Items 2 and 4 are the binding ones: both feed the 2027 rollover, and that
computation cannot be run twice without a manager legitimately objecting.

---

### Ballot item 1 — When does Puka Nacua's keeper clock start?

**The question, neutrally.** Scott held Nacua in 2023, 2024 and 2025, which
exhausted his clock. The Johnston/Blome agreement moved him to Greg in November
2025, mid-season, and the contingent leg returns him to Scott the day before the
2026 draft. A trade restarts keeper eligibility. **Which trade starts the clock?**

| Counting from | Nacua's last season with Scott |
|---|---|
| the November 2025 in-season trade | **2027** |
| the pre-draft leg returning him to Scott | **2028** |

**Both arguments are real.** For 2027: tenure ran 2025–2027 with 2025 as year 1,
which is exactly how the keeper sheet records it, and the arrangement looks
engineered to extend a clock that had already expired. For 2028: Nacua genuinely
*was* off Scott's roster for the rest of 2025, so 2026 is Scott's acquisition
season — and a pre-draft acquisition consumes a keeper slot in the acquisition
season with two further keeper seasons following, which is the rule as stated for
every other pre-draft trade.

**What turns on it.** Whether Scott keeps Nacua in 2028. Nothing else — he is a
legal R11 keeper in 2026 and 2027 under both readings, so **Saturday is
unaffected**.

**Status: unresolved, and the app says so.** Colin's own view is 2027 and he has
described the trade as illegitimate; he has also said Kyle must decide or throw
it to the group, and he concedes the opposing argument has merit. So the app
shows Nacua's final season as **disputed on every surface** rather than printing
either number. Recorded in `src/lib/keeper-tenure-dispute.ts`, which refuses to
carry a dispute that would affect the season being drafted.

#### Evidence for the vote — NOT a resolution

**Colin confirmed on Aug 26 2026 that there were no pre-draft player trades this
year.** Followed through, that points toward the **2027** reading: if no player
was acquired in a pre-draft trade in 2026, then Scott's acquisition of Nacua is
the **November 2025 in-season trade** rather than a fresh pre-draft acquisition,
which makes 2025 year 1 and 2027 the final season. That matches the keeper sheet
and matches Colin's own stated vote.

**This is deliberately recorded as evidence rather than used to settle the item,
and the app has not been changed.** Three reasons, and they all still hold:

1. He explicitly sent this to a **league ballot** after the confirmation, not
   before it.
2. He is a **party to the dispute**, not the adjudicator. **Kyle Mertens** rules.
3. **The contrary argument he himself acknowledged still stands:** Nacua
   genuinely was off Scott's roster, so a reset is arguable on the facts
   regardless of what other trades did or did not happen this year.

Recording the evidence that informs a vote is useful. Pre-empting the vote is
not. Whoever runs this ballot should put the confirmation in front of the league
as an argument for the 2027 reading and let the league weigh it.

### Ballot item 2 — Should trading a player reset his keeper clock?

**The question, neutrally: does a trade restart the clock, and if so, should it?**
Colin's position is that it should not. → **GOES TO A LEAGUE VOTE.** Rule 5 restarts a
player's keeper clock when he is traded. Trading a keeper away shortly before
a draft and re-acquiring him therefore extends his tenure past the intended
three seasons. Under the rule as written, Scott's reset clock lets him hold
Nacua through 2026, 2027 and 2028. The commissioner's position is that this
defeats the purpose of the three-season limit, which exists to return
players to the pool.

**Ruling on procedure, Aug 26 2026: the commissioner chose NOT to decide this
unilaterally.** It goes to the league as an **offseason rules vote**. So
unlike the round-1 question, which he settled himself, this one stays open by
design — and the app must keep implementing the rule as written until the
league votes. **No code change.**

**TIMING MATTERS: the vote should land BEFORE the 2027 keeper clocks are
computed.** Changing the rule afterwards means recomputing clocks that
managers have already planned their rosters around, and a manager who kept a
player on the strength of a reset clock has a legitimate grievance if the
reset is withdrawn after the fact. Practically: hold the vote in the offseason,
well ahead of 2027 declarations opening.

Worth noting for the debate: this is not unprecedented. The commissioner
used the same mechanism himself to hold Trey McBride a third season, which
is why McBride now shows `3 of 3`. Any fix applies retroactively to
everyone or to no one.

Possible shapes for a fix, none decided: carry the clock across a trade
instead of resetting it (which is what `keeper-clock.ts` originally
assumed); reset only for trades made in-season rather than near the draft;
or cap total tenure with one franchise regardless of transactions.

### Ballot item 5 — Should a round-2 pick get one keeper season, or two?

**A round-2 pick now gets ONE keeper season instead of two. → OPEN, NOT
RULED.** Put to the commissioner on Aug 26 2026; **he declined to rule on it
that night.** So the code stays exactly as it is and this is recorded for the
offseason. **No code change.**

**Read this carefully, because the reasoning is not obvious and nobody chose
this outcome.** It is not a rule anyone wrote. It is what happens when two
rules that were each decided on their own merits meet:

- The **three-season clock** grants a player his acquisition season plus **two**
     keeper seasons.
- The **round-1 ineligibility ruling** (settled the same night, see above) says
     a player who occupied a round-1 slot last season cannot be kept, because
     pricing him would require a round 0 and round 0 does not exist.

Neither rule mentions round 2. Together they take a round-2 pick's second
keeper season away:

| Season | State | Cost round | Allowed? |
|---|---|---|---|
| 2025 | drafted in round 2 — acquisition season, 0 keeper seasons served | — | — |
| 2026 | first keeper season | round 1 | **yes** — round 1 exists, and he is priced at it |
| 2027 | second keeper season; **the clock still permits this**, year 2 of 2 | round 0 | **no** — he occupied a round-1 slot in 2026, so the round-1 ruling bars him |

The clock says yes and the round-1 rule says no, so he is released after one
keeper season. **A round-3 pick is unaffected** — he can be kept twice, in
round 2 and then round 1, and by then his clock is spent anyway, so the two
rules agree. Round 2 is the only round where they collide, and a round-1 pick
was already a one-year rental before any of this.

**There is no precedent to appeal to, which is very likely why it never came
up.** The cheapest **basis** round among the 19 keepers on the board is a **5th** —
three rounds clear of the collision. No manager in the league's recorded
history has ever held a round-2 keeper into a second keeper season, so nobody
has an expectation to be disappointed and there is no past case that settles it
either way.

**The choice, when it is taken up:** accept it (a round-2 pick is a one-year
keeper, which is defensible — he is nearly as expensive as a round-1 pick), or
carve out an exception so a round-2 player can be kept a second time at some
defined price. Anything in the second family requires deciding *what* that
price is, since there is no round below 1 — a repeat of round 1, or a forfeited
pick, or something else. **Whatever is decided should be decided before 2027
declarations open**, for the same reason as the vote in item 1: managers plan
rosters against the rule they are told.

### Ballot item 3 — Are contingent trades permitted at all?

**The question, neutrally.** The Johnston/Blome agreement is a **contingent**
trade: it fires the day before the 2026 draft unless Puka Nacua is projected to
miss six or more weeks through injury, in which case Scott chooses whether to
proceed. It is an executed, DocuSigned contract between two managers carrying the
handwritten note *"Contingent on something may reverse will denote later"*.

**No rule currently permits or forbids this**, which is the problem. Colin's
description is that it was "a one-off that should have gone to a vote before it
ever happened". The same objection covers the related practice of an in-season
trade with a **handshake to return the player** the following season — the
Johnston/Blome deal is an explicit instance of that too, and no rule forbids it
either.

**What turns on it.** Whether this class of deal is legal going forward. The
league needs a rule *before* the next one is proposed, because arguing about it
afterwards is how the current dispute started. A plausible shape, not decided:
require league ratification for anything touching keeper eligibility, which would
have caught this deal before it executed.

**This does not unwind the existing trade.** Nacua is Scott's at R11 for 2026 by
ruling, and the board is printed on that basis.

### Ballot item 4 — How may future-season picks be traded?

**The question, neutrally.** Trade #4 moves **2027** picks — R3 and R16 — and the
league has never agreed rules for trading into future seasons. Two sub-questions,
both unanswered:

- **How many seasons out may a pick be traded?** Trading into 2027 was never
  agreed. The league has also never traded picks only *one* year out, though
  nothing appears to prohibit that either.
- **Is the ledger or the trade log authoritative next year?** The 2027 legs of
  trade #4 are recorded in the log but not applied to the 2027 ledger — see
  "Still open" above for why. One of the two has to win, and the log is now known
  to be incomplete.

**What turns on it.** The 2027 rollover is computed from whichever source wins, so
this must be settled **before** that computation runs. Note also that the Nacua
contingency's own 2027 legs cancel out entirely if the contingent trade
consummates, so trade #4's 2027 legs may be moot depending on Friday.

---

## Running the ballot in the app

`/governance` carries the motion machinery this needs — propose, second, discuss,
vote, ratify, with a threshold per motion and a recorded tally. The five items
above are seeded as **motions at status `proposed`**, each carrying its question,
what turns on it, and its deadline as the motion's effective date, so the page
shows the real ballot instead of a placeholder.

Two honest caveats on the fit:

- **Items 2 to 5 are rule changes and fit the machinery exactly.** They are
  seeded as `Major Structural Change` at a two-thirds threshold, which is what
  the presets already specify for anything touching the keeper system.
- **Item 1 is not a rule change — it is an adjudication of one player's case.**
  The machinery models rule changes and officer elections, not case-by-case
  rulings, so this one is a looser fit. It is seeded with the
  `commissioner_ruling` threshold, which is the closest honest match, because
  Kyle may simply decide it. If the league later wants case adjudication as a
  first-class concept, that is a rebuild after the draft rather than something to
  force now.

**Votes are not seeded.** Nobody has voted, and a seeded vote would be a
fabricated one. Seconds are not seeded either, for the same reason.
