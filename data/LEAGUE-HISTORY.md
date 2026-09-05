# League history: verified material for the recap

Everything a blurb might want to be funny about, with the source it came from and
how far it can be trusted. The recap prompt treats this document as ground
truth, so **an unmarked guess here becomes a wrong number read aloud to ten men
who were in the room.** That is the whole reason for the sourcing discipline
below.

`data/league-history.json` is the machine-readable twin of this file. Same
facts, same sources, same confidence marks. Read this one for the reasoning.

**This document records facts, not jokes.** Where it is not obvious why
something is funny there is a short parenthetical. The blurbs are somebody
else's job.

## How to read a claim here

| Mark | Means |
|---|---|
| **verified** | A primary source in this repo says it in terms, or two independent sources agree. |
| **derived** | Computed from repo data by a method stated alongside it. `npm run verify:history` re-computes it. |
| **inferred** | Follows from repo data by an argument that is written out, not from a source that says it outright. Probably true. Do not read the number aloud as a fact. |
| **unverified** | Only ever in the last section. Nothing there may be stated as fact. |

---

## The identity trap — read this before anything else

**Four of the ten managers share a first name with another manager, and there
are two Scotts.** Worse, `Scott` and `Kyle` are each simultaneously a legitimate
short name for one man *and* the first name of a different one, so a first-name
match does not fail loudly — it silently resolves to the wrong franchise.

**Always match on the short name.** Never on a first name.

| Short name | Full name | Franchise | Slot | Notes |
|---|---|---|---|---|
| `Zach` | Zach Rakowski | Perpetually Impaired | 1 | ESPN lists this franchise under **Ted Buckman**; the commissioner ruled Ted and Zach are the same person — an inside joke on the ESPN account. |
| `Witte` | **Kyle** Witte | The Replacement Team | 2 | The second Kyle. Not a Scott. |
| `Joe` | Joe Murray | **Fingers are for painting** | 3 | |
| `Josh` | Josh Grainger | Teddys Trouser Snake | 4 | |
| `Elbe` | **Scott** Elbe | A.D.B. Rombusters II | 5 | The second Scott. In sales. Said aloud as **"LB"** — a fourth handle for the same man. **He reached for Lamar Jackson and called him a good PPR quarterback.** |
| `Kyle` | Kyle Mertens | Tushy Booth Ballers | 6 | **League commissioner**, and the only officer. An accountant. |
| `Scott` | **Scott Johnston** | DHB Sandmen | 7 | The lawyer. The Johnston in the Johnston/Blome agreement. Also the league's scribe — see the unverified section. |
| `Stefan` | Stefan Albers | Mound City Dogs | 8 | An accountant. |
| `Greg` | Greg Blome | Jimmy's Johnson | 9 | The Blome in the Johnston/Blome agreement. |
| `Colin` | Colin Tracy | Flurp McDerp | 10 | In sales. Runs this app. **Not** the commissioner. |

Source: `data/managers.json`, whose note reads *"Two Kyles and two Scotts: the
second of each goes by last name (Witte, Elbe)"*; corroborated by
`data/DECISIONS.md`, "Manager identity — first names are NOT unique". Franchise
names come from ESPN via `data/espn/espn-teams-crosswalk.json`, joined by person
rather than by draft slot. **verified**

**Professions.** Only these, and no employers: Scott Johnston is a lawyer;
Stefan and Kyle Mertens are accountants; Colin is in sales; Elbe is in sales;
Greg has owned a couple of businesses. Joe's job is deliberately not recorded —
Colin was unsure and will ask him. Nothing about anyone's family, appearance,
health, finances or personal life appears anywhere in this document, and nothing
was searched for.

**Who these people are in the room** is persona rather than history, so it lives
in `src/lib/league-lore.ts` with the rest of the register: who is loud, who is
quiet, who mutters the best line of the night. Colin dictated the lot on draft
day and it is his characterisation, not an inference from the sheets.

---

## Keepers: there are nineteen, and here is the trap that says otherwise

**Nineteen keepers. All ten franchises have declared. The matter is closed.**
The commissioner, Aug 28 2026:

> "You keep getting confused about 16 keepers, 17 keepers, or 19 keepers. What
> you have here in this app, now in our database, should be the source of truth.
> We haven't even updated Smart Draft since I started building this app. This is
> what we're using, so the keepers are locked and declared. There are 19 keepers.
> Every team has declared their keepers."

**`data/smartdraft-room-snapshot.json` and `data/keepers-2026-resolved.json` are
frozen historical seeds, not live sources.** Smart Draft has not been touched
since this app was built. This app's board and database are authoritative.

**The trap, written down because it has now caught two separate readers.** The
resolved file holds 14 rows; the room snapshot holds 16; the declarations
overflow file holds 3. Adding the resolved file to the declarations file gives
17, which is wrong — it drops Scott Elbe's two, which are in the room but not in
the resolved file, because the resolved file was joined when the room held 14.
The correct arithmetic is 16 (room) + 3 (declarations) = 19.

**Do not count keepers by adding JSON files together. Count the assembled
board:** `npm run verify:board-keepers`. **verified**

### The board

| Slot | Player | Manager | Cost | Own pick? | Final season? |
|---|---|---|---|---|---|
| 4.02 | Garrett Wilson | Greg | 4 | yes | **yes** |
| 4.06 | Jaxon Smith-Njigba | Kyle | 4 | on Elbe's | **yes** |
| 4.09 | Rashee Rice | Stefan | 4 | on Witte's | no |
| 6.02 | Rome Odunze | Greg | 6 | yes | no |
| 6.05 | Ladd McConkey | Zach | 6 | on Kyle's | no |
| 6.07 | Brock Bowers | Josh | 6 | yes | **yes** |
| 6.09 | Chase Brown | Kyle | 6 | on Witte's | **yes** |
| 7.01 | Justin Jefferson | Zach | 7 | yes | **yes** |
| 7.04 | Travis Etienne | Josh | 7 | yes | no |
| 7.05 | Javonte Williams | Elbe | 7 | yes | no |
| 7.07 | Kyren Williams | Scott | 7 | yes | no |
| 8.01 | Trey McBride | Colin | 8 | yes | **yes** |
| 8.10 | De'Von Achane | Witte | 8 | on Zach's | no |
| 9.03 | Jayden Daniels | Joe | 9 | yes | no |
| 9.05 | Cam Skattebo | Elbe | 9 | yes | no |
| 9.08 | Colston Loveland | Stefan | 9 | yes | no |
| 10.01 | Bucky Irving | Colin | 10 | yes | no |
| 11.02 | Tucker Kraft | Witte | 11 | yes | no |
| 11.07 | **Puka Nacua** | **Scott** | **11** | yes | *the app declines to say* |

