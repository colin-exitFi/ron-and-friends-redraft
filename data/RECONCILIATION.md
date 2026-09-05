# Reconciliation: commissioner spreadsheets vs live Smart Draft room

> ## READ FIRST — the keeper question is settled, and this document predates it
>
> **Commissioner ruling, Aug 28 2026: this app and its database are the source of
> truth for keepers. Smart Draft has not been updated since he began building
> this app. There are 19 locked keepers and all ten teams have declared.** Joe's
> single keeper is a deliberate choice, not an outstanding declaration.
>
> Everything below was written when Smart Draft was still a live feed, so it
> treats "the live room" as the more recent statement of fact. **For keepers that
> is no longer true** — the room is a frozen historical import holding 16 of the
> 19. The other three are in `data/keeper-declarations.json`. The trust table near
> the end of this document is still right about *ownership and cost rounds*; it is
> out of date about *recency*.
>
> **The count is derived, never declared. Run `npm run verify:board-keepers`.**
>
> **The specific trap:** do not add `keepers-2026-resolved.json`'s **14** to
> `keeper-declarations.json`'s **3** and conclude **17**. That drops Scott Elbe's
> Javonte Williams (R7) and Cam Skattebo (R9) twice — they are in the room but not
> in the resolved file, and they never went through the declarations file, so
> Elbe wrongly appears to hold nothing. The board is room 16 + declarations 3 =
> **19**. Full reasoning in `data/DECISIONS.md`, first section.

Sources compared:

| Source | Detail |
| --- | --- |
| `2026 DRAFT.xlsx` | 22 sheets. League history 2016–2026. Author Kyle Mertens, last saved 2026-07-31. |
| `Draft Picks 2026.xlsx` | 3 sheets. 2026 pick ownership + trade log. Author Kyle Mertens, last saved 2026-07-31. |
| `data/smartdraft-room-snapshot.json` | Live draft room, 10 teams, 160 slots, **16** keepers, 29 traded picks. Pulled 2026-08-26. The comparison below was made against the 14 the room held at the time; Scott Elbe's two arrived afterwards. The room is not the whole picture either — the **assembled board carries 19**, adding Zach's two and Joe's one from `data/keeper-declarations.json`. Run `npm run verify:board-keepers` for the live tally. |
| `data/smartdraft-players.json` | 1,233 players, ADP from nine ranking sources. |

The spreadsheets are ~4 weeks older than the live room pull. Where they disagree and no
rules argument applies, the live room is the more recent statement of fact.

---

## What each workbook contains

### `2026 DRAFT.xlsx`

Not a rankings or cheat-sheet workbook. It is the league's historical record.

- **`KEEPER LIST for 2026`** — the most valuable sheet in either file. All 167 players held by
  the 10 managers after the 2025 season, each with: prior-season cost round, keeper-clock
  status for 2025 / 2026 / 2027, the computed 2026 cost round, and a `TRADE` flag.
- **`KEEPER LIST for` 2025, 2024, 2022, 2021, 2020, 2019, 2018** — same structure for prior years.
- **Draft result sheets** for 2025, 2024, 2023, 2021, 2020, and by-round sheets for 2019, 2018, 2017.
  Keepers occupy their cost-round slot in these sheets, so a keeper and a real pick look identical.
  The 2024 sheet has a `Comments` column full of draft-room banter.
- **`Roster`** — the starting lineup and bench template.
- **`2016 / 2017 / 2018 Keeper`** — legacy keeper tabs with a different, older column layout.

No ranking, ADP, projection, tier, bye-week, or scoring column exists anywhere in the workbook.
There is one broken external link to `\\ulmer.com\...\SJohnston\Desktop\2024 Fantasy Football.xlsx`
with cached sheet names `DHB Sandmen`, `BChen Overall`, `BChen QB`, `BChen TE`. Only three player
names survive in the cache. That file is the league's old rankings source and is not present here.

### `Draft Picks 2026.xlsx`

- **`Sheet1`** — post-trade inventory: the 16 rounds each manager owns a pick in, plus a
  per-round pick-count grid confirming 10 picks per round.
- **`Trade Log`** — 12 trades, each side listing players and pick rounds received. Includes
  2027 picks. Player names are hand-typed with spelling variants (`Puca Nakua`, `Treyveon Henderson`).
- **`Sheet3`** — the full 160-slot ownership board with up to two trade hops per slot.

---

## Open questions

### 1. Keeper clock years — ANSWERED

The clock is a **three-season term** written `"N of 3"`. Year 1 is the season the player was
acquired; years 2 and 3 are the two seasons he may be kept. That is consistent with the
"two-year keeper clock" in `HANDOFF.md` — same rule, different counting convention.

For 2026, **5 keepers are in year 3 (final season), 8 are in year 2, and 1 is disputed**:

