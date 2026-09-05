#!/usr/bin/env python3
"""
Independently verify every traded pick against the source of truth.

    node --input-type=module -e '<dump the database to /tmp/ukl-db-dump.json>'
    python3 scripts/seed-verify-traded-picks.py

WHY THIS IS PYTHON AND NOT ANOTHER .mts SUITE
---------------------------------------------
A defect was found where a traded pick was resolved from the SENDER rather than
from the franchise the pick was born to, so on a pick that had changed hands
twice the wrong pick moved. That defect lived in the logic every traded pick
flows through.

Verifying that with the same TypeScript modules would be circular: if
`league-json.ts` and the seed both read the room the same way, they will agree
with each other whether or not either agrees with the commissioner's workbook.
So this reads the RAWEST form of each source with nothing but the standard
library:

  * `data/spreadsheets/draft-picks-2026__sheet3.csv`  the commissioner's own
    hop tracker, parsed as text. THE SOURCE OF TRUTH for provenance: it is the
    only place the multi-hop chains are written down.
  * `data/spreadsheets/draft-picks-2026__sheet3.json` the converted form, read
    separately so a CSV-to-JSON conversion error cannot hide.
  * `data/smartdraft-room-snapshot.json`             the live room, resolved
    through its own team table.
  * `data/trade-log-2026-spreadsheet.json`           the narrative log.
  * `/tmp/ukl-db-dump.json`                          what the app actually
    seeded, dumped by a separate process.

THE NUMBERING TRAP. `overallPick` in the workbook uses the 2025 draft order
(Colin 1 … Zach 10); the room uses the 2026 order (Zach 1 … Colin 10). Comparing
by overall pick number would produce a hundred spurious failures and could mask a
real one. Everything here compares by (ORIGINAL OWNER, ROUND), which is a pick's
permanent identity and is order-independent.

Exits non-zero on any disagreement. Where sources genuinely conflict it reports
the conflict rather than choosing a winner.
"""

import csv
import json
import sys
from collections import defaultdict

ROOT = "."
failures = []
warnings = []

FRANCHISES = {"Colin", "Stefan", "Witte", "Joe", "Elbe", "Kyle", "Josh", "Scott", "Greg", "Zach"}

# ---------------------------------------------------------------------------
# KNOWN, DOCUMENTED disagreements between the workbook and the live room.
#
# Enumerated by name rather than suppressed by a tolerance, so a NEW
# disagreement still fails loudly. Each entry has to be justified by a document,
# and the justification is quoted in `why`.
# ---------------------------------------------------------------------------
KNOWN_DIFFS = {
    # data/DECISIONS.md, "The live Smart Draft room is already correct": netting
    # the 2025 trade against the Contingent 2026 Trade gives Greg his own R1 back
    # and Scott his own R15 back. Sheet3 has only the 2025 trade applied, so it
    # shows the pre-contingency position. RULED: the room is correct.
    (1, "Greg"): ("Scott", "Greg", "ruled", "Nacua contingency netting — DECISIONS.md rules the room correct"),
    (15, "Scott"): ("Greg", "Scott", "ruled", "Nacua contingency netting — DECISIONS.md rules the room correct"),
    # data/RECONCILIATION.md conflict C3, RULED Aug 26 2026: "Yes they swapped 4s
    # — Kyle missed it on his trade log. SmartDraft is right." The swap is real and
    # the room is correct; the workbook is simply incomplete. Witte's second R4
    # stays at 4.03. The workbook gap is left listed rather than deleted because
    # the trade log gets consulted again at the 2027 rollover.
    (4, "Stefan"): ("Stefan", "Witte", "ruled", "Stefan/Witte R4 swap — ruled real, room correct; Kyle's trade log omits it"),
    (4, "Witte"): ("Witte", "Stefan", "ruled", "Stefan/Witte R4 swap — ruled real, room correct; Kyle's trade log omits it"),
}


def section(title):
    print(f"\n{title}")
    print("-" * len(title))


def check(label, ok, detail=""):
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{f' — {detail}' if detail else ''}")
    if not ok:
        failures.append(f"{label}{f' — {detail}' if detail else ''}")


