# Design brief — Ultimate Keeper League

## What it is

A private web app for a **10-team keeper fantasy football league** in its 2026
season. It is the league's single source of truth: rules, keeper declarations,
trades, and the live draft. Ten managers use it, on desktop and phone. It is not
a marketing site and has no signup flow — everyone who opens it is already in
the league and already knows what it is.

Two very different modes of use, and the design has to serve both:

1. **Reference**, all year — someone checks a rule, a keeper's cost, who owns
   which pick. Usually one person on a laptop or a phone.
2. **Draft night**, once a year — the board projected on a TV in a room, read by
   ten people at once from across that room, while the commissioner enters picks
   as they're called out loud.

## Look and feel

Yours. I'm giving you the league crest — pull the palette from it, and make the
calls on type, spacing, density, elevation, motion, light or dark. You're the
designer here; I'm only specifying things below where a real constraint forces
it, and I've tried to give you the underlying fact rather than my conclusion
about what to do with it.

## Pages needed

| Page | What it does |
| --- | --- |
| **Dashboard** | Landing. Crest, where we are in the league calendar, links into everything below. |
| **Draft Room** | The big one. See below. |
| **Draft Board (projector)** | Same board, navigation stripped, sized for a TV. |
| **Draft recap / export** | Print-friendly list of every pick, for after the draft. |
| **Keepers** | Every declared keeper and what he costs. |
| **Trades** | Log of completed trades, plus which picks have changed hands. |
| **Teams** | All ten franchises as a grid. |
| **Team detail** | One franchise: roster, keepers, picks owned, picks traded away. |
| **Players** | Searchable, filterable player pool with consensus rankings. |
| **Governance** | Rule motions moving through proposed → seconded → voted → ratified. |
| **Scoring** | Static reference table of league scoring settings. |
| **Calendar** | Recurring windows: keeper lock, board publish, waivers, trade deadline. |
| **Preseason checklist** | Commissioner to-do list before the draft. |

## The draft board — where the real constraints are

**16 rounds × 10 franchises = 160 cells, and the whole grid has to fit on one
screen with no scrolling.** Everything below follows from that plus the fact
that it's being read from across a room.

Columns are franchises, rows are rounds. It's a snake draft, so pick order
reverses every other round.

Cell states that have to be distinguishable at that viewing distance:

- **Empty** — not yet picked
- **Filled** — a normal completed pick
- **On the clock** — exactly one cell ever, and it has to be unmissable
- **Keeper** — locked before the draft, cannot be changed
- **Traded pick** — this slot belongs to a franchise other than the column owner

A cell can be **both keeper and traded**, so those two treatments have to
compose rather than conflict.

### Three requirements for the cell

**1. Every position needs its own color.** Five positions — **QB, RB, WR, TE,
DST**, no kickers. All five have to be tellable apart instantly and from a
distance, so five separate colors rather than shades of one. Position is how the
board gets read at a glance.

**2. No truncated text anywhere in the grid.** Every cell shows the **full
player name** — not an initial, not an ellipsis — plus position, plus keeper or
traded markers. Cells have to be sized so the longest realistic name fits at a
size readable across a room. Real worst cases to design against:
`Christian McCaffrey`, `Marvin Harrison Jr.`, `Amon-Ra St. Brown`,
`Brian Thomas Jr.` Two lines for a name is fine if that's what makes it fit.

For context on the space available: on a 1080p TV at full screen, after a
franchise header row, an on-the-clock bar and a thin footer, each cell is
roughly **180 × 50 px**.

The current build fails this — it abbreviates `Jahmyr Gibbs` to `J. Gibbs` and
truncates whatever still doesn't fit. That's the main thing I'm asking you to
replace. If something has to give to make full names work, it isn't the names.

**3. Ownership has to be unambiguous in every cell.** A cell's column is the
franchise that *originally* held the pick, and its row is the round. So when a
pick has been traded, the player drafted there belongs to a franchise other than
the one named at the top of that column. A keeper also sits in its cost round
rather than where that team would otherwise be picking. Kept and traded picks
therefore end up offset from where you'd look for them.

Today, scanning a column, it reads like the player went to the team at the top
of that column — which is wrong, and is the kind of confusion that starts an
argument on draft night. **"Which franchise got this player?" has to be
answerable from the cell itself**, without tracing up the column or hovering for
a tooltip. Currently that's carried by a border tint, which isn't enough. The
mechanism is yours, up to and including rethinking what the columns represent.

### The rest of the Draft Room

Around the grid:

- **On-the-clock bar** — whose pick, round and slot, pick number out of 160, and
  that franchise's positional needs.
- **Pick entry** — a player search box that keeps focus and takes it back after
  every pick. It's used continuously for two hours, so it's the primary control
  on the page rather than a form field.
- **Undo** — a button plus ⌘Z. Mistakes happen when picks are shouted. It takes
  back the pick entered *last*.
- **Delete one pick** — the correction for a mistake noticed late, which undo
  cannot reach without throwing away every good pick made since. Arrow the cursor
  onto any cell and press Delete, or right-click it. Both name the player and the
  franchise before anything is removed.
- **Upcoming picks strip** — the next several slots, so the room knows who's up.
- **Roster panel** — what the on-the-clock team already has, starters vs. bench,
  and which positions are full.
- A **live indicator** — the board updates in real time for anyone following
  along on their phone.

## Data worth designing around

A few things here have real shape, and generic table rows flatten them:

- **Keeper cost.** A keeper gets one draft round cheaper each consecutive
  season, so a cost is really a transition: a basis round becoming a current
  round, e.g. R7 → R6. Two keepers per franchise, max two consecutive keeper
  seasons, so keepers also **expire**.
- **A traded pick** always has two franchises attached, an original owner and a
  current one, and both have to stay visible — that's the attribution problem
  above. It shows up on the board, on team pages, and in the trade log, and
  should read as the same object in all three.
- **A motion** on the Governance page has a vote tally and a status from a fixed
  set: proposed, seconded, ratified, rejected.
- **Positional needs** are a compact summary of what a roster is missing, read
  mid-draft under time pressure.

## Components to design once

I'll apply these across all thirteen pages, so they matter more than any
individual screen:

- App shell — persistent sidebar on desktop, and how it collapses on mobile
- Page header — eyebrow, title, description, right-aligned badges
- Card / panel surface
- Table row, including a two-line variant (player name over team and cost)
- Stat — a large number with a label
- Status badge — the fixed vocabulary above
- Position chip — QB/RB/WR/TE/DST
- Button — primary, secondary, ghost, destructive, plus a small icon-only size
- Search / combobox, with results list
- Empty state and loading state, both of which show up on most pages
- **Locked state** — after the keeper deadline much of the app goes read-only,
  and that should be visible

## Mobile

Design the phone view for one scenario: a manager glancing at something during
the draft. The one-screen rule is a **projector** rule, not a phone rule — on a
phone the board can scroll freely. No truncation still holds: scrolling is an
acceptable trade, abbreviating a name isn't. Most of the effort is better spent
on the dashboard, keepers, and team detail.

## Handing it back

I'll pick the design up from Figma over MCP, so a few things make that cleaner:
name frames after the page they map to (the bold names in the table above), keep
components as real Figma components with variants rather than detached copies,
and use named color and type styles rather than raw values. Auto-layout wherever
it makes sense — it tells me what's meant to be fluid versus fixed, which is
otherwise the thing I'd have to guess at.