| Owner | Round | Player | Year | After 2026 |
| --- | --- | --- | --- | --- |
| Greg | 4 | Garrett Wilson | 3 of 3 | must be released |
| Kyle | 4 | Jaxon Smith-Njigba | 3 of 3 | must be released |
| Josh | 6 | Brock Bowers | 3 of 3 | must be released |
| Kyle | 6 | Chase Brown | 3 of 3 | must be released |
| Colin | 8 | Trey McBride | 3 of 3 | must be released |
| Stefan | 4 | Rashee Rice | 2 of 3 | keepable in 2027 at R3 |
| Greg | 6 | Rome Odunze | 2 of 3 | keepable in 2027 at R5 |
| Josh | 7 | Travis Etienne | 2 of 3 | keepable in 2027 at R6 |
| Scott | 7 | Kyren Williams | 2 of 3 | keepable in 2027 at R6 |
| Witte | 8 | De'Von Achane | 2 of 3 | keepable in 2027 at R7 |
| Stefan | 9 | Colston Loveland | 2 of 3 | keepable in 2027 at R8 |
| Colin | 10 | Bucky Irving | 2 of 3 | keepable in 2027 at R9 |
| Witte | 11 | Tucker Kraft | 2 of 3 | keepable in 2027 at R10 |
| Scott | 11 | Puka Nacua | **disputed** | see conflict C1 |

Three players the sheet marks **ineligible** for 2026 (clock hit 3 of 3 in 2025), and none of
them appear as keepers in the live room, so both sources agree:
Ja'Marr Chase (Josh), Sam LaPorta (Elbe), Nico Collins (Stefan).

### 2. How cost rounds are derived — ANSWERED

**Cost round next season = cost round this season − 1.** Verified against all 167 rows of
`KEEPER LIST for 2026` with zero violations. Confirmed across multiple seasons, e.g. Puka Nacua
drafted R14 in 2023, kept R13 in 2024, kept R12 in 2025, priced R11 in 2026.

Two supporting conventions:

- **Free agents / waiver adds** get a placeholder round instead of a real draft round. The 2024
  and 2025 sheets write the literal string `FA` (69 and 72 rows respectively) and price it at
  **R9**. The 2026 sheet instead writes the number `9` in the round column, which the `−1` formula
  turns into **R8**. 80 rows in the 2026 sheet carry round `9`; cross-checking against the 2025
  draft results, only **5** were genuine round-9 picks, while **75** are the free-agent placeholder
  (58 players never drafted in 2025, plus 17 drafted in a different round, dropped, and re-added).
  So the convention change silently made 75 free agents one round cheaper. Likely unintentional.
  Colston Loveland is one of the 17 — see conflict C2.
- **The clock restarts whenever a player is re-acquired**, not just when traded. 80 players whose
  manager changed all show `1 of 3`, with zero counterexamples. Players re-drafted by their own
  previous manager also reset — e.g. Jonathan Taylor was `3 of 3` and exhausted in the 2025 sheet,
  Greg re-drafted him in R1 of the 2025 draft, and he is back to `1 of 3` in the 2026 sheet.
  Note the consequence: **the cost round keeps decrementing across a trade even though the clock
  resets**, so a player can be passed around and held indefinitely at an ever-cheaper round until
  the formula reaches zero.
- **First-round keepers produce cost round 0**, which is not a real round. 10 players are in this
  state (CeeDee Lamb, Saquon Barkley, Derrick Henry, Jonathan Taylor, Amon-Ra St. Brown, Ashton
  Jeanty, Christian McCaffrey, Malik Nabers, Jahmyr Gibbs, Bijan Robinson). None were kept, so it
  did not bite this year, but the rule has no defined floor.

### 3. Traded picks — AGREE ON 29, ONE TRADE DIFFERS

Both sources independently report exactly **29 traded picks**. `Sheet1` and `Sheet3` are
internally consistent with each other for all 10 managers. 27 of the 29 match exactly on
(round, from, to). Differences are conflicts C1 and C3 below.

Important: **`Sheet3`'s overall pick numbers are unusable.** They are keyed to the 2025 draft
order (Colin 1, Stefan 2, Witte 3, Joe 4, Elbe 5, Kyle 6, Josh 7, Scott 8, Greg 9, Zach 10),
not the 2026 order in the live room (Zach 1, Witte 2, Joe 3, Josh 4, Elbe 5, Kyle 6, Scott 7,
Stefan 8, Greg 9, Colin 10). Reconcile by (owner, round) only.

### 4. Team and manager names — ANSWERED

Full names exist; franchise names do not. The `KEEPER LIST` sheets carry full names, which
resolves the two ambiguous short names:

| Short name (live room) | Full name |
| --- | --- |
| Colin | Colin Tracy |
| Joe | Joe Murray |
| Scott | Scott **Johnston** |
| Elbe | Scott **Elbe** |
| Kyle | Kyle **Mertens** |
| Witte | Kyle **Witte** |
| Greg | Greg Blome |
| Josh | Josh Grainger |
| Zach | Zach Rakowski |
| Stefan | Stefan Albers |