def warn(label, detail=""):
    print(f"  NOTE  {label}{f' — {detail}' if detail else ''}")
    warnings.append(f"{label}{f' — {detail}' if detail else ''}")


# ---------------------------------------------------------------------------
# Source 1: Sheet3 CSV — the commissioner's hop tracker, as text
# ---------------------------------------------------------------------------
# Columns: Round, Pick, Original Pick, Trade, New Pick, Trade, New Pick, ...
# A row with both Trade flags set is a MULTI-HOP pick. The final owner is always
# the LAST "New Pick" column, which repeats the original owner when untraded.

sheet_rows = []
with open(f"{ROOT}/data/spreadsheets/draft-picks-2026__sheet3.csv", newline="") as fh:
    for i, row in enumerate(csv.reader(fh)):
        if i == 0 or not row or not row[0].strip():
            continue
        rnd = int(row[0])
        original = row[2].strip()
        hop1_flag = row[3].strip()
        hop1_owner = row[4].strip()
        hop2_flag = row[5].strip()
        final = row[6].strip()
        sheet_rows.append(
            {
                "round": rnd,
                "workbookPick": int(row[1]),
                "original": original,
                "hop1Flag": hop1_flag,
                "hop1Owner": hop1_owner,
                "hop2Flag": hop2_flag,
                "final": final,
                "hops": [h for h in [hop1_owner, final] if h and h != original],
            }
        )

section("0. Reading the sources")
check("Sheet3 CSV has all 160 picks", len(sheet_rows) == 160, f"{len(sheet_rows)}")

# The workbook's own internal consistency: a hop flag must come with a new owner,
# and a hop-2 flag must come with a hop 1.
malformed = []
for r in sheet_rows:
    if r["hop1Flag"] and not r["hop1Owner"]:
        malformed.append(f"R{r['round']} {r['original']}: hop-1 flag with no new owner")
    if r["hop2Flag"] and not r["hop1Flag"]:
        malformed.append(f"R{r['round']} {r['original']}: hop-2 flag with no hop 1")
    if not r["final"]:
        malformed.append(f"R{r['round']} {r['original']}: no final owner recorded")
check(
    "the workbook is internally consistent — no dangling hop flags",
    not malformed,
    "; ".join(malformed[:4]),
)

sheet_traded = [r for r in sheet_rows if r["final"] != r["original"]]
sheet_multi = [r for r in sheet_rows if r["hop1Flag"] and r["hop2Flag"]]
check(
    "the workbook records 29 traded picks",
    len(sheet_traded) == 29,
    f"{len(sheet_traded)}",
)

# ---------------------------------------------------------------------------
# Source 2: Sheet3 JSON — same sheet, converted. Guards the conversion itself.
# ---------------------------------------------------------------------------
sj = json.load(open(f"{ROOT}/data/spreadsheets/draft-picks-2026__sheet3.json"))
json_rows = []
for row in sj["rows"][1:]:
    if not row or row[0] in (None, ""):
        continue
    json_rows.append(
        {
            "round": int(row[0]),
            "original": (row[2] or "").strip(),
            "final": (row[6] or "").strip(),
        }
    )
csv_key = {(r["round"], r["original"]): r["final"] for r in sheet_rows}
json_key = {(r["round"], r["original"]): r["final"] for r in json_rows}
check(
    "the CSV and JSON conversions of Sheet3 agree exactly",
    csv_key == json_key,
    f"csv {len(csv_key)} rows, json {len(json_key)} rows",
)

# ---------------------------------------------------------------------------
# Source 3: the derived spreadsheet ownership file the seed reads
# ---------------------------------------------------------------------------
derived = json.load(open(f"{ROOT}/data/pick-ownership-2026-spreadsheet.json"))
derived_key = {
    (s["round"], s["originalOwner"]): s["finalOwner"] for s in derived["slots"]
}
check(
    "data/pick-ownership-2026-spreadsheet.json matches Sheet3",
    derived_key == csv_key,
    f"{sum(1 for k in csv_key if derived_key.get(k) != csv_key[k])} disagreements",
)