**Six players must be released back into the 2027 pool after this season:**
Garrett Wilson, Jaxon Smith-Njigba, Brock Bowers, Chase Brown, Trey McBride and
Justin Jefferson. **Kyle Mertens is the only manager whose *both* keepers are in
their final season** — he enters 2027 with nothing carried over. **verified /
derived**

**Joe kept one out of a permitted two, deliberately.** It is a settled, final
answer given on Aug 27, carrying `closesList: true` in the declaration file
precisely so a short list could be told apart from a silent one. It is not a
missed deadline and not an oversight. **The roast belongs on the judgement, not
on the paperwork** — and see the counterfactual below for what he passed up.
**verified**

**Zach's declaration has no `closesList` flag and that is correct** — he
declared two of a maximum two, so nothing is outstanding and he is not
delinquent.

---

## The Johnston / Blome Trade Agreement

This has its own section because it is the best material in the repository, and
because it will be read out to a room containing both signatories, one of whom
argues for a living. **Every quotation below is verbatim from the primary
source.**

**Primary source: `docs/2025-johnston-blome-trade-agreement.pdf`**, copied into
the repo on Aug 28 2026 so it stops living in a Downloads folder. Before that,
every quotation of it anywhere in this repo was second-hand through
`data/DECISIONS.md`.

### What the document is

A two-page **TRADE AGREEMENT**, effective **November 12, 2025**, between
**Jimmy's Johnson ("JJ")**, signed *Greg Blome, Manager*, and **DHB Sandmen
("DHB")**, signed *Scott Johnston, Manager*. It carries a law-firm document
control number, `4918-6057-0233v1`, and DocuSign Envelope ID
`6BB1516F-9AC6-403E-9791-30394C06C9B9`.

It has WHEREAS recitals. It has a "NOW, THEREFORE, in consideration of the
mutual covenants, terms, and conditions set forth in this Agreement, and for
other good and valuable consideration, the receipt and sufficiency of which are
hereby acknowledged" clause. It has defined terms in quotation marks. It has a
sentence beginning "For the avoidance of doubt". It ends page one with
"{Remainder of page intentionally left blank; signature page follows}" and page
two with "IN WITNESS WHEREOF".

It is a contract for a fantasy football trade.

**And it has a typo in its own defined term.** Clause 2 defines the deal as *the
"**Continent** 2026 Trade"* — missing the g. Every subsequent reference in the
document, including the option clause, calls it the "Contingent 2026 Trade",
which the document never defines. **verified** (A lawyer's contract, with a typo
in the defined term, and then a defined term he never uses again.)

### The terms, as written

**Clause 1 — the "2025 Trade", effective immediately:**

| DHB (Scott) sends | JJ (Greg) sends |
|---|---|
| Puka Nacua | Kyle Monangai |
| Derrick Henry | JJ's 2026 **1st** Round pick |
| DHB's 2026 15th Round pick | JJ's 2026 3rd Round pick |
| DHB's 2026 16th Round pick | JJ's 2027 3rd Round pick |
| DHB's 2027 16th Round pick | |

**Clause 2 — the "Contingent 2026 Trade", to fire on the day before the 2026
draft**, verbatim:

> "On the day before the 2026 League Draft, as long as Nacua is not projected by
> a majority of media outlets to miss six (6) weeks or more of the 2026 season
> due to injury (a "Nacua Injury"), DHB and JJ agree to consummate the following
> trade…"

DHB hands back JJ's 2026 1st and JJ's 2027 3rd. JJ hands back Nacua, DHB's 2026
15th and DHB's 2027 16th.

**And then the clause that is the whole thing:**

> "In the event of a Nacua Injury, DHB shall have the option prior to the 2026
> League Draft to either (i) consummate the Contingent 2026 Trade, or (ii)
> cancel the Contingent 2026 Trade, with DHB retaining the picks exchanged in
> the 2025 Trade and JJ retaining Nacua. **For the avoidance of doubt, Nacua
> shall retain his 2026 League Draft 11th round draft Keeper eligibility whether
> or not the Contingent 2026 Trade is consummated.**"

### The asymmetry, stated precisely

This is the single best fact in the recap and it has to be exactly right,
because a sloppy version is the one thing Scott could argue his way out of.
**The option is one-directional and the document says so; this is not an
inference.**

| Branch | What happens | Who chooses |
|---|---|---|
| Nacua healthy | Both parties "agree to consummate". Scott takes Nacua back at an R11 keeper price; Greg gets his 2026 1st and 2027 3rd returned. | **Nobody. Mandatory.** |
| Nacua injured, Scott elects (i) | Scott takes an injured Nacua anyway and returns Greg's picks. | **Scott** |
| Nacua injured, Scott elects (ii) | Scott **keeps Greg's 2026 1st**, 2026 3rd and 2027 3rd, plus Monangai. Greg is left holding an injured Nacua. | **Scott** |

**JJ holds no election in any branch.** Healthy Nacua, Scott gets the receiver.
Injured Nacua, Scott gets to keep Greg's first-round pick instead. There is no
outcome Scott has to accept and nothing Greg gets to decide. **verified**