Two Kyles and two Scotts — the second of each goes by last name. The only franchise nickname in
either workbook is `DHB Sandmen (SJ)`, Scott Johnston's team name in the 2017 sheet; it is not
used after that. Three former members appear in pre-2019 sheets and are gone: Andy Seibert,
Josh Schaefer, Chad McCann.

### 5. Scoring and roster settings — PARTIAL

No ESPN settings and no scoring values anywhere in either workbook. Scoring is only implied by
draft-room banter in the 2024 comments column ("it's a PPR league"), consistent with the live
room's `scoringFormat: "PPR"`.

The `Roster` sheet gives the lineup template:

```
QB 1 | RB 2 | WR 2 | TE 1 | FLEX 2 | D/ST 1   = 9 starters
BENCH 7
Total 16
```

9 + 7 = 16 roster spots = the 16-round draft, which is self-consistent. See conflict C4.

### 6. Rankings — NOT PRESENT

`2026 DRAFT.xlsx` carries no rankings. `data/smartdraft-players.json` remains the only source of
ADP and rankings, and there is nothing in the spreadsheets to compare it against.

---

## Conflicts

### C1 — Puka Nacua: ownership and eligibility. HIGHEST PRIORITY.

The spreadsheets put Puka on **Greg**; the live room has him as **Scott's** keeper at R11.

`Trade Log` trade #4 sends Puka Nacua and Derrick Henry plus 2026 R15, 2026 R16 and 2027 R16
from Scott to Greg, in exchange for Kyle Monangai plus 2026 R1, 2026 R3 and 2027 R3. That trade
carries the handwritten note **"Contingent on something may reverse will denote later"**.

The live room has applied that trade **only partially**:

| Leg | Spreadsheet | Live room |
| --- | --- | --- |
| Greg R3 → Scott | yes | yes |
| Scott R16 → Greg | yes | yes |
| Greg R1 → Scott | yes | **no — Greg still has R1** |
| Scott R15 → Greg | yes | **no — Scott still has R15** |
| Puka Nacua | Greg | **Scott** |
| Derrick Henry | Greg | not a keeper either way |

This is not just a stale pull, because two legs of the same trade did land. Someone applied
half of it.

The eligibility consequence is severe. Under **Greg**, the trade resets the clock, Puka is
`1 of 3` in 2025 and year 2 of 3 in 2026, and an R11 keeper is legal. Under **Scott**, the clock
is **exhausted**: `KEEPER LIST for 2025` shows Scott at `3 of 3` for 2025 and `N/A` for 2026
(R14 in 2023, kept R13 in 2024, kept R12 in 2025). **If the trade reversed, Scott cannot legally
keep Puka Nacua at all.** The live room currently has him doing exactly that.

Trust: neither. The commissioner has to state whether trade #4 stands.

### C2 — Colston Loveland cost round: R8 (sheet) vs R9 (live room).

The only round disagreement among the 14 keepers. Two facts both favor R9:

- Stefan owns **no round-8 pick** in 2026 (traded to Witte), so R8 is unusable.
- Loveland was drafted R11 in 2025 by Kyle, so the `9` in the sheet's Round column is the
  free-agent placeholder, and 2024/2025 priced free agents at R9, not R8 (see the FA convention
  change above).

Trust: the live room's R9. Worth a one-line confirmation from the commissioner, since the same
FA convention change silently repriced 75 players and will affect every future keeper decision.

### C3 — Stefan ↔ Witte round-4 pick swap exists only in the live room. **RESOLVED — RULED.**

The live room shows Stefan's original R4 slot owned by Witte and Witte's original R4 slot owned
by Stefan. The spreadsheet has neither leg. Because it is a straight one-for-one swap it does not
change either manager's pick inventory, and both `Sheet1` and the live room agree that Stefan and
Witte each own one R4 pick. It only changes draft position within round 4.

Trust: the live room. Low impact, but it is a real trade the trade log never recorded.