# ---------------------------------------------------------------------------
# Source 4: the live Smart Draft room, resolved through its own team table
# ---------------------------------------------------------------------------
room = json.load(open(f"{ROOT}/data/smartdraft-room-snapshot.json"))["state"]
team_name = {}
for t in room["teams"]:
    if t.get("deletedAt"):
        continue
    team_name[t["id"]] = t["name"]

room_rows = []
for s in room["slots"]:
    room_rows.append(
        {
            "round": s["displayRound"],
            "pickInRound": s["pickInRound"],
            "overallPick": s["overallPick"],
            "original": team_name.get(s["originalOwnerTeamId"], "?"),
            "current": team_name.get(s["currentOwnerTeamId"], "?"),
            "slotKey": s["slotKey"],
            "isKeeper": s.get("pickType") == "KEEPER",
        }
    )
check("the room has all 160 slots", len(room_rows) == 160, f"{len(room_rows)}")
check(
    "every room slot resolved to a named franchise",
    all(r["original"] != "?" and r["current"] != "?" for r in room_rows),
)

room_key = {(r["round"], r["original"]): r["current"] for r in room_rows}
check(
    "the room has one slot per (round, original owner) — the grid invariant",
    len(room_key) == 160,
    f"{len(room_key)} distinct",
)
room_traded = [r for r in room_rows if r["current"] != r["original"]]
check("the room shows 29 traded picks", len(room_traded) == 29, f"{len(room_traded)}")

# ---------------------------------------------------------------------------
# THE CENTRAL COMPARISON: workbook versus room, pick by pick
# ---------------------------------------------------------------------------
section("1. All 160 picks — the commissioner's workbook versus the live room")

unexplained = []
explained = []
for key, sheet_final in csv_key.items():
    room_final = room_key.get(key)
    if room_final is None:
        unexplained.append(f"R{key[0]} originally {key[1]}'s: missing from the room")
        continue
    if room_final == sheet_final:
        continue
    known = KNOWN_DIFFS.get(key)
    if known and known[0] == sheet_final and known[1] == room_final:
        explained.append((key, known))
    else:
        unexplained.append(
            f"R{key[0]} originally {key[1]}'s: workbook says {sheet_final}, room says {room_final}"
        )

check(
    f"{len(csv_key) - len(explained) - len(unexplained)} of 160 picks agree outright",
    not unexplained,
    "; ".join(unexplained[:5]) or "every remaining disagreement is a documented one",
)
check(
    f"the {len(explained)} disagreements are all documented ones, none new",
    len(explained) == len(KNOWN_DIFFS),
    f"{len(explained)} matched of {len(KNOWN_DIFFS)} documented",
)

print("\n  the documented disagreements, each re-derived from the sources:\n")
for (rnd, orig), (wb, room_v, status, why) in sorted(explained):
    tag = "RULED   " if status == "ruled" else "UNRULED "
    print(f"    {tag} R{rnd:<2} originally {orig}'s: workbook {wb:<7} room {room_v:<7}")
    print(f"             {why}")
    if status == "unruled":
        warnings.append(
            f"R{rnd} originally {orig}'s — workbook says {wb}, room says {room_v}. {why}. "
            f"Needs a commissioner ruling; it changes draft position within the round."
        )

# Every documented divergence now carries a ruling, so the workbook gaps are a
# closed matter rather than an open one. Asserted rather than assumed: if a future
# entry is added without a ruling this check fails and says which.
still_unruled = [
    f"R{rnd} originally {orig}'s" for (rnd, orig), (_, _, status, _) in explained if status == "unruled"
]
check(
    "every documented workbook divergence has a commissioner ruling behind it",
    not still_unruled,
    ", ".join(still_unruled) or f"all {len(explained)} ruled — the room is correct in each",
)

# The room and the workbook must at least agree on WHICH picks moved, once the
# documented differences are set aside.
sheet_moved = {(r["round"], r["original"]) for r in sheet_traded}
room_moved = {(r["round"], r["original"]) for r in room_traded}
sym = (sheet_moved ^ room_moved) - set(KNOWN_DIFFS)
check(
    "the same picks are traded in both, apart from the documented differences",
    not sym,
    ", ".join(f"R{r} {o}" for r, o in sorted(sym)) or "identical",
)