**On the price of that protection.** The agreement identifies **no separate
consideration for the option**. It is granted inside the same blanket "other
good and valuable consideration, the receipt and sufficiency of which are hereby
acknowledged" recital that covers everything else. Say that the *protection* is
free. Do not say Scott "paid nothing" — he sent real players and real picks. The
narrower claim is the stronger one. **verified**

**And nobody was appointed to count the outlets.** The document does not define
"media outlets", does not name a source, does not say who determines the
projection, sets no tiebreak and appoints no adjudicator. The only party with a
decision to make under the clause is the party holding the option. **verified**
(These are absences, confirmed by reading the document; they are not claims that
something was removed.)

### One correction to the oral account, and it matters

The commissioner's recollection, relayed Aug 28: *"they made a rule where, if
Puca got hurt, they could revert the trade, and it wouldn't be keeper-eligible."*

**The document says the opposite, in terms.** The "For the avoidance of doubt"
sentence exists specifically to preserve the R11 keeper eligibility *whether or
not* the contingent trade consummates. The injury clause governs **who holds
him**, not whether he is keepable.

**Use the written version. It is worse for Scott anyway:** they did not merely
reserve a right to revert — they wrote a clause ensuring the cheap keeper price
survived either outcome. **verified**

### The net effect of both legs, checked against the board

| | Scott / DHB | Greg / JJ |
|---|---|---|
| Gains | Kyle Monangai, **Greg's 2026 3rd** | Derrick Henry, **Scott's 2026 16th** |
| Gives | Derrick Henry, his own 2026 16th | Kyle Monangai, his own 2026 3rd |
| Nacua | Round trip. Starts his, ends his. | Held from Nov 12 to the end of 2025, then returned. |
| 2027 | Cancels out entirely | Cancels out entirely |

**Scott turned Derrick Henry and a 16th-round pick into Kyle Monangai and a
3rd-round pick, and got Nacua back.** Greg paid Monangai and a 3rd, received a
16th, and lent his first-round pick as collateral for nine months.

Every leg checks out against the live 2026 board: Scott holds Greg's R3, Greg
holds Scott's R16, Greg has his own R1 back, Scott has his own R15 back, and no
2027 pick has moved. `npm run verify:picks` confirms all 160 slots against four
independent sources and names these as documented, ruled divergences from the
workbook. **verified**

**And the commissioner's own spreadsheet never caught up.** Sheet1's pick
inventory agrees with the board for eight of the ten franchises. The only two it
gets wrong are **Greg and Scott** — it still records the pre-contingency
position, with Scott holding Greg's 1st and Greg holding Scott's 15th. **derived**
(Of ten franchises, the only two the commissioner's spreadsheet has wrong are
the two who wrote themselves a contract.)

**Greg's permanent return on the whole agreement is Derrick Henry and a
sixteenth-round pick — and Derrick Henry is keeper-ineligible.** He occupied a
round-1 slot in 2025, so he prices to round 0 and is barred outright. Greg loses
him to the 2026 pool as well. **derived**

**In fairness to Greg, and it makes the story better rather than worse:** Nov 12
2025 is week 11 of a season whose playoffs run weeks 15–17. He bought Nacua and
Derrick Henry for the run-in, and by the draft-order derivation below he
finished **2nd**. He was not fleeced in a vacuum. He bought a title run, came
second, and paid for it in August. **inferred**

### The keeper-clock exploit, which is the real story

**The trade did not make Puka Nacua cheap. He was already cheap. What the trade
did was bring a dead keeper clock back to life.**

| Season | What happened | Cost |
|---|---|---|
| 2023 | **Drafted by Scott Johnston in round 14, pick 137 of 160.** | — |
| 2024 | Kept by Scott | R13 |
| 2025 | Kept by Scott — third season, clock spent | R12 |
| 2026 | Priced by the ordinary minus-one rule | **R11** |

R14 to R11 in three seasons, entirely by the ordinary rule. Nobody engineered
the price; the 2023 draft did. **verified**

**The agreement's own recital elides this.** It describes Nacua as "drafted in
the 12th Round of the 2025 League draft". In this league a keeper occupies his
cost-round slot on the draft sheet, so a keeper and a real pick look identical —
`data/RECONCILIATION.md` says exactly that. Nacua's "twelfth round" in 2025 was
the third rung of a ratchet, and by then he was finished. **verified**

**The dead clock, in the commissioner's own workbook, written before the
trade.** `KEEPER LIST for 2025` records Puka Nacua under **Scott Johnston**:
2024 status `2 of 3`, 2025 status `3 of 3`, **2026 status `N/A`**. N/A means
Scott could not have kept him in 2026 at any price. **verified**

**The resurrection, in the same commissioner's workbook one year later.**
`KEEPER LIST for 2026` records the same player under **Greg Blome**: 2025 status
`1 of 3`, 2026 `2 of 3`, 2027 `3 of 3`, cost round 11, flagged **TRADE**. The
clock the previous sheet marked N/A is back at year one. **verified**

The mechanism is the league's own rule, and it is quoted in the recitals of the
contract that used it:

> "WHEREAS, per League rules, if a player is traded by a League team, such
> player's Keeper eligibility restarts with his new League team, but such player
> retains their previous season's draft round value for Keeper purposes;"

**What this app records.** Nacua is the only keeper on the board whose clock
fields are all `null` — `clockYear2026`, `isFinalKeeperSeason` and
`keepableIn2027`. `src/lib/keeper-tenure-dispute.ts` exists for exactly one
entry, records both readings (final season 2027 or 2028), and prints "Kept in
2026 · final season disputed" on every surface rather than a number. **verified**

(Ten managers, two spreadsheets and a DocuSigned contract all have an answer.
The software is the only participant that declines to sign off on it.)

### The punchline number

**Puka Nacua is being kept at 11.07 — the 107th slot of 160 — and his
keeper-adjusted expected pick on this board is 4.**

That is a **steal of 103 picks**. The next-biggest keeper bargain in the league
is De'Von Achane at +72; Nacua beats the field by 31 picks. His raw consensus
ADP across nine feeds is **4** — he is the fourth-ranked player in the entire
pool.