> **Commissioner's ruling, Aug 26 2026 — this recommendation is now a decision.** Verbatim:
> *"Yes they swapped 4s — Kyle missed it on his trade log. SmartDraft is right."*
>
> So the analysis above was correct: **the swap is real, the room is right, and the workbook is
> incomplete.** The app already follows the room, so **nothing in the data changes** — Witte's
> second round-4 pick stays at **4.03**, not 4.09.
>
> The lasting consequence is about the *trade log*, not this pick: **`Trade Log` is Kyle Mertens'
> document and is now known to omit at least one real trade.** It is not a complete record of
> transactions. That matters at the **2027 rollover**, when the log is the only source for 2027
> pick obligations (see the trust table's "2027 pick obligations — spreadsheet only" row). Treat
> the log as narrative evidence of *why* a trade happened, and the room as evidence of *what*
> actually moved. Where they disagree on whether a trade happened at all, this ruling says the
> room wins.
>
> Recorded in `data/DECISIONS.md` under "The Stefan ↔ Witte round-4 swap is real". `npm run
> verify:picks` now reports this as a **ruled** divergence rather than an open conflict, so it
> stays visible as a known workbook gap without reading as something needing attention.

### C4 — Bench size: 7 (sheet) vs 5 (live room).

The `Roster` sheet says 7 bench spots, giving 16 total roster spots against a 16-round draft. The
live room's `rosterConfig` has `BN: 5`, giving only 14 spots against 16 rounds, which cannot be
right. `K: 0` in the live room correctly matches the no-kicker rule and the absence of any kicker
in the `Roster` sheet.

Trust: the spreadsheet's 7. The live room's bench count is almost certainly just misconfigured;
it does not affect the draft board itself.

---

## Where to trust which source

| Field | Trust | Why |
| --- | --- | --- |
| Keeper clock years and term length | **Spreadsheet** | Only source that has it. Live room carries no clock data. |
| Keeper cost-round formula | **Spreadsheet** | `−1` per season, verified across 167 rows and multiple seasons. |
| Keeper cost rounds as drafted in 2026 | **Live room** | 13 of 14 match the sheet; the one that differs (Loveland) is explained by a stale FA convention. |
| Keeper ownership | **Live room**, except Puka Nacua | 13 of 14 match; Puka is genuinely disputed. |
| Which players are keeper-ineligible | **Spreadsheet** | Both sources agree on the three expired players. |
| 2026 draft order | **Live room** | The spreadsheet's order is the 2025 order carried over and is wrong for 2026. |
| Pick ownership by (owner, round) | **Live room** | Agrees with the sheet on 27 of 29 trades; the two differences are C1 and C3. |
| Overall pick numbers | **Live room only** | `Sheet3`'s numbering is keyed to the 2025 order. |
| Trade narrative — who got what and why | **Spreadsheet** | The live room has no trade log; the sheet names players and 2027 picks. |
| 2027 pick obligations | **Spreadsheet only** | Trades #4 involves 2027 R3 and 2027 R16. Nothing in the live room tracks future years. |
| Manager full names | **Spreadsheet** | Live room has short names and null `ownerName` for all 10 teams. |
| Roster and lineup template | **Spreadsheet** | Self-consistent at 16 spots for 16 rounds; live room bench count is wrong. |
| Scoring format | **Live room** | Sheet only implies PPR in banter. |
| Rankings and ADP | **`smartdraft-players.json`** | Spreadsheets carry none. |

---

## For the commissioner

1. **Does trade #4 with Scott stand or was it reversed?** This decides who owns Puka Nacua, two
   2026 picks (Greg's R1, Scott's R15), two 2027 picks, and — critically — whether Puka is legal
   to keep at all. If it reversed, Scott is currently holding an ineligible keeper and needs a
   replacement or an open R11 pick.
2. **Confirm Colston Loveland at R9**, and confirm the free-agent keeper cost is R9 and not R8.
   The 2026 sheet's change from `FA` to `9` repriced 75 free agents by one round. It only changed
   one actual 2026 keeper, but it will matter for every future keeper decision.
3. ~~**Was the Stefan ↔ Witte round-4 swap a real trade?** It is in the live room and not in the
   log.~~ **ANSWERED Aug 26 2026: yes, it was real. The room is right and the trade log missed it.**
   See C3. No data change; the note about the log's completeness carries forward to 2027.
4. **Bench size: 7 or 5?** The spreadsheet's 7 is the only figure that reconciles with 16 rounds.
5. **Is there a floor on the cost-round formula?** Ten first-round keepers price out at "round 0".
   Nobody kept one this year, so it can wait until 2027.
6. **Confirm the clock restarts on trade.** The data says it does, which lets an expired keeper be
   traded and held two more seasons at an ever-cheaper round. Puka is the live example.
7. Exact scoring values still have to come from ESPN; neither workbook has them.

---
---

# APPENDED — ESPN league read (league 441239, season 2026)

Added by the ESPN extraction pass. Everything above this line came from the workbooks and the
Smart Draft room; everything below came from ESPN itself. **Item 7 in the list above is now
answered: the real scoring values are here.** So is conflict C4.

Supporting files live in `data/espn/`. Nothing under `src/` was touched.

## Access — authenticated read works, anonymous does not

**Anonymous access is impossible.** Every unauthenticated attempt returns
`HTTP 401 AUTH_LEAGUE_NOT_VISIBLE` — "You are not authorized to view this League." That was
verified against the modern host, the legacy host, older seasons, the `leagueHistory` endpoint
shape, the `apis/v2` shape, and single-team and league-communication endpoints. The same URL shape
returns `HTTP 200` anonymously for a public league, which proves the 401 is the league's privacy
setting rather than a wrong endpoint. Two side notes worth keeping: the legacy `fantasy.espn.com`
host answers `202` with an **empty body** (bot defence — unusable for scripts), and `apis/v2` is
gone. Use `lm-api-reads.fantasy.espn.com` and `apis/v3`.

**The commissioner's cookies arrived mid-task and the authenticated read then succeeded in full.**
The working endpoint:

```
https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/441239
  ?view=mSettings&view=mTeam&view=mRoster&view=mDraftDetail&view=mMatchup&view=mNav
Cookie: espn_s2=<ESPN_S2>; SWID=<ESPN_SWID>
```

Re-runnable any time with `node data/espn/pull-espn-league.mjs`. Prior seasons work by swapping the
`seasonId` — the league has ESPN history back to **2012**, making 2026 its 15th season.

One safety note: ESPN member ids *are* SWID cookie values, and the commissioner's own SWID appears
in the payload. The puller replaces every SWID-shaped GUID with an opaque `MEMBER-nn` label before
writing, so no credential-shaped value is stored. Manager names are kept. This was verified by
grepping `data/` for both cookie values — neither appears.

## What ESPN actually says

League name is **"The Ultimate Keeper League"** (note the leading "The"), 10 teams, private,
`isCustomizable: true`, single division named "U.S.A.".

**Scoring — every value below is identical in 2022, 2023, 2024, 2025 and 2026.** This is a
five-season-stable configuration, not a fresh mistake.

| Category | Value | ESPN statId |
| --- | --- | --- |
| Passing yards | 0.04 (1 pt per 25) | 3 |
| **Passing TD** | **6** | 4 |
| Interception thrown | −2 | 20 |
| Rushing yards | 0.1 (1 pt per 10) | 24 |
| Rushing TD | 6 | 25 |
| Receiving yards | 0.1 (1 pt per 10) | 42 |
| Receiving TD | 6 | 43 |
| **Reception** | **1.0 — full PPR confirmed** | 53 |
| Fumble lost | −2 | 72 |
| Fumble recovered for TD | 6 | 63 |
| 2-point conversion (pass / rush / rec) | 2 each | 19 / 26 / 44 |
| D/ST sack | 1 | 99 |
| D/ST interception / fumble recovery / blocked kick / safety | 2 each | 95 / 96 / 97 / 98 |
| D/ST TD (int, fumble, kickoff, punt, blocked kick return) | 6 each | 103 / 104 / 101 / 102 / 93 |
| D/ST points allowed | 0 → 5, 1‑6 → 4, 7‑13 → 3, 14‑17 → 1, 18‑27 → 0, 28‑34 → −1, 35‑45 → −3, 46+ → −5 | 89‑92, 121‑125 |
| D/ST yards allowed | <100 → 5, 100‑199 → 3, 200‑299 → 2, 300‑349 → 0, 350‑399 → −1, 400‑449 → −3, 450‑499 → −5, 500‑549 → −6, 550+ → −7 | 128‑136 |

There are **no milestone bonuses and no long-play / explosive bonuses** — previously an assumption
in the config, now confirmed. `matchupTieRule` is `NONE` (ties stand) and there is no home-team bonus.

The statId decoding was verified empirically rather than taken on trust: real 2025 season totals
were pulled for a QB, RB, WR, TE, K and D/ST and checked against football arithmetic (completions +
incompletions = attempts, tier counts summing to 17 games, tier midpoints reproducing the season
yards-allowed total). The full map, with a per-id confidence flag, is in
`data/espn/espn-stat-id-map.json`.

**Roster — also identical 2022 through 2026:**

| | ESPN |
| --- | --- |
| Starting lineup | 1 QB, 2 RB, 2 WR, 1 TE, 2 FLEX (RB/WR/TE), 1 D/ST |
| Kicker slot | **0** — and the K roster position limit is also 0, so no kicker can be rostered |
| Bench | **7** |
| IR | **1** |
| Total roster | 16 |
| Position limits | QB 4, RB 8, WR 9, TE 3, D/ST 3, K 0 |
| Lineup lock | Individual game |
| Undroppable list | On |

**Schedule, playoffs, draft, trades, waivers, money:**

| | ESPN |
| --- | --- |
| Regular season | Weeks 1–14 |
| Playoffs | Weeks 15–17, one week per round |
| Playoff teams | **6** (so the top 2 seeds get a bye) |
| Playoff seeding rule | `TOTAL_POINTS_SCORED`, no reseeding between rounds |
| Draft type | `OFFLINE`, order `MANUAL`, 90 s per pick |
| Draft board | 160 picks, 16 rounds, **snake confirmed** — ESPN's own board runs round 1 forward, round 2 reversed, round 3 forward |
| Draft date | Not set (`null`), `drafted: false`, all 160 slots empty |
| Trade deadline | **2026-11-20T08:00Z** = midnight Pacific / 02:00 Central, Fri Nov 20 2026 |
| Trade review | **48 hours**, 4 veto votes required, unlimited trades |
| Waivers | Traditional, 24-hour claim, processed daily at 11:00, order resets |
| FAAB | **Enabled**, $100 budget, $1 minimum bid |
| Money | All finance settings zero — no entry fee, no per-trade, per-add, per-drop or IR fees |

## Keepers — ESPN holds nothing, and structurally never can

This was the highest-value question and the answer is unambiguous.

- `keeperCount: 0`, `keeperCountFuture: 0`, keepers **disabled** in ESPN.
- **Zero** of the 160 draft picks are flagged `keeper` or `reservedForKeeper`. No roster entry
  carries a keeper value.
- Same in **every season checked — 2022, 2023, 2024, 2025 and 2026.** The commissioner has run
  keepers manually and left ESPN's keeper feature switched off for at least five straight years.
- **ESPN has no keeper-duration field at all.** Its entire keeper vocabulary is `keeperCount`,
  `keeperCountFuture` and `keeperOrderType`. There is no per-player clock, no keeper-year counter,
  and no "maximum consecutive seasons" anywhere in the data model.

So ESPN cannot confirm or contradict the keeper list, the per-team keeper cap, or the two-year
clock. The clock findings in the section above — the `"N of 3"` term, the −1 cost-round formula, the
free-agent placeholder round — remain the only evidence, and **this app has to be the system of
record for keepers.** ESPN will never be able to hold them.

The one thing worth adding: ESPN gives no support for `KEEPERS.maxPerTeam: 2` either. The only
support is usage in the Smart Draft room — 7 of 10 teams kept exactly 2, three kept none, nobody
kept 3. That is inference, not a declared setting.

## Conflicts

### E1 — Bench size: RESOLVES C4 in favour of the spreadsheet

ESPN says **7 bench**, in all five seasons checked. C4 above called it for the spreadsheet's 7 on
the reasoning that 9 + 7 = 16 = the 16 draft rounds; ESPN independently confirms it. The Smart Draft
room's `BN: 5` is simply misconfigured. `src/lib/league-config.ts` currently has `bench: 5`, taken
from Smart Draft, and needs changing.

### E2 — Playoff teams: 6, not 4

`LEAGUE.playoffTeams` is 4 in the config. ESPN says 6, in all five seasons. Nothing else in the
repo had a figure, so this was an unchallenged placeholder that happened to be wrong.

### E3 — Passing TD is 6 points, not 4. Affects Saturday.

ESPN scores passing touchdowns at **6**, not the ESPN default of 4. Nothing in the repo captured
this. It materially raises quarterback value, so **any ranking or ADP built on standard 4-point
passing TDs understates QBs for this league** — including, most likely, the Reddit-sourced rankings
in `data/smartdraft-players.json`. Worth a sanity check on the QB tier before the board is printed
on Saturday.

### E4 — Draft order: ESPN and Smart Draft disagree at slots 8 and 10

| Slot | ESPN | Smart Draft / workbooks |
| --- | --- | --- |
| 1 | Ted Buckman (Perpetually Impaired) | Zach Rakowski |
| 2–7, 9 | *(agree)* | *(agree)* |
| 8 | **Colin Tracy** | **Stefan Albers** |
| 10 | **Stefan Albers** | **Colin Tracy** |

Colin and Stefan are swapped. ESPN's configured `pickOrder` and its pre-generated board agree with
each other exactly, so this is not an ESPN internal inconsistency.

The tempting call is "ESPN is stale, trust the live room", but the evidence does not support it:
ESPN's order is `MANUAL` and is a **different, deliberate order in every season** (2022 through 2026
are all distinct), so somebody set the 2026 order on purpose. Against that, the ESPN draft has never
been run — type `OFFLINE`, date null, board empty — and Smart Draft is the room being used Saturday.
Also note `data/managers.json` and the draft-order row in the table above both derive from Smart
Draft, so this is **one source against one**, not three against one. The commissioner has to call it.