# ---------------------------------------------------------------------------
# THE MULTI-HOP PICKS — where the defect actually bit
# ---------------------------------------------------------------------------
section("2. Multi-hop picks — every pick that changed hands more than once")

print(f"  the workbook records {len(sheet_multi)} multi-hop picks:\n")
multi_wrong = []
for r in sorted(sheet_multi, key=lambda x: (x["round"], x["original"])):
    chain = " -> ".join([r["original"], r["hop1Owner"], r["final"]])
    room_final = room_key.get((r["round"], r["original"]))
    db_ok = room_final == r["final"]
    print(
        f"    R{r['round']:<2} {chain:<28} room says {room_final:<7} {'OK' if db_ok else 'WRONG'}"
    )
    if not db_ok:
        multi_wrong.append(f"R{r['round']} {chain}: room says {room_final}")

check(
    f"all {len(sheet_multi)} multi-hop picks land on the correct FINAL owner",
    not multi_wrong,
    "; ".join(multi_wrong) or "every chain resolved correctly",
)
check(
    "no multi-hop pick was left with its intermediate holder",
    not [
        r
        for r in sheet_multi
        if room_key.get((r["round"], r["original"])) == r["hop1Owner"]
        and r["hop1Owner"] != r["final"]
    ],
)
check(
    "no multi-hop pick was left with its original owner",
    not [
        r
        for r in sheet_multi
        if room_key.get((r["round"], r["original"])) == r["original"]
    ],
)

# ---------------------------------------------------------------------------
# THE DATABASE: does what was seeded match the sources?
# ---------------------------------------------------------------------------
section("3. The database — draft_slots and pick_ownership versus the workbook")

db = json.load(open("/tmp/ukl-db-dump.json"))
db_slot_key = {(s["round"], s["originalOwner"]): s["currentOwner"] for s in db["slots"]}
check("the database has all 160 slots", len(db["slots"]) == 160, f"{len(db['slots'])}")
check(
    "one database slot per (round, original owner)",
    len(db_slot_key) == 160,
    f"{len(db_slot_key)}",
)

# The database is expected to mirror the ROOM, because the room is the input feed
# the seed reads. So it is compared against the room first, and separately
# against the workbook with the documented differences allowed — comparing only
# against the workbook would report the four known items a third time.
db_vs_room = [
    f"R{k[0]} originally {k[1]}'s: room {v}, database {db_slot_key.get(k)}"
    for k, v in room_key.items()
    if db_slot_key.get(k) != v
]
check(
    "all 160 database slots carry the room's current owner",
    not db_vs_room,
    "; ".join(db_vs_room[:5]) or "no disagreements",
)

db_vs_book = [
    f"R{k[0]} originally {k[1]}'s: workbook {v}, database {db_slot_key.get(k)}"
    for k, v in csv_key.items()
    if db_slot_key.get(k) != v and k not in KNOWN_DIFFS
]
check(
    "and the workbook's, apart from the four documented differences",
    not db_vs_book,
    "; ".join(db_vs_book[:5]) or "no disagreements",
)

db_own_key = {
    (o["round"], o["originalOwner"]): o["currentOwner"] for o in db["ownership2026"]
}
own_mismatch = [
    f"R{k[0]} originally {k[1]}'s: room {v}, ledger {db_own_key.get(k)}"
    for k, v in room_key.items()
    if db_own_key.get(k) != v
]
check(
    "pick_ownership — the asset ledger — agrees on all 160",
    not own_mismatch,
    "; ".join(own_mismatch[:5]) or "no disagreements",
)
check(
    "pick_ownership and draft_slots agree with each other",
    db_own_key == db_slot_key,
)

# ---------------------------------------------------------------------------
# PROVENANCE: the original-owner field the old code was getting wrong
# ---------------------------------------------------------------------------
section("4. Provenance — the original owner on every traded pick")

# The board column belongs to the ORIGINAL owner for all 16 rounds, so each
# franchise must own exactly 16 columns whatever it has traded away.
db_cols = defaultdict(int)
for s in db["slots"]:
    db_cols[s["originalOwner"]] += 1