Method: `src/lib/expected-pick.ts` — rank the pool by ADP with kept players
removed, then map the nth-ranked available player to the nth draftable slot on
this board. That produces a real slot rather than a generic-league ADP, which is
the only way the subtraction means anything here. **derived**

Full bargain table, for context — every keeper, best value first:

| Player | Manager | Slot | ADP | Expected | Steal |
|---|---|---|---|---|---|
| **Puka Nacua** | **Scott** | 11.07 | 4.0 | 4 | **+103** |
| De'Von Achane | Witte | 8.10 | 11.2 | 8 | +72 |
| Bucky Irving | Colin | 10.01 | 45.6 | 30 | +61 |
| Cam Skattebo | Elbe | 9.05 | 39.0 | 26 | +59 |
| Colston Loveland | Stefan | 9.08 | 42.8 | 30 | +58 |
| Trey McBride | Colin | 8.01 | 21.6 | 16 | +55 |
| Justin Jefferson | Zach | 7.01 | 12.2 | 9 | +52 |
| Chase Brown | Kyle | 6.09 | 14.4 | 11 | +48 |
| Tucker Kraft | Witte | 11.02 | 71.4 | 54 | +48 |
| Kyren Williams | Scott | 7.07 | 29.6 | 22 | +45 |
| Javonte Williams | Elbe | 7.05 | 30.4 | 22 | +43 |
| Brock Bowers | Josh | 6.07 | 22.8 | 16 | +41 |
| Travis Etienne | Josh | 7.04 | 38.8 | 26 | +38 |
| Jayden Daniels | Joe | 9.03 | 63.0 | 48 | +35 |
| Jaxon Smith-Njigba | Kyle | 4.06 | 5.8 | 5 | +31 |
| Ladd McConkey | Zach | 6.05 | 45.0 | 30 | +25 |
| Rashee Rice | Stefan | 4.09 | 26.2 | 19 | +20 |
| Rome Odunze | Greg | 6.02 | 61.8 | 48 | +4 |
| Garrett Wilson | Greg | 4.02 | 40.8 | 28 | +4 |

**Greg holds the two worst-value keepers on the board.** He is also the man who
handed back the best one. **derived**

### Who approved it: nobody

- **No record of league approval, ratification, review or veto exists anywhere**
  — not in `data/DECISIONS.md`, not in the governance tables, not in the git
  history, not in the document. The agreement is signed by two people and nobody
  else. There is no commissioner signature block, no ratification clause and no
  notice provision. **verified**
- **No rule required it and no rule forbade it.** `data/DECISIONS.md` puts the
  question to the league as ballot item 3, *"Are contingent trades permitted at
  all?"*, precisely because *"No rule currently permits or forbids this, which
  is the problem."* **verified**
- **What mechanism did exist could not have reached it.** ESPN's settings do
  provide a 48-hour trade review with 4 veto votes required. But ESPN holds no
  draft-pick ownership for an offline draft and has keepers switched off
  entirely, so the pick legs, the contingency and the keeper consequence existed
  outside any league system capable of reviewing them. **verified**
- **One objection is on the record and it is the operator's.** Colin's
  description, in `data/DECISIONS.md`: *"a one-off that should have gone to a
  vote before it ever happened."* He has also called the arrangement
  illegitimate. Relayed separately Aug 28: *"No one ever agreed to it, no one
  ever approved it. They just kinda went rogue and did their own damn thing."*
  He is a party to the dispute and holds no authority over it. **verified**
- **Kyle Mertens has not ruled on whether it was legitimate.** He declined to
  settle the trade-and-reset loophole unilaterally and sent it to a league vote.
  What is settled is narrower: Nacua is Scott's at R11 for 2026, and that rests
  on the contract's own express term rather than on a quoted ruling. **Do not
  attribute a verbatim ruling on this agreement to Kyle — none exists.**
  **verified**

**The own goal, and it is a good one.** `data/DECISIONS.md` notes the same
trade-and-reset mechanism has been used in this league before, "to hold Trey
McBride a third season" — and **Trey McBride is Colin's keeper, in his third
season, showing 3 of 3.** The keeper sheets trace it: McBride appears on the
2024 list under *Stefan Albers* as a free-agent acquisition with "Colin" in the
trailing column, on the 2025 list under *Colin Tracy* flagged `x-Stefan`, and on
the 2026 list at 3 of 3. Any fix, per the same document, "applies retroactively
to everyone or to no one." **verified**