### E5 — Manager identity at slot 1: Ted Buckman vs Zach Rakowski

ESPN says the slot-1 franchise "Perpetually Impaired" is owned by **Ted Buckman**, who appears in
ESPN in every season 2022–2026. **Zach Rakowski** appears in the `KEEPER LIST` sheets and the Smart
Draft room but **nowhere in ESPN**. Most likely Zach has taken over Ted's franchise and the ESPN
owner was never reassigned — but it could equally be that Ted still owns the ESPN account and Zach
is the person who actually plays. Either way, one of the ten managers is recorded under a different
name in the two systems.

### E6 — Trade deadline is week 11, not week 12

The config says `deadlineWeek: 12`. ESPN's deadline is **Fri Nov 20 2026, 02:00 Central**. The 2026
NFL season opens Thu Sep 10, so week 11 runs Nov 19–23 and week 12 does not start until Nov 26. The
deadline therefore falls inside **week 11** — and awkwardly, mid-week, after the Thursday night game
but before Sunday. Worth asking whether that is intended.

### E7 — Trade review is 48 hours, not instant

The config says `reviewHours: 0`. ESPN says 48, with 4 veto votes required. ESPN's own preset default
is 24, so 48 was chosen deliberately. Trades in this league are **not** instant.

### E8 — Franchise names exist, and the repo does not have them