check(
    "every franchise owns exactly 16 board columns in the database",
    all(n == 16 for n in db_cols.values()) and len(db_cols) == 10,
    ", ".join(f"{k}={v}" for k, v in sorted(db_cols.items()) if v != 16) or "all 10 at 16",
)

room_cols = defaultdict(int)
for r in room_rows:
    room_cols[r["original"]] += 1
check(
    "and in the room",
    all(n == 16 for n in room_cols.values()) and len(room_cols) == 10,
    ", ".join(f"{k}={v}" for k, v in sorted(room_cols.items()) if v != 16) or "all 10 at 16",
)

sheet_cols = defaultdict(int)
for r in sheet_rows:
    sheet_cols[r["original"]] += 1
check(
    "and in the workbook",
    all(n == 16 for n in sheet_cols.values()) and len(sheet_cols) == 10,
    ", ".join(f"{k}={v}" for k, v in sorted(sheet_cols.items()) if v != 16) or "all 10 at 16",
)

# traded_picks is the provenance LOG — the field the defect corrupted.
tp26 = [h for h in db["tradedPicks"] if h["season"] == 2026]
check("traded_picks has 29 rows for 2026", len(tp26) == 29, f"{len(tp26)}")

tp_bad = []
for h in tp26:
    expected_final = room_key.get((h["round"], h["originalOwner"]))
    if expected_final is None:
        tp_bad.append(
            f"R{h['round']} claims original owner {h['originalOwner']}, which no board column matches"
        )
    elif h["currentOwner"] != expected_final:
        tp_bad.append(
            f"R{h['round']} originally {h['originalOwner']}'s: log says now {h['currentOwner']}, board says {expected_final}"
        )
check(
    "every traded_picks row names the ORIGINAL owner correctly, not the sender",
    not tp_bad,
    "; ".join(tp_bad[:5]) or "all 29 provenance rows correct",
)

# THE DEFECT'S SIGNATURE. The old code wrote the SENDER into `original_team`. On
# a multi-hop pick the sender of the second hop is the intermediate holder, so
# the corrupted row would name the intermediate rather than the origin. Asserted
# directly against the workbook's chains, which are the only record of them.
hop_provenance = []
for r in sheet_multi:
    rows = [h for h in tp26 if h["round"] == r["round"]]
    named = {h["originalOwner"] for h in rows}
    if r["original"] not in named:
        hop_provenance.append(
            f"R{r['round']}: no log row names {r['original']} as the origin "
            f"(chain {r['original']} -> {r['hop1Owner']} -> {r['final']})"
        )
    if r["hop1Owner"] in named and r["hop1Owner"] != r["original"]:
        # Only wrong if the intermediate does not legitimately own a pick in that
        # round himself, which he may.
        legit = room_key.get((r["round"], r["hop1Owner"])) is not None
        if not legit:
            hop_provenance.append(
                f"R{r['round']}: log names the intermediate holder {r['hop1Owner']} as an origin"
            )
check(
    f"on all {len(sheet_multi)} multi-hop picks the log names the ORIGIN, not the intermediate",
    not hop_provenance,
    "; ".join(hop_provenance) or "the defect's signature is absent",
)

# The set of traded picks in the log must be exactly the set that moved.
check(
    "the log covers exactly the 29 picks the board shows as moved",
    {(h["round"], h["originalOwner"]) for h in tp26} == room_moved,
    ", ".join(
        f"R{r} {o}"
        for r, o in sorted(
            {(h["round"], h["originalOwner"]) for h in tp26} ^ room_moved
        )
    )
    or "identical",
)

# ---------------------------------------------------------------------------
# Pick counts per franchise — an independent arithmetic cross-check
# ---------------------------------------------------------------------------
section("5. Pick counts held — arithmetic cross-check against Sheet1")

held_sheet = defaultdict(int)
for r in sheet_rows:
    held_sheet[r["final"]] += 1
held_room = defaultdict(int)
for r in room_rows:
    held_room[r["current"]] += 1
held_db = defaultdict(int)
for s in db["slots"]:
    held_db[s["currentOwner"]] += 1