(The loudest objector to the loophole is holding a keeper he obtained through
it. One caution: `DECISIONS.md` calls this person "the commissioner" in a
passage written before that document separated Kyle Mertens from Colin. The
player is unambiguously Colin's on the board; treat the mechanism as documented
and that sentence's wording as loose.)

### Did it fire?

Yes, in every source that matters — the board, the room and the pick ledger all
carry the netted position, with Nacua as Scott's keeper at 11.07.

**Timing:** the contingent leg was due "on the day before the 2026 League
Draft". The draft is Saturday Aug 29 2026, so the due date was **Friday Aug 28 —
the day this was written.** `data/DECISIONS.md` asks for a check: *"Worth a
check on Friday before the board is printed."* **No such check is recorded
anywhere.** Every source here assumes the condition was not met; none verifies
it. **Do not build a joke on Nacua's 2026 health status.** **verified /
unverified as marked**

---

## Cam Skattebo: the legitimate version of the play

Recorded here **as ordinary league business**, not as a lesser scandal. The
commissioner's ruling on the comparison, Aug 28:

> "Nothing compared to the Johnston and Blome trade. Cam Skattebo reached Elbe by
> trade. It's an art form to keep people high."

Acquiring a player and then keeping him at a good cost round is normal, admired
play here. **Trade #9:** Elbe received Stefon Diggs, Cam Skattebo and Kyle's
2026 8th; Kyle received Darius Slayton and Elbe's 2026 4th. Both pick legs check
out on the board. **verified**

**Why it is structurally different from the Nacua business, in one sentence:**
Skattebo's clock was never dead. He was drafted by Kyle Mertens in round 10 of
the 2025 draft, pick 95, and the 2026 sheet has him at `2 of 3` — a live,
ordinary second season that Kyle could have used himself at R9 and chose not to.
Elbe bought an asset that was already keepable. **Nothing was resurrected.**
**verified**

Skattebo at 9.05 is a +59 steal, which is the fourth-best on the board. That is
the art form working.

---

## Pick ownership: nobody is destitute, and one claim is false

**Every franchise holds exactly 16 picks.** The 29 traded picks net out
perfectly, so there is no pick-rich and no pick-poor by count. The entire story
is *which* rounds. Verified against four independent sources by
`npm run verify:picks`. **verified**

| Manager | Rounds held | Missing | Doubled | First owned |
|---|---|---|---|---|
| Colin | 1,2,3,5,7,8,9,9,10,10,11,12,13,14,15,16 | 4, 6 | 9, 10 | 1 |
| Elbe | 1,2,3,5,7,8,8,9,10,11,12,13,13,14,15,16 | 4, 6 | 8, 13 | 1 |
| Greg | 1,2,4,5,6,7,8,9,10,11,12,13,14,15,16,16 | 3 | 16 | 1 |
| Joe | 1,2,3,5,6,6,7,8,9,10,11,12,13,14,15,16 | 4 | 6 | 1 |
| Josh | 1,2,3,5,6,7,8,9,10,11,12,12,13,14,15,16 | 4 | 12 | 1 |
| Kyle | 1,3,4,5,5,6,7,9,9,10,10,11,13,14,15,16 | 2, 8, 12 | 5, 9, 10 | 1 |
| Scott | 1,2,3,3,4,4,5,6,6,7,8,9,10,11,14,15 | 12, 13, 16 | 3, 4, 6 | 1 |
| **Stefan** | 2,3,4,5,5,6,7,7,9,10,11,12,13,14,15,16 | **1**, 8 | 5, 7 | **2** |
| Witte | 1,2,2,3,4,4,6,8,8,8,11,12,13,14,15,16 | 5, 7, 9, 10 | 2, 4, 8 | 1 |
| Zach | 1,1,2,3,4,4,4,6,7,11,12,12,13,14,15,16 | 5, 8, 9, 10 | 1, 4, 12 | 1 |

### The Stefan claim, corrected

**"Stefan has no first-round pick and no pick at all until round 13" is half
right and half false.**

- **TRUE:** Stefan is the only franchise in the league without a first-round
  pick. He traded it to Witte in trade #2 for Bijan Robinson; Witte flipped it
  to Zach in trade #6. It is the only first-round pick that moved all offseason.
- **FALSE:** his first owned pick is **his own second-round pick**. He then
  picks in rounds 2, 3, 4, 5, 5, 6, 7, 7, 9 and onward. He owns picks in
  **fourteen of the sixteen rounds** — the only two he is missing are 1 and 8.

**verified.** Correcting this is the entire point of the document: a blurb built
on "nothing until the 13th" would be caught inside a second.

**What selling the first *did* cost him is better than the myth anyway.** Josh
Allen prices at round 1 on Stefan's roster and Stefan owns no round-1 pick to
put him in — so he sold the pick that would have kept Josh Allen. He also cannot
keep Bijan Robinson, the player he bought it with, because Bijan occupied a
round-1 slot in 2025 and is barred outright. And owning no round-8 pick makes
**nine further players** on his roster structurally unkeepable. **derived**

### The other extremes

- **Zach holds TWO first-round picks** — his own and Stefan's — plus three
  fourths, then **nothing at all between round 7 and round 11**.
- **Scott is the most front-loaded:** two thirds, two fourths, two sixths, and
  nothing in rounds 12, 13 or 16. He bought the top of the draft with the bottom
  of it.
- **Witte is the most lopsided:** three round-8 picks, and nothing in rounds 5,
  7, 9 or 10. He is a party to six of the twelve logged trades plus a seventh
  that never made the log.
- **Kyle traded five picks away and lost track in real time.** In the 2024
  draft, at 10.93: *"Oh fuck I traded my tenth"* Kyle. He is missing rounds 2, 8
  and 12 this year.

**derived**

---

## Zach's fire sale: he sold the team, but he is not short of picks

**Verdict: he ended up with better picks and worse players.**

| Out | In |
|---|---|
| De'Von Achane → Witte (#6) | Luke Musgrave |
| Tyler Warren → Kyle (#8) | Cade Otton |
| Kimani Vidal + A.J. Brown → Colin (#12) | Ladd McConkey |
| Own R5, R6, R8, R9, R10 | Stefan's R1, Colin's R4, Kyle's R4, Kyle's R6, Kyle's R12 |

Five picks out, five in — still exactly 16. **He converted the middle of his
draft into the top of it**, at the price of every pick between rounds 8 and 10.

**The humiliating detail:** he traded De'Von Achane and received Luke Musgrave,
and traded Tyler Warren and received Cade Otton. Achane is now Witte's keeper at
round 8 and Tyler Warren was available to Kyle as a round-7 keeper. He sold two
of the best assets in the league for two tight ends nobody kept.

**The redeeming detail:** trade #12 brought him Ladd McConkey, whom he is
keeping at round 6.

**And Kyle called it two years early.** From the 2024 draft, at 5.44, after Zach
took Aaron Jones: *"He's going to trade all of these guys to us next year for
more picks"* Kyle. **verified**

---

## The keeper counterfactual: who could have kept whom

Cost rounds come from `data/keeper-eligibility-2026.json`'s `roundToKeep2026`
column, which implements the league rule — last season's round minus one, or
round 9 for a free-agent acquisition. **Nothing here was hand-derived.** A
player pricing to round 0 is barred outright by the round-1 ruling.

**A player is only actually keepable if his franchise also owns a pick in the
cost round.** Several do not, and that is where the good material is.

**Two league-wide findings, both of which cut against the obvious joke:**

1. **Nobody in the league kept a player at a round-1 price**, even where one was
   legal and cheap — James Cook was available to Joe at a first, Lamar Jackson
   to Greg at a first, Josh Jacobs to Kyle, A.J. Brown and Davante Adams to
   Colin, Tee Higgins to Elbe.
2. **Nobody kept anyone at an obviously bad price either.** The worst value on
   the board is +4 picks, which is still a bargain. **If a blurb needs a "bad
   keeper", the honest framing is opportunity cost — what they passed up — not
   overpayment.** **derived**

### Joe, specifically

**Joe had SIXTEEN keepable players and used one slot.**

| Player | Position | Cost |
|---|---|---|
| James Cook | RB | **1** |
| Drake London | WR | **2** |
| Marvin Harrison Jr | WR | **2** |
| TreVeyon Henderson | RB | **2** |
| D'Andre Swift | RB | 3 |
| Jakobi Meyers | WR | 5 |
| Travis Kelce | TE | 6 |
| Brenton Strange, Caleb Williams, Calvin Austin, Colts D/ST, Falcons D/ST, Jared Goff, Keenan Allen, Tre Tucker | — | 8 each |
| **Jayden Daniels** | **QB** | **9 — the one he kept** |

**Three players at a round-2 price, and he kept a quarterback at a ninth.**
Nothing was blocking him: he owns a pick in every round he would have needed,
round 2 included. Saquon Barkley was his only round-1-barred player.

**The extra twist:** he acquired TreVeyon Henderson and Keenan Allen from Witte
in trade #7 *this offseason*, and kept neither. **derived**

### The rest, in brief

- **Greg** declined **Lamar Jackson at a first**, Jaylen Waddle at a fourth and
  George Kittle at a fifth, and kept the two least valuable keepers on the board.
  Derrick Henry and Jonathan Taylor were round-1 barred.
- **Kyle** declined **Josh Jacobs at a first** and **Tyler Warren at a seventh**
  — a player he had just traded for — and spent both slots on players he must
  release in five months.
- **Elbe** had **two players priced at round 7**, Javonte Williams and Stefon
  Diggs, and owns exactly one round-7 pick, so he could not have kept both. He
  also traded for Patrick Mahomes days before the draft and then declined to
  keep him at a tenth. Zay Flowers was keepable at a fourth except that Elbe
  traded his fourth away.
- **Colin** declined **A.J. Brown, Davante Adams and Omarion Hampton at a first
  apiece**, Alvin Kamara at a second and DK Metcalf at a third. Chris Olave and
  David Montgomery priced at a sixth, which he no longer owns.
- **Josh** could not have kept DeVonta Smith at a fourth — he traded his fourth
  to Scott. Ja'Marr Chase's clock expired.
- **Witte** could not have kept Jordan Addison (no fifth) or Brian Thomas Jr (no
  seventh).
- **Zach** owns no round-8 pick, which made **eleven** of his players
  structurally unkeepable.
- **Scott** is the only manager with **nothing barred and nothing expired** —
  all seventeen rostered players were technically keepable. He declined Terry
  McLaurin at a second and Tetairoa McMillan at a third.

**derived**

---

## Draft history

**Coverage:** draft-result sheets exist for 2017, 2018, 2019, 2020, 2021, 2023,
2024 and 2025. **2016 and 2022 are missing**, and the 2022 gap is load-bearing
for one of the running jokes.

### The running jokes, checked

**Amari Rodgers — CONFIRMED, with a round and a pick number.** Joe Murray
drafted Amari Rodgers in **round 15, pick 141 of 160, of the 2021 draft**.

And the heckle is *in the workbook*. Three seasons later, at pick **2.16** of the
2024 draft, the Comments column records: *"Where is Amari Rodgers playing?"
Colin to Joe.* **verified** (The league's own spreadsheet preserves the joke
still running three years on.)

Joe also drafted **Aaron** Rodgers himself, in 2019, round 5, pick 48.

**Elbe reached for Lamar Jackson and called him a good PPR quarterback.** The
Colin has stated both halves: the player **is** Lamar, and the line is one
of the dumbest things anyone has ever said in this league, because **PPR has no
merit on a quarterback.** That is the joke, it is his, and a recap comment about
Elbe failing to nab a PPR QB will get laughs.

The 2024 banter proves the room is still running it at him:

- At **3.27**, when Joe took Kelce: *"Hey elbe, good pick." Stefan "He's
  especially good in PPR leagues" Stefan to Elbe* — and Elbe's reply, which
  dates the original incident: *"Come on guys that was a couple years ago, now."*
- At **11.05**: *"Not a bad pick Elbe. You have a PPR QB and some good WRs"
  Stefan.*

**No draft sheet in this repo shows Scott Elbe drafting Lamar Jackson, ever.**
Lamar's recorded drafters are Josh Grainger (2019 R11 p107, 2020 R10 p93), Scott
Johnston (2021 R5 p43), Kyle Mertens (2023 R4 p33), Zach (2024 R2 p20) and Greg
Blome (2025 R2 p12). "A couple years" before 2024 lands on **2022 — the one
draft whose result sheet is missing.** In 2022 Lamar was Scott Johnston's keeper,
which is why the *sheet* still cannot corroborate the pick even though the
commissioner has named the player.

**Name the player. Quote the line. Never state a year or a round.** **verified**
(ruling) / **unverified** (date)

**Gary Barnidge — not in the data at all.** He appears nowhere in this
repository: no draft sheet, no keeper list, no roster, no trade log, no
document. The workbook starts in 2016 and his notable season was 2015, which is
the likely explanation. The joke is real per `src/lib/league-lore.ts` and works
as a comparison — "the Gary Barnidge of this draft" — but **no year, round,
manager or team can be attached to it.** **unverified**

### Players who cannot stay put

**Stefon Diggs is the most-traded man in league history: eight different
franchises.** Josh Grainger (2017 R4.5 p35) → Scott Elbe (2018 R2 p18) → Joe
Murray (2019 keeper list) → Greg Blome (2019 R3 p21) → Zach (2020 R4 p40, 2021
R3 p27) → Witte (2023 R1 p5, 2024 R3 p26) → Kyle Mertens (2025 R8 p75) → **Scott
Elbe again**, arriving by trade and priced at a seventh for 2026. He has
completed a full circle back to Elbe, eight years later. **verified**

**Lamar Jackson: six franchises in seven recorded drafts**, rising roughly a
round a year, and nobody manages to hold him.

**Javonte Williams:** Zach (2021 R4) → Elbe (2023 R5) → Stefan (2024 R5) → Elbe
(2025 R8) → Elbe's round-7 keeper now.

### Picks that aged badly

- **Colin took Tyreek Hill THIRD OVERALL in 2024**, spent round 7 confirming it
  — *"I GOT TYREEK HILL ON MY SQUAD" Colin confident* — and one comment later
  said *"I hate my team. They are all old."* Joe then took Tyreek in round 2 of
  2025. **He is now on nobody's roster in this league.** **verified**
- Of every pick made in the first three rounds of the 2024 draft, **four have
  vanished from the league entirely**: Tyreek Hill (Colin, 1.03), Cooper Kupp
  (Josh, 2.14), Rachaad White (Colin, 3.23) and Mark Andrews (Stefan, 3.30).
  Colin owns two of the four. **derived**
- **Scott Johnston took Travis Kelce at pick 4 overall in 2023** — a tight end,
  top four. **verified**
- **Witte drafted Patrick Mahomes with the very last pick of the 2018 draft —
  16.160** — the season Mahomes threw 50 touchdowns and won MVP. He took Mahomes
  again in 2019 (R15), 2020 (R14) and 2024 (R4). **verified**

### Positional patterns, across seven drafts

**Kyle Mertens waits longer on a quarterback than anyone alive.** First QB by
year: **2018 R13, 2019 R13, 2020 R15, 2021 R8, 2023 R4, 2024 R13, 2025 R13** —
five of seven at round 13 or later. He does the same at tight end (2021 R14,
2023 R13, 2024 R14).

**And the 2024 draft caught him doing both at once, live:**

- **11.109** — *"Why are you people taking backup QBs now?" Kyle, pissed because
  he hasn't taken a QB*
- **11.110** — *"Kyle, who's your QB and TE" Greg. "TBD" Kyle*
- **13.123** — *"Kyle, you still don't have a QB or a TE?" Stefan. "Same as 5
  rounds ago, yeah" Kyle*
- **13.124** — he takes Jordan Love: *"Jordan Love in the 13th round is amazing
  value" Kyle … "That might have been the best pick of the draft" Kyle.* Joe's
  contribution: *"You bitch."*
- **15.141** — Joe on the finished quarterback room: *"Love and Williams…you have
  two of the fruitiest QBs in the league."*

**verified / derived**

**Witte** was historically the last man to a quarterback and it kept working
(2018 R16, 2019 R15, 2020 R14 — all Mahomes). **Joe** buys tight ends early and
quarterbacks last: TE in round 3 or 4 in 2018, 2024 and 2025; QB in round 16 in
2024. **Stefan** is Kyle's opposite, taking Josh Allen in round 2 in both 2023
and 2025.

### The 2024 banter column

The 2024 draft sheet carries **107 verbatim entries** of live draft-room banter
in a Comments column. It is the richest source of league voice in the repo.
**Cite the pick number when using a line.**

How loud each man is, by mentions: **Colin 65, Stefan 58, Kyle 47, Joe 45, Elbe
33, Greg 20, Witte 11, Scott 7, Josh 5, Zach 4.**

A selection:

| Pick | |
|---|---|
| 1.10 | *[Joe goes to get beer] "Oh yeah, you don't have a pick next round" Elbe to Joe; Joe, "Yeah, Zach fleeced me"* |
| 2.11 | *"Those are reaches brotha" Colin to Stefan; "They aren't reaches because they won't be there when I pick next" Stefan* |
| 2.15 | *"Witte, nice keeper in the 2nd round" Stefan; "Are you keeping him next year?" GG; "Witte, are you shitting?" collective* |
| 3.26 | *"They're all dog shit. I need a RB." Colin; "You don't need to, it's a PPR league." Stefan* |
| 3.30 | *"I don't want him" Stefan; "He won you a title last year, show some respect" Kyle to Stefan* |
| 6.51 | *[Complaints about draft board] "Then you host the draft party, bro!" Stefan; "Then you make the pizza rolls, bro" Greg, mocking Stefan* |
| 10.92 | *"I wasn't happy with where I was drafting. But when you win the ship you don't get to pick where you draft" Stefan* |
| 11.110 | *"This draft board is really hard to follow. Can you put a counter on how many times I've said that?" Kyle* |
| 12.115 | *"Is he even in the top 300?" Stefan; "Darnell Mooney really is the worst pick of the draft." Kyle; "I'm not even going to mark that off"* |
| 16.160 | *Draft ends at 10:27 pm* |

**verified.** (Kyle's complaint at 11.110 is worth noting for its own sake: this
app exists partly because the old board defeated him repeatedly on draft night.)

---

## Odds and ends worth knowing

- **The draft order is a slot auction, not a standings assignment.** The team
  that finished last chooses first and takes *whichever slot it wants*; the
  champion chooses last. Colin finished 3rd and chose the **10th** slot, because
  slot 10 owns the turn — picks 10 and 11 back to back. The order is therefore
  **not derivable from standings even in principle.** **verified**
- **2025 standings, top three, derived from that mechanic:** Colin chose before
  Greg, who chose before Stefan, and Colin says he finished 3rd — so **Stefan
  won, Greg was 2nd, Colin 3rd**. Corroborated for an earlier season by two 2024
  banter lines putting a title on Stefan for 2023. **The other seven finishing
  positions are nowhere in this repo — do not invent a standings table.**
  **inferred**
- **Stefan has won this league three times.** He texted Colin on draft day
  asking for the recap to know it — *"make sure the AI knows I'm the only 3 time
  champion in the league"* — and Colin stated the count flatly: *"He has won 3x
  I'm telling you it's the case."* The count is a fact and a blurb may state it
  flat. **Which three seasons is not recorded, and *only* is his word rather
  than the league's** — no other franchise's title count exists anywhere in this
  repo. Kyle Mertens has not been asked, so this is testimony from a ten-year
  member and not a commissioner ruling. **verified** (Colin's word)
- **The league's keeper rules exist in writing in exactly one place: the
  recitals of a private contract between two managers.** This app reads its
  rules out of that document. **verified**
- **ESPN has had the keeper feature switched off for at least five straight
  seasons**, and structurally cannot represent a keeper clock at all. **verified**
- **Passing touchdowns are worth six points here, not the ESPN default of
  four** — identical in 2022 through 2026. Any ranking built on 4-point passing
  TDs understates quarterbacks for this league. **verified**
- **No kickers.** The kicker lineup slot is 0 *and* the kicker roster limit is
  0, so none can be rostered — though ESPN still carries inert kicker scoring
  values. **verified**
- **A convention change in the 2026 keeper sheet silently repriced 75 free
  agents by a round** — earlier sheets wrote the string `FA` and priced at R9;
  the 2026 sheet wrote the number `9` and the minus-one formula turned it into
  R8. It changed exactly one real keeper, Colston Loveland, ruled back to R9.
  **verified**
- **Ten managers each held a round-1 player going into 2026 and not one declared
  him.** The round-1 ineligibility ruling codified existing practice rather than
  introducing a rule. **verified**
- **A round-2 keeper now gets one keeper season instead of two** — an accident
  of two rules colliding that nobody chose and nobody has ever been affected by.
  The commissioner declined to rule on it. **verified**
- **Kyle Mertens' `Trade Log` is confirmed to omit at least one real trade** —
  the Stefan/Witte round-4 swap. His own ruling: *"Yes they swapped 4s — Kyle
  missed it on his trade log. SmartDraft is right."* **verified**
- **There is a broken external link in the workbook** pointing at a file on a law
  firm's network share, with cached sheet names `DHB Sandmen`, `BChen Overall`,
  `BChen QB`, `BChen TE`. That was the league's old rankings source. **verified**
- **Three former members appear in pre-2019 sheets and are gone:** Andy Seibert,
  Josh Schaefer, Chad McCann. **verified**
- **In the 2020 draft sheet Stefan's name is typed two ways** — `Stefan` and
  `Sefan` — so the workbook briefly contains eleven managers. **verified**
- **Nobody in this league is a committed fan of any single NFL team**, so jokes
  about somebody stacking their favourite franchise do not land. **verified**

---

## Unverified — needs Colin

**Nothing in this section may be stated as fact in a blurb.**

1. **Which Scott is "Scottie" the scribe.** Colin has said it is Scott
   **Johnston**. Nothing in the repository establishes it. The only physical
   artefact of a scribe is the 107-entry Comments column in the 2024 draft
   sheet, and that sheet sits inside *Kyle Mertens'* workbook, so the file does
   not establish authorship. The one piece of circumstantial support is that
   Scott Johnston is quoted **seven** times in his own record — among the
   quietest men in a very loud room, which is what a man typing would look like.
   **Confirm before any blurb has him reading notes back**, because a note read
   back to the wrong Scott, in a room containing both Scotts, is the exact
   failure this document exists to prevent.
2. **Which year and round Elbe reached for Lamar Jackson.** The player and the
   line are **settled** — see above. The date is not. No sheet shows the pick,
   and his own 2024 remark dates it to "a couple years" earlier. **Do not invent
   a round.**
3. **Gary Barnidge.** Not in the repository at all. Who picked him up, and
   roughly when?
4. **Whether anyone performed the Friday injury check on Puka Nacua.** The
   contingent leg was conditioned on it and `DECISIONS.md` explicitly asks for
   the check. No source verifies it. **Do not build a joke on Nacua's 2026
   health.**
5. **Final standings for 2025 beyond the top three.** Derived, not recorded.
6. **The outcome of the $25 side bet** from the 2024 draft — Colin to Stefan,
   Rhamondre Stevenson to outscore Javonte Williams, *"Accepted $25"*. The bet is
   recorded verbatim; who paid is not.
7. **Whether Kyle Mertens ever expressed a view on the Johnston/Blome agreement
   at the time.** No approval, ratification, objection or veto appears anywhere.
   Absence of a record is not a record of absence. Did the league discuss it in
   November 2025, and did anyone besides Colin object?
8. **Joe Murray's profession.** Deliberately not recorded.
9. **Which three seasons Stefan's titles were, and everybody else's title
   count.** His count is **settled** and is not in question here — see *Odds and
   ends* — but the years are not recorded. Soft support exists for 2023 (two 2024
   banter lines putting a *"ship"* on him) and 2025 (the slot-auction
   derivation); the third is nowhere. No other franchise has a recorded finish in
   any season beyond the derived 2025 top three, and this app has never read the
   league's real history, so **the silence in these files says nothing about
   anybody's trophies.** State the three titles, never a year for one, never a
   count for another manager.

---

## Keeping this document honest

The derived numbers here — pick inventories, the keeper bargain table, the
keeper counterfactual, the manager roster — are computed from the board and the
player pool, and **they go stale the moment a trade lands or a declaration
changes.** That is the exact failure this repo has been bitten by before, which
is why no figure above is left to be trusted on sight.

```
npm run verify:history
```

recomputes every derived number in `data/league-history.json` from the live
sources and fails loudly on any drift, naming the entry. Run it before the recap
is generated. The narrative facts — quotations, contract terms, dates — are not
machine-checkable and carry their source inline instead.