`data/managers.json` has `franchiseName: null` for all ten managers, and the section above notes the
workbooks contain no franchise nicknames. ESPN has real names and abbreviations for all ten:

| Manager | Franchise | Abbrev |
| --- | --- | --- |
| Kyle Mertens | Tushy Booth Ballers | TBB |
| Greg Blome | Jimmy's Johnson | JJ |
| Kyle Witte | The Replacement Team | DinP |
| Colin Tracy | Flurp McDerp | CT |
| Joshua Grainger | Teddys Trouser Snake | TITS |
| Scott Johnston | DHB Sandmen | DHB |
| Stefan Albers | Mound City Dogs | DOGS |
| Joe Murray | Fingers are for painting | HOJO |
| Scott Elbe | A.D.B. Rombusters II | ADB |
| *(Ted Buckman — see E5)* | Perpetually Impaired | PI |

Joined by **person**, not draft slot, so the E4 slot conflict does not corrupt them. Ready to drop
into `managers.json`. Note "DHB Sandmen" matches the one nickname the 2017 sheet did carry.

### E9 — IR slots: 1, not 2

The config guesses `irSlots: 2`. ESPN says 1, in all five seasons.

### E10 — Kicker: no slot, but the scoring rules still exist

`lineupSlotCounts` for K is 0 **and** the K roster position limit is 0, so no kicker can be
rostered — the no-kicker rule is confirmed twice over. But ESPN still has kicker point values
configured (FG 0‑39 = 3, 40‑49 = 4, 50‑59 = 5, 60+ = 5, missed = −1, XP = 1, XP missed = −2). They
are inert. `SCORING_EXCLUSIONS` currently claims "no kicker scoring", which is not literally true.