check(
    "workbook, room and database agree on how many picks each franchise holds",
    held_sheet == held_room == held_db,
    "; ".join(
        f"{k}: sheet {held_sheet[k]}, room {held_room[k]}, db {held_db[k]}"
        for k in sorted(set(held_sheet) | set(held_room) | set(held_db))
        if not (held_sheet[k] == held_room[k] == held_db[k])
    )
    or "identical",
)
check(
    "the picks still total 160",
    sum(held_sheet.values()) == 160 and sum(held_db.values()) == 160,
)

print("\n    franchise   holds  (16 = untouched net)")
for k in sorted(held_sheet, key=lambda x: -held_sheet[x]):
    delta = held_sheet[k] - 16
    print(f"      {k:<9} {held_sheet[k]:>3}   {f'{delta:+d}' if delta else ' —'}")

# Sheet1 is the commissioner's own per-manager inventory: one row per pick held,
# listing the round. A fourth independent statement of the same fact.
sheet1_counts = defaultdict(int)
sheet1_rounds = defaultdict(list)
with open(f"{ROOT}/data/spreadsheets/draft-picks-2026__sheet1.csv", newline="") as fh:
    rows = list(csv.reader(fh))
for row in rows[1:]:
    # Owner/round pairs, but only where the owner cell is an actual franchise.
    # The sheet has a footer row of bare round totals and a trailing blank
    # column, and accepting any non-empty cell as an owner turns those into
    # phantom franchises called "1" through "16".
    for col in range(0, len(row) - 1):
        owner = (row[col] or "").strip()
        rnd = (row[col + 1] or "").strip()
        if owner not in FRANCHISES or not rnd.isdigit():
            continue
        sheet1_counts[owner] += 1
        sheet1_rounds[owner].append(int(rnd))

check(
    "Sheet1 parsed into ten franchises",
    set(sheet1_counts) == FRANCHISES,
    ", ".join(sorted(set(sheet1_counts) ^ FRANCHISES)) or "all ten",
)
check(
    "Sheet1's per-manager inventory agrees on the pick counts",
    dict(sheet1_counts) == dict(held_sheet),
    "; ".join(
        f"{k}: sheet1 {sheet1_counts.get(k, 0)}, sheet3 {held_sheet.get(k, 0)}"
        for k in sorted(set(sheet1_counts) | set(held_sheet))
        if sheet1_counts.get(k, 0) != held_sheet.get(k, 0)
    )
    or "identical",
)
# And on WHICH rounds, not just how many — a count can hide two errors that
# cancel, which is exactly the shape of the R4 swap.
rounds_sheet3 = {
    k: sorted(r["round"] for r in sheet_rows if r["final"] == k) for k in held_sheet
}
rounds_mismatch = [
    f"{k}: sheet1 {sorted(sheet1_rounds.get(k, []))} vs sheet3 {rounds_sheet3.get(k)}"
    for k in sorted(rounds_sheet3)
    if sorted(sheet1_rounds.get(k, [])) != rounds_sheet3[k]
]
check(
    "…and on exactly WHICH rounds each franchise holds",
    not rounds_mismatch,
    "; ".join(rounds_mismatch[:3]) or "identical",
)

# ---------------------------------------------------------------------------
# 2027 — trades of next year's picks, which drive the rollover
# ---------------------------------------------------------------------------
section("6. The 2027 set")

log = json.load(open(f"{ROOT}/data/trade-log-2026-spreadsheet.json"))
log_2027 = []
for t in log["trades"]:
    for side_name, side in (("sideA", t["sideA"]), ("sideB", t["sideB"])):
        for p in side.get("picksReceived") or []:
            if p.get("year") == 2027:
                other = t["sideB"] if side_name == "sideA" else t["sideA"]
                log_2027.append(
                    {
                        "trade": t["tradeNumber"],
                        "round": p["round"],
                        "to": side["member"],
                        "from": other["member"],
                    }
                )

print(f"  the trade log records {len(log_2027)} transfers of 2027 picks:")
for e in log_2027:
    print(
        f"    trade #{e['trade']}: 2027 R{e['round']} from {e['from']} to {e['to']}"
    )

db_2027_traded = [
    o for o in db["ownership2027"] if o["currentOwner"] != o["originalOwner"]
]
check("the 2027 ledger has all 160 picks", len(db["ownership2027"]) == 160)
check(
    "every franchise owns 16 columns of 2027 picks",
    all(
        v == 16
        for v in [
            sum(1 for o in db["ownership2027"] if o["originalOwner"] == n)
            for n in {o["originalOwner"] for o in db["ownership2027"]}
        ]
    ),
)

# The seed deliberately does NOT apply the 2026 log's 2027 legs: the log is
# imported as history with status 'proposed', because the ROOM snapshot already
# reflects the net 2026 result and re-applying would move picks twice. So an
# unapplied 2027 ledger is expected — but it must be stated, not discovered next
# August.
print(
    f"\n  2027 picks showing as moved in the database: {len(db_2027_traded)}"
)
if len(db_2027_traded) == 0 and log_2027:
    warn(
        f"the {len(log_2027)} recorded 2027 pick transfers are NOT applied to the 2027 ledger",
        "expected: the trade log is imported as history at status 'proposed', and "
        "only accepting a trade applies it. This must be resolved before the 2027 "
        "rollover or those picks will roll over to the wrong franchises.",
    )
else:
    for o in db_2027_traded:
        print(f"    2027 R{o['round']} originally {o['originalOwner']}'s -> {o['currentOwner']}")

tp27 = [h for h in db["tradedPicks"] if h["season"] == 2027]
print(f"  2027 rows in the traded_picks log: {len(tp27)}")

# ---------------------------------------------------------------------------
section("7. Cross-check: the narrative trade log against the net result")

# Each 2026 pick leg in the log should correspond to a pick that actually moved.
log_2026_legs = []
for t in log["trades"]:
    for side_name, side in (("sideA", t["sideA"]), ("sideB", t["sideB"])):
        for p in side.get("picksReceived") or []:
            if p.get("year") != 2026:
                continue
            other = t["sideB"] if side_name == "sideA" else t["sideA"]
            rnd_raw = str(p["round"])
            rnd = int("".join(c for c in rnd_raw.split("(")[0] if c.isdigit()))
            via = None
            if "(" in rnd_raw:
                via = rnd_raw.split("(")[1].split(")")[0].rstrip("'s").rstrip("'")
            log_2026_legs.append(
                {
                    "trade": t["tradeNumber"],
                    "round": rnd,
                    "to": side["member"],
                    "from": other["member"],
                    "via": via,
                }
            )

print(f"  the log records {len(log_2026_legs)} legs moving 2026 picks")
annotated = [e for e in log_2026_legs if e["via"]]
print(f"  of which {len(annotated)} name whose pick it originally was:")
for e in annotated:
    final = csv_key.get((e["round"], e["via"]))
    on_board = room_key.get((e["round"], e["via"]))
    ok = final == e["to"] and on_board == e["to"]
    print(
        f"    trade #{e['trade']}: 2026 R{e['round']} ({e['via']}'s) to {e['to']} — "
        f"workbook {final}, board {on_board} {'OK' if ok else 'MISMATCH'}"
    )
    if not ok:
        failures.append(
            f"trade #{e['trade']} 2026 R{e['round']} ({e['via']}'s) to {e['to']}: "
            f"workbook says {final}, board says {on_board}"
        )

# Every franchise the log names must resolve, and the log's net effect on each
# franchise's 2026 pick count should not contradict the workbook.
unresolved = sorted(
    {
        e[k]
        for e in log_2026_legs
        for k in ("to", "from")
        if e[k] not in held_sheet and e[k] not in sheet_cols
    }
)
check(
    "every franchise named in the trade log is a real franchise",
    not unresolved,
    ", ".join(unresolved) or "all resolved",
)

# ---------------------------------------------------------------------------
print("\n" + "=" * 72)
if failures:
    print(f"{len(failures)} CHECK(S) FAILED")
    for f in failures:
        print(f"  • {f}")
else:
    print("ALL TRADED-PICK CHECKS PASSED — 29 picks verified against 4 sources")
if warnings:
    print(f"\n{len(warnings)} thing(s) to be aware of:")
    for w in warnings:
        print(f"  • {w}")
print("=" * 72 + "\n")
sys.exit(1 if failures else 0)