### E11 — Cross-check on `undraftedDefaultRound` (not an ESPN finding)

ESPN has nothing on this, but flagging it while the config is open: `KEEPERS.undraftedDefaultRound`
is **10**, which matches neither figure derived above — the 2024/2025 free-agent convention priced
them at **R9**, and the 2026 sheet's changed convention yields **R8**. Whatever the commissioner
decides on the free-agent question, 10 is wrong.

## Exact changes for `src/lib/league-config.ts`

Machine-readable version with per-item evidence: `data/espn/espn-league-config-recommendations.json`.

| Export | Current | Change to | Evidence |
| --- | --- | --- | --- |
| `LEAGUE.playoffTeams` | `4` | `6` | ESPN `playoffTeamCount`, 2022–2026 |
| `ROSTER.bench` | `5` | `7` | ESPN slot 20, 2022–2026 + `Roster` sheet |
| `ROSTER.irSlots` | `2` | `1` | ESPN slot 21, 2022–2026 |
| `ROSTER.activeCap` | `14` | `16` | 9 starters + 7 bench |
| `ROSTER.positionalMax` | `"Not yet defined"` | `{ QB: 4, RB: 8, WR: 9, TE: 3, DST: 3, K: 0 }` | ESPN `positionLimits` (changes the field's type) |
| `DRAFT.clockSeconds` | `120` | `90` | ESPN `timePerSelection` |
| `TRADES.reviewHours` | `0` | `48` | ESPN `revisionHours` |
| `TRADES.deadlineWeek` | `12` | `11` | ESPN deadline 2026-11-20 — **confirm intent first** |
| `BASE_SCORING` | 6 of 7 rows `"TBD"` | Passing yds `0.04`, Rushing yds `0.1`, Receiving yds `0.1`, Reception `1.0`, Passing TD **`6`**, Rushing TD `6`, Receiving TD `6` | ESPN, 2022–2026 |
| `TURNOVER_SCORING` | 3 rows `"TBD"` | Int thrown `-2`, Fumble lost `-2`, Fumble rec TD `6`, DST TD `6` | ESPN, 2022–2026 |
| `SCORING_SPEC` | `{ kicker: false, ppr: 1 }` | Full spec — see the JSON file | ESPN, 2022–2026 |
| `SCORING_EXCLUSIONS` | "No kicker scoring" | Reword: no kicker *slot* (K slot 0 and K position limit 0); kicker point values exist but are inert; no milestone or explosive bonuses | ESPN |
| `KEEPERS.maxPerTeam` | `2` | **`2` — value unchanged**, but retag `@placeholder` → Smart-Draft-inferred, and note ESPN cannot corroborate | Smart Draft usage |
| `KEEPERS.maxConsecutiveSeasons` | `2` | **`2` — value unchanged**, add a comment that ESPN structurally cannot store this | — |

Confirmed correct, no change needed — but the `@placeholder` tags should come off:
`LEAGUE.teams` 10, `LEAGUE.currentSeason` 2026, `LEAGUE.regularSeasonWeeks` `[1, 14]`,
`LEAGUE.playoffWeeks` `[15, 17]`, `STARTING_LINEUP` (exact match, including no kicker),
`ROSTER.starters` 9, `DRAFT.rounds` 16, `DRAFT.snake` true, `SCORING_FORMAT` `"PPR"`,
`MILESTONE_BONUSES` `[]`, `EXPLOSIVE_BONUSES` `[]`, `KEEPERS.fees` false, `FEATURES.treasury` false.

Suggested additions, all from real ESPN values: a `WAIVERS` block (traditional, 24 h, daily at
11:00, order resets, FAAB on with $100 / $1 min), a `PLAYOFFS` block (6 teams, weeks 15–17, one-week
rounds, 2 byes, no reseed, seeding rule `TOTAL_POINTS_SCORED`), `TRADES.vetoVotesRequired: 4`, the
single division name "U.S.A.", and `LEAGUE.espnLeagueId: 441239` / first season 2012. Also worth
noting that `FEATURES.platformSync: false` is now a *choice* rather than a limitation — the ESPN read
API works.

Still placeholders with no evidence anywhere: `LEAGUE.shortName`, `LEAGUE.tagline`,
`DRAFT.keeperLockHoursBeforeDraft`, `KEEPERS.round1Eligible`, `KEEPERS.undraftedDefaultRound`,
`KEEPERS.undraftedYear2Round`, `KEEPERS.costRoundEscalationPerSeason`,
`TRADES.futurePicksSeasonsOut`, `TRADES.requirePickCountBalance`, `VOTING_THRESHOLDS`, `OFFICERS`,
`CALENDAR_EVENTS`. ESPN holds no governance data at all.

## For the commissioner — ESPN items

These are in addition to the seven questions above.

1. **Draft order — slots 8 and 10.** ESPN has Colin 8th and Stefan 10th; Smart Draft has them the
   other way round. Both look deliberate. Which is right for Saturday?
2. **Who owns "Perpetually Impaired"?** ESPN says Ted Buckman; the keeper sheets and Smart Draft say
   Zach Rakowski. If Zach took the team over, ESPN needs reassigning.
3. **Passing TDs are 6 points in ESPN.** Confirm that is intended — and be aware the imported
   rankings probably assume 4, which undervalues QBs on the board.
4. **Trade deadline lands mid-week-11** (Fri Nov 20, 2 a.m. Central). Intended, or should it be end
   of week 12?
5. **Waivers: FAAB or rolling order?** ESPN has traditional waivers *and* a $100 FAAB budget switched
   on, which is contradictory. ESPN's default is FAAB off, so someone enabled it.
6. **Playoff seeding by total points scored?** ESPN's `playoffSeedingRule` is `TOTAL_POINTS_SCORED`
   rather than head-to-head record, which is unusual.
7. **Turn ESPN's keeper feature on, or leave it off?** It has been off for five seasons and ESPN
   cannot represent the two-year clock regardless, so leaving it off and letting this app own
   keepers is the honest answer — just confirm that is the plan.

## Files created under `data/espn/`

| File | What it is |
| --- | --- |
| `espn-scoring-settings.json` | Full decoded scoring, every item with its point value and category |
| `espn-roster-settings.json` | Lineup slots, bench, IR, position limits |
| `espn-schedule-playoff-settings.json` | Regular season and playoff weeks, playoff field, seeding |
| `espn-keeper-settings.json` | What ESPN holds on keepers (nothing) and why |
| `espn-draft-settings.json` | Draft type, order, rounds, clock |
| `espn-trade-waiver-settings.json` | Trade deadline, review, vetoes, waivers, FAAB, finances |
| `espn-teams.json` | Ten teams with franchise names, abbreviations, owners |
| `espn-rosters.json` | Roster entries per team (all empty — the draft has not happened) |
| `espn-league-2026-raw.json` | The complete raw payload, SWID-redacted, for anything not decoded |
| `espn-settings-history.json` | The same settings across 2022–2025, proving five-season stability |
| `espn-keeper-findings.json` | The keeper answer in detail, incl. the Smart Draft inference |
| `espn-teams-crosswalk.json` | ESPN teams joined to known managers; franchise names ready for `managers.json` |
| `espn-league-config-recommendations.json` | Every recommended config change with its evidence |
| `espn-stat-id-map.json` | ESPN statId → category, with per-id confidence |
| `espn-lineup-slot-map.json` | ESPN lineup slot id → position |
| `espn-ppr-preset-2026-decoded.json` | ESPN's own PPR preset, for reference (**not** league settings) |
| `espn-access-probe.json` | Every endpoint tried and its result |
| `pull-espn-league.mjs` | Re-runnable puller. `node data/espn/pull-espn-league.mjs` |

`pull-espn-league.mjs` sits in `data/espn/` only because this pass was scoped to `data/`. It belongs
in `scripts/` — whoever moves it just needs to fix the two relative paths at the top.
