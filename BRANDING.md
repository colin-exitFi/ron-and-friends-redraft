# Branding & design tokens

The Figma design has landed. The semantic token layer now points at the
**design palette** (`--ds-*` in `globals.css`), read off the Figma frames — the
design ships no Figma variables, so those values were taken from the frames
themselves and converted to oklch. The original crest sampling is kept as the
`--brand-*` ramp for the record; nothing consumes it directly any more.

See `DESIGN-BRIEF.md` for what the design was asked to solve.

## Where things live

| Thing                                   | Path                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------- |
| All design tokens                       | `src/app/globals.css` (the block at the top)                               |
| Type stack                              | `src/app/layout.tsx`                                                       |
| Shared primitives                       | `src/components/ui/` — `card`, `button`, `badge`, `input`, `table`, `stat` |
| Sidebar / shell                         | `src/components/app-shell.tsx`                                             |
| Page title block                        | `src/components/page-header.tsx`                                           |
| Logo assets                             | `public/brand/`                                                            |
| Favicon / App Router icons              | `src/app/favicon.ico`, `src/app/icon.png`, `src/app/apple-icon.png`        |
| Position colours (deliberate exception) | `src/lib/positions.ts`                                                     |

## Logo assets

| File                            | Size     | Use                                    |
| ------------------------------- | -------- | -------------------------------------- |
| `public/brand/crest-v2.png`     | 928×1024 | Dashboard hero (and the print/TV master) |
| `public/brand/crest-v2-512.png` | 464×512  | Spare (OG image, print)                |
| `public/brand/crest-v2-256.png` | 232×256  | Sidebar, mobile header, board chrome   |
| `src/app/icon.png`              | 512²     | App Router icon                        |
| `src/app/apple-icon.png`        | 180²     | iOS home screen                        |
| `src/app/favicon.ico`           | 16/32/48 | Browser tab                            |

**The crest is portrait, not square: 1190×1322 as supplied, ~0.906:1.** The
`public/brand/` exports keep that ratio and are sized by their _long_ edge, so
`-512` means 512 tall. The three app icons are square because their consumers
assume square, and the crest is centred inside with transparent slack.

Every render site puts the crest in a square box with `object-contain`, which
letterboxes rather than distorts. **The boxes are square on purpose** — the
masthead title, the sidebar wordmark and the two board bars are all positioned
off that width, and narrowing the box to the artwork would move them. Where the
size comes from the `width`/`height` props alone rather than a CSS box (the
sidebar and mobile header), the props carry the true ratio so nothing is
stretched.

The supplied artwork already has a clean alpha channel — it needed only a trim
to its opaque bounding box, so the black-matte flood fill described for the
previous crest no longer applies.

### The small-size problem

The crest is a detailed shield — a doghouse, a violin and bow, stars, a football
and two lines of type — and below roughly 32px it stops resolving detail and
reads only as silhouette and colour. It is used in the sidebar (36px), the mobile
header (28px), the live and final board bars (~26–34px on a 1080p TV), the
dashboard masthead (146–224px) and the app icons. At the small sizes it reads as
a dark shield with a cyan rim, which is enough to be recognisable.

**`favicon.ico` is cropped, the others are not.** The favicon frames come from a
square crop off the top of the artwork, dropping the thin point below the
football; that buys about 10% of apparent size at 16px, where a portrait crest
letterboxed into a square tile is otherwise noticeably smaller than the tile. At
48px the wordmark is readable, at 32px the doghouse and the wordmark band are
discernible, and at 16px it is silhouette only.

If anything needs to go smaller than 16px, reintroduce a simplified mark rather
than scaling the crest further.

### One note on the palette sections below

The token commentary further down this file, and in `src/app/globals.css`,
describes the crest as orange and navy and calls it the one asset sitting outside
the zinc-and-cyan skin. That was true of the previous crest. **This one was drawn
to the existing palette** — near-black charcoal with electric cyan — so the
tension those notes describe is gone. The tokens themselves were deliberately
left alone: they are the record of where the skin came from, and nothing about
the swap requires them to move.

## Type

Three faces, all from `next/font/google`, wired in `src/app/layout.tsx` and
exposed to Tailwind as `--font-sans`, `--font-mono` and `--font-heading`:

| Face               | Token                             | Role                                                                                              |
| ------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Inter**          | `--font-sans`                     | Everything by default. Body, labels, page titles, card titles.                                    |
| **Space Grotesk**  | `--font-heading` (`font-display`) | The wordmark, and the dashboard's hero title and stat values.                                     |
| **JetBrains Mono** | `--font-mono` (`text-eyebrow`)    | Small letterspaced labels — page eyebrows, stat labels, table column heads — and tabular figures. |

This replaced Geist + Saira Condensed. Two consequences worth knowing:

- **`font-display` is not a general heading face.** Ordinary page titles and card
  titles are Inter with weight. The display face is reserved for the wordmark and
  for the dashboard's two hero registers (the 30px league title and the 26px stat
  values), which is where the design uses it. Applying it to a routine heading
  makes that heading read as a second wordmark.
- **`text-eyebrow` switched from the display face to mono** and from `0.22em` to
  `0.12em` tracking, matching the design's 10px/1.2px eyebrow.

## Geometry

Two radii carry everything, and the scale is tuned to land on them:

| Utility                   | Value | Used by                                    |
| ------------------------- | ----- | ------------------------------------------ |
| `rounded-lg` (`--radius`) | 10px  | Cards, panels, inputs, selects, stat tiles |
| `rounded-sm`              | 5px   | Badges, buttons, chips, board cells        |

`--radius` moved `0.5rem → 0.625rem` with the Zinc + Electric Cyan reskin, whose
reference frames sit noticeably rounder than the previous design's 8px/4px.
Everything else in the `--radius-sm…4xl` scale is derived from that one value, so
it is the whole knob — put it back to `0.5rem` for the old geometry.

Anything that wants a pill should say so explicitly; the badge is a rectangle,
not a pill.

## Tokens

Three layers. Components consume the **semantic** layer only.

### 0. Design palette — "Zinc + Electric Cyan"

What the semantic layer points at today. Linear / Vercel lineage: a neutral zinc
greyscale carrying the whole UI with one saturated cyan doing all the accent
work. This replaced a warm orange / navy reading of the crest — see _Reskin
history_ below for what moved and why.

| Token            | hex       | on `--background` | Role                                                                                            |
| ---------------- | --------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| `--ds-canvas`    | `#09090b` | —                 | Page canvas _and_ sidebar — the rail is separated by a hairline, not a step in lightness         |
| `--ds-surface`   | `#18181b` | —                 | Cards, panels, board cells, secondary buttons                                                    |
| `--ds-elevated`  | `#27272a` | —                 | Hover, popovers, dropdowns                                                                       |
| `--ds-border`    | `#3f3f46` | 1.9:1             | Hairlines, input edges                                                                           |
| `--ds-text`      | `#fafafa` | 19.1:1            | Body text                                                                                        |
| `--ds-text-sec`  | `#a1a1aa` | 7.8:1             | Captions, secondary text                                                                         |
| `--ds-muted`     | `#52525b` | 2.6:1             | Decorative grey only: sidebar section headings, disabled. Below AA — never use for real text     |
| `--ds-cyan`      | `#06b6d4` | 8.2:1             | The accent and the live cell — **and nothing else**. A fixed point of the position solve          |
| `--ds-cyan-hover`| `#0ea5e9` | 7.2:1             | Accent hover — shifts bluer rather than just dimming                                             |
| `--ds-pink`      | `#fc19a9` | 5.5:1             | The QB hue — coral pink `#f472b6`, saturated                                                      |
| `--ds-blue`      | `#1187fc` | 5.6:1             | The RB hue — soft blue `#60a5fa`, saturated; also info                                            |
| `--ds-mint`      | `#1fdf75` | 11.2:1            | The WR hue — mint green `#4ade80`, saturated then weighted down for frequency                     |
| `--ds-amber`     | `#edb41a` | 10.6:1            | The TE hue — amber `#fbbf24`; **also `--warning`**, one token on purpose — see below              |
| `--ds-lavender`  | `#b25cfc` | 5.5:1             | The DST hue — lavender `#c084fc`, saturated                                                       |
| `--ds-green`     | `#10b981` | 7.8:1             | Success, votes for, the steal ring. A fixed point of the position solve                          |
| `--ds-red`       | `#ef4444` | 5.3:1             | Errors, votes against, the reach ring. A fixed point of the position solve                       |

Three things about this set are worth knowing:

- **Nothing here is invented, and the gap is on purpose.** The palette left
  ownership (traded picks) with no colour, and every hue that could have covered
  it is either claimed or too near something claimed to survive a glance. So
  `--trade` marks ownership with **lightness instead of hue** and this table
  needs no sixteenth entry. See _Draft-board colour logic_.
- **The five position hues are fixed by the design; only their saturation was
  ours.** The design locked QB coral pink `#f472b6`, RB soft blue `#60a5fa`, WR
  mint green `#4ade80`, TE amber `#fbbf24`, DST lavender `#c084fc`. It shipped
  them at pastel saturation, and that was the one thing wrong with it. The values
  above are those exact hues with chroma pushed to the gamut wall — not one hue
  moved by a degree. See _Position colours_ for the measurements.
- **`--ds-amber` is deliberately shared between TE and `--warning`.** Kept apart
  they sat 14.3° from each other (TE 84.4°, warning 70.1°) — closer than any two
  positions, which is the exact defect the `--keeper` note complains about. The
  amber band is too narrow to hold two values that mean different things, and
  these two never co-occur: amber is banned from the grid as a *status*, and TE is
  a position.
- **The greyscale has a gap and it is bridged with alpha, not a token.** There is
  nothing between `--ds-text-sec` (7.8:1) and `--ds-muted` (2.6:1), and 2.6:1 is
  below AA even for large text. Where a surface needs a step in between it dims
  `--muted-foreground` at the call site — the board's empty-cell pick labels are
  `text-muted-foreground/55`. A fourth token was tried and dropped: only one
  surface wanted it.

**Contrast note.** This used to be a caveat and is now a win. The old accent took
cream on orange at ~3.3:1, clearing AA for large text only. Cyan is a light hue
(L 0.715), so `--primary-foreground` is the **canvas knocked out of it** at
**8.2:1**, which clears AAA at any size. White on this accent would be 2.33:1 and
must never be used — the palette's own Primary button swatch shows dark-on-cyan
for the same reason.

The same flip applies to the five position hues. Every one of them is lighter
under this palette than its predecessor, and white loses on all five (WR 2.3:1,
TE 1.6:1, DST 2.6:1, and even the darkest two, QB and RB, only reach 3.3:1 and
3.5:1). `positionChipSolid` therefore knocks out `--background`, which runs
5.4:1 to 11.8:1.

### 1. Brand ramp — sampled from the crest artwork

| Token                   | oklch             | hex       | In the crest                     |
| ----------------------- | ----------------- | --------- | -------------------------------- |
| `--brand-cream`         | `0.955 0.019 80`  | `#f7efe2` | Banner and sunburst              |
| `--brand-orange`        | `0.657 0.216 37`  | `#f84e08` | Sunset                           |
| `--brand-orange-bright` | `0.702 0.196 42`  | `#fe6b24` | Sunset, lifted for dark UI       |
| `--brand-navy`          | `0.249 0.084 256` | `#002048` | Ring, mountains                  |
| `--brand-navy-deep`     | `0.209 0.07 256`  | `#001737` | Outer ring shadow                |
| `--brand-steel`         | `0.649 0.081 232` | `#5898b8` | Lake                             |
| `--brand-steel-bright`  | `0.72 0.105 232`  | `#58b0db` | Lake, lifted for dark UI         |
| `--brand-gold`          | `0.8 0.15 80`     | `#f0b135` | Between the orange and the cream |

The two `-bright` variants exist because the crest's own orange and steel are
tuned against cream, not against a near-black canvas, and fall short of WCAG AA
as small text on the app background.

**Nothing consumes this ramp.** It is kept purely as the record of the artwork's
real values. Since the Zinc + Electric Cyan reskin the design palette is not
derived from the crest at all, which is why `crest.png` is now the one asset that
does not sit inside the skin — see the note under the semantic table.

### 2. Semantic — what components use

| Token                            | Value                             | hex       | Consumed by                                                                             |
| -------------------------------- | --------------------------------- | --------- | --------------------------------------------------------------------------------------- |
| `--background`                   | `--ds-canvas`                     | `#09090b` | Page canvas                                                                             |
| `--foreground`                   | `--ds-text`                       | `#fafafa` | All body text                                                                           |
| `--card`                         | `--ds-surface`                    | `#18181b` | `Card`, panels                                                                          |
| `--popover`                      | `--ds-elevated`                   | `#27272a` | Command palette, dropdowns                                                              |
| `--secondary`                    | `--ds-surface`                    | `#18181b` | Secondary buttons                                                                       |
| `--muted` / `--muted-foreground` | `--ds-surface` / `--ds-text-sec`  | `#a1a1aa` | Empty cells, captions                                                                   |
| `--accent`                       | `--ds-elevated`                   | `#27272a` | Hover states                                                                            |
| `--primary`                      | `--ds-cyan`                       | `#06b6d4` | Buttons, active nav, eyebrows, stat numerals                                             |
| `--primary-foreground`           | `--ds-canvas`                     | `#09090b` | Text on primary — 8.2:1, see the contrast note above                                     |
| `--primary-hover`                | `--ds-cyan-hover`                 | `#0ea5e9` | Solid accent button and badge hover                                                     |
| `--border` / `--input`           | `--ds-border`                     | `#3f3f46` | Hairlines, input edges                                                                  |
| `--ring`                         | `--ds-cyan`                       | `#06b6d4` | Focus rings                                                                             |
| `--destructive`                  | `--ds-red`                        | `#ef4444` | Errors, "against" votes, **and the reach-vs-ADP ring on the final board**                 |
| `--success`                      | `--ds-green`                      | `#10b981` | Ratified, "for" votes, **and the steal-vs-ADP ring on the final board**                   |
| `--info`                         | `--ds-blue`                       | `#67a4fc` | Status "seconded"                                                                       |
| `--warning`                      | `--ds-amber`                      | `#f8a212` | Exceptional cautions off the grid. Same token as the TE hue — see above                   |
| `--keeper`                       | `--ds-text`                       | `#fafafa` | Keeper locks, kept players. Neutral: a keeper is not a position                          |
| `--trade`                        | `--ds-text`                       | `#fafafa` | The `→ owner` banner. Neutral, because hue means position — see Draft-board colour logic |
| `--live`                         | `--ds-cyan`                       | `#06b6d4` | On-the-clock cell — shares the accent, see Draft-board colour logic                      |
| `--board-base`                   | `--ds-canvas`                     | `#09090b` | **Every** surface on the board screen — cells, headers, round labels, bar, roster panel   |
| `--cell-qb…dst`                  | hue at 18% over `--board-base`    | —         | The five opaque board cell fills. One number tunes board contrast — see below             |
| `--sidebar*`                     | canvas + cyan set                 | `#09090b` | Rail and mobile sheet                                                                   |
| `--sidebar-section`              | `--ds-muted`                      | `#52525b` | Sidebar group headings — deliberately below AA, this is structure not text               |
| `--radius`                       | `0.625rem`                        | —         | Base of the `--radius-sm…4xl` scale; see Geometry                                        |
| `--shadow-raised`                | inset highlight + drop            | —         | `surface-raised` utility                                                                |
| `--shadow-glow-live`             | double cyan glow                  | —         | `glow-live` utility                                                                     |
| `--shadow-glow-brand`            | **neutral** white halo            | —         | `glow-brand` utility — neutral on purpose, see below                                    |
| `--shadow-glow-cta`              | soft cyan halo                    | —         | `glow-cta` utility                                                                      |
| `--shadow-crest`                 | `drop-shadow()` list, **no hue**  | —         | `crest-lift` utility — neutral on purpose, see below                                    |
| `--wash-primary` / `--wash-cool` | 7% cyan / 14% neutral             | —         | Page canvas, page headers, hero                                                         |
| `--grid-line` / `--grid-size`    | 3.2% white / 40px                 | —         | The micro-grid, `bg-canvas` and `bg-grid`                                                |
| `--primary-a10/32/45/60`         | cyan at fixed alphas              | —         | Glows, selection                                                                        |

**The two glows behind the crest are deliberately neutral.** `--shadow-crest` and
`--shadow-glow-brand` sit directly behind `crest.png`, and the crest artwork is
still orange and navy. A cyan bloom behind an orange mark is a complementary
clash at the exact centre of the dashboard masthead, so both are white light at
low alpha — depth without hue. The stacked blurs in `src/app/page.tsx` are
`bg-white/12` and `bg-white/10` for the same reason. **This is the one place the
skin does not sit inside the palette**, and it is a live tension: the crest is
the only asset that is not zinc-and-cyan. If the crest is ever reissued, these
three values are the ones that can go back to the accent.

`--primary-aNN` are written out longhand because Lightning CSS cannot yet
downlevel `oklch(from …)` relative colour syntax. **If you change `--primary`,
change these four to match.**

### Utilities

Defined at the bottom of `globals.css`, all driven by the tokens above:
`font-display`, `text-eyebrow`, `text-accent-gradient`, `surface-raised`,
`bg-field`, `bg-canvas`, `bg-grid`, `glow-live`, `glow-brand`, `glow-cta`,
`crest-lift`, `bg-wash-primary`, `bg-wash-hero`, `bg-wash-accent`,
`select-chevron`.

`crest-lift` sets `filter`, not `box-shadow`, because the crest is a transparent
PNG and the shadow has to follow the artwork rather than its bounding box.

`select-chevron` draws the arrow for native `<select>`. It is a utility rather
than an arbitrary Tailwind background value because the inline SVG contains
spaces, which cannot survive a utility class name — that failed silently the
first time and the selects simply had no arrow.

`glow-live` was previously `glow-accent` (an acid-green holdover from the
source app). Renamed for what it means rather than what colour it was. The new
CTA halo is therefore `glow-cta`, not `glow-accent` — reusing the retired name
would make old references look current.

## The page canvas

The micro-grid and the ambient washes are **not** a header treatment. They are the
surface the whole app sits on: `body` wears `bg-canvas`, so every page has them
without opting in.

`bg-canvas` is five background layers — the two grid rules over three washes:
cyan at top-left, neutral at top-right, neutral again at bottom-right. Three
things about it are deliberate:

- **Every layer is `background-attachment: fixed`**, so the texture reads as a
  surface the content slides over rather than a pattern that scrolls past. It
  also means a long page cannot run out of texture.
- **The grid is listed first, so it paints on top of the washes** and catches the
  ambient light instead of being buried under it.
- **The anchor at bottom-right** exists so a scrolled or card-heavy page still has
  ambient light in frame. With only the top-left wash, everything below the fold
  was flat.

**Exactly one wash is cyan, and it is weaker than the orange it replaced** (7% vs
9%). Cyan at L 0.715 carries much further on a near-black ground than orange at
L 0.628 did on a navy one, and scarcity is the point — "premium cyan highlights"
stops being a highlight if the whole page is lit with it. The bottom-right anchor
used to be a second accent bloom and is now the neutral for the same reason.

`--wash-cool` is also genuinely neutral now (chroma 0.008). It used to be navy at
chroma 0.06, which made sense when the canvas was navy and would now be the only
warm-cool tension left on an otherwise achromatic surface.

`--grid-line` and `--grid-size` are defined once and shared with `bg-grid` (the
grid without the washes), so no surface can drift to a different texture.

Cards are opaque and therefore cover the canvas — that is the intended reading:
panels are solid objects on a textured surface. Where a panel is a large table it
is often `bg-card/40` already (players, governance), and the grid shows through
it. Both readings are fine; what is not fine is a panel inventing its own grid.

**The board deliberately does not have it.** The three board overlays — live
(`draft-board.tsx`), recap (`final-board.tsx`) and mock (`mock-draft.tsx`) — are
`fixed inset-0` and opaque, so they cover the body entirely, and they carry flat
`bg-background` rather than `bg-canvas`.

They used to redraw the canvas to match the rest of the app. That stopped making
sense once the board's cells became opaque at the same value as the canvas: the
texture then only showed through the ~5px seams between cells, which read as
faintly lit gaps in the grid rather than as a surface underneath it. The ambient
washes were also putting a cyan gradient behind an actual 160-cell grid, which is
decoration competing with data. The board is an instrument, so it gets no
texture. See _The board runs deeper_ below.

`bg-canvas` is therefore a utility purely so `body` can wear it via `@layer base`
— nothing else consumes it.

### Where the accent shows up

Beyond the canvas washes, the accent is added in exactly three places, all
token-driven:

| Where                       | Treatment                                                                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page header band            | A second `bg-wash-primary` over the canvas one, so the masthead lifts off the body                                                                                                                                          |
| Full-size accent button     | `glow-cta`, growing on hover. Scoped to sizes `default` and `lg` by a cva compound variant — the accent fill is also how an active filter chip is drawn, and a row of glowing chips reads as four competing calls to action |
| `Stat` with `tone="accent"` | `bg-wash-accent` corner light and a `border-primary/25` edge, so the one number that matters most on a page stands out of the row without changing size                                                                     |

## The dashboard

Built to the design's Dashboard frame (`2:6`), which is an operations console
rather than the marketing-style hero the page used to be. Top to bottom: a header
band carrying the crest, a phase eyebrow and the league title; an alert bar naming
the one outstanding thing; four stat tiles; then a 3×3 command grid beside a
league-activity panel.

`src/lib/dashboard-view.ts` composes it from the real keeper and trade views, so
every number and every tile description is derived rather than written as copy.
Three decisions in there are load-bearing:

- **No invented timestamps.** The design's feed shows "20m ago". Keeper
  declarations and the trade log carry _no times at all_ — the log has only a
  trade number — so the right-hand slot shows whatever real ordering key exists
  (`Trade #12`) or nothing. Governance is the only table with real `created_at`,
  and it is not on this panel.
- **Most actionable first.** Awaiting declarations, then barred declarations, then
  provisional trades, then the settled log newest-first. Ordered purely by recency
  the twelve settled trades bury the one franchise that has not replied, which is
  the only reason to read the panel.
- **`DRAFT.date` is new.** The countdown and the keeper-declaration lock need a
  real date, and the page had been carrying `"Saturday, Aug 29"` as bare copy.
  2026-08-29 _is_ a Saturday, so `DRAFT.date` encodes what the app already
  asserted rather than inventing a new claim — but it is still marked
  `@placeholder` and wants confirming before the countdown is quoted to managers.

### Where the dashboard deviates

- **Radius.** The frame uses 2px on its cards while the design's own Card
  component says 8px. Rather than introduce a third radius on one page, the
  dashboard uses the documented 8px/4px system.
- **Grid, wash and crest glow are kept.** The frame's header band is flat ink.
  The micro-grid, the warm corner wash and the glow behind the crest are
  deliberate additions, at the commissioner's request. The grid now comes from
  the page canvas rather than this band — see "The page canvas" — so the header
  only adds its extra `bg-wash-hero`.
- **The crest is the masthead's subject.** The frame sets it as an icon beside the
  title; here it runs 116 → 148 → 176px, which is a compressed version of the old
  marketing hero's 256–352px rather than the frame's icon. It carries two stacked
  blurs (a wide one to lift it off the canvas, a tighter one to keep the heat
  behind the artwork) and `crest-lift`, a `filter: drop-shadow()` list — a
  box-shadow would shadow the bounding box rather than the transparent PNG's
  artwork. The 176px step and the 36px title are held to `xl`: between 1024 and
  1280 the crest, title and CTA share one line, and either at its full size is
  where "· 2026" breaks onto a line of its own.
- **No fabricated identity.** The frame's header CTA is "Declare your keepers"
  addressed to a signed-in manager. There are no accounts, so it reads "Review
  keeper list" — commissioner-facing, which is who actually uses this.

## The nav rail

The design draws the sidebar as a permanent 232px panel. It is instead a 64px
icon rail that expands to that 232px on hover or keyboard focus, because the
draft board is sized to the viewport and 232px of permanent chrome is 232px the
board does not get.

Three things make the expansion cheap:

- **It floats.** The `aside` in flow is only ever 64px; the panel inside is fixed
  and overlays the page, so nothing reflows on a mouse-over. It casts a shadow
  while open so it reads as above the page rather than part of it.
- **Nothing moves sideways.** Every row — brand, search, nav item, footer —
  starts with an icon slot exactly 64px wide (`ICON_SLOT`), so no glyph shifts
  between states. Only trailing text fades in (`REVEAL`).
- **It survives collapse.** The active item's 2px accent bar sits at the rail's
  left edge and is visible at icon width, so the current page is still
  identifiable. Group headings have no room for words, so each is replaced by a
  short centred rule — three groups still read as three groups. Every row carries
  a `title` for identification.

Hover alone would strand keyboard users, so the rail also opens on keyboard
focus; tabbing to a trailing control reveals it rather than moving focus through
invisible text. The width transition is dropped under `prefers-reduced-motion`.

### The rail does not scroll

Thirteen destinations across four sections wanted 582px, which put a scrollbar in
the rail on any window shorter than about 745px. It is the whole app's navigation
and should be one glance, so the space came back out of the padding rather than
being scrolled through: `gap-4` between sections instead of `gap-8` (four
sections meant three 32px gaps — 96px of pure air), a 4px heading margin, and
tighter brand and footer padding. That is 524px, which fits down to roughly a
680px window.

Below that the list still overflows, so it keeps `overflow-y-auto` with the
scrollbar hidden (`[scrollbar-width:none]`) — in a 64px rail a visible track is
worse than a wheel that quietly still works. The mobile sheet keeps its real
`ScrollArea`, where scrolling a long list is expected.

### One open condition, written in three places

The rail's width uses `hover:` and `has-[:focus-visible]:`. `REVEAL` and
`NavHeading`'s stand-in rule must use the matching `group-hover/rail:` and
`group-has-[:focus-visible]/rail:`. **These cannot be factored into a shared
constant** — Tailwind only generates classes it can find as literal text, so an
interpolated variant compiles to nothing at all.

They drifted apart exactly once, and the failure is worth recording because it is
invisible in the common case. The width opened on `has-[:focus-visible]` while
the text faded in on `focus-within`. A mouse click on a nav link leaves that link
focused but does _not_ match `:focus-visible`, so after clicking a nav item and
moving the pointer away the rail snapped back to 64px **with the labels and group
headings still at full opacity** — "LEAGUE" clipped by a rail too narrow to hold
it. It cleared itself the moment you clicked the page, because that dropped
focus, which is what made it look like a rendering glitch rather than a state
bug.

The mobile sheet renders the same components with `collapsible` off: full width,
real headings, no fade.

**The draft board covers the rail.** It is a `fixed inset-0` surface by design —
the board owns the screen. Navigation away from `/draft` is via the board's own
header, not the rail.

## Shared primitives

Restyled to the design, in `src/components/ui/`. Call sites did not change.

| Primitive | Shape                                                                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Card`    | 8px radius, 20px padding, opaque 1px border (was a translucent ring), 12px between children. Title is Inter Semi Bold 16, description 13/20 muted.                                                        |
| `Stat`    | **New.** Mono letterspaced label over a 28px bold tabular value, with an optional hint line. `tone` of `default \| warn \| accent`; `variant="display"` sets the value in the display face for hero rows. |
| `Badge`   | 4px rectangle, 10px bold, `0.05em` tracking. Added `success`, `info`, `warning`, `keeper`, `trade` alongside the shadcn set.                                                                              |
| `Button`  | 4px radius, semibold. `destructive` is solid rather than tinted; `ghost` is accent-coloured text. Default height 36px.                                                                                    |
| `Input`   | 8px radius, 40px tall, card fill, hairline border.                                                                                                                                                        |
| `Table`   | Column heads are mono/10px/uppercase/letterspaced muted; cells 13px with 12×10 padding.                                                                                                                   |

`Stat` exists because three places had independently hand-rolled the same
label-over-number tile. `keeper-board.tsx` keeps a local `StatCard` alias so its
call sites read unchanged. The dashboard used to hand-roll a fourth copy; it now
uses `Stat` with `variant="display"`.

### How a row of stats stays aligned

Tiles in a grid all take the height of the tallest, and `Stat` pins its parts to
opposite ends of that height — label to the top, value and hint to the bottom.
A label that wraps to two lines therefore eats slack in the middle of its own
tile instead of shoving its value below its neighbours'.

This was not academic. The dashboard's labels were "Season phase", "Keepers
declared", "Trades provisional / logged" and "Days until live draft"; below about
1100px the last two wrapped to two and three lines and the four numbers sat at
four different heights.

Two rules follow, and both are load-bearing:

- **Keep the shape.** A label of one or two short words, a value short enough
  never to wrap, and the qualifier in `hint`. Anything long that wants to live in
  the label ("provisional / logged") or the value ("2026 keeper", "3 days")
  belongs in the hint. `DashboardStat` requires `hint` for this reason.
- **A row is all-hint or no-hint.** Mixed tiles have two different bottom-block
  heights, and the values part company again.

The hint is held to one line (`truncate`) as a guard rail for the same reason.

### tailwind-merge and the `bg-*` utilities

`cn()` is an **extended** `twMerge` (`src/lib/utils.ts`), because every custom
`bg-*` utility here paints a `background-image` while tailwind-merge matches
`bg-<anything>` as a background _colour_. Left unconfigured it read
`bg-card bg-wash-accent` as one class fighting another and dropped `bg-card`, so
the accent stat tile rendered with a transparent fill. **Any new `bg-*` utility
must be added to the `bg-image` group there.**

### Badge casing

The design uppercases badge text, but it only ever showed a fixed status
vocabulary (`KEEPER`, `TRADED`, `LIVE`). This app also puts counts and
sentence-case labels in badges, so **casing is left to the call site**. Baking
`uppercase` into the severity variants was tried and reverted: it split matched
pairs, shouting `YEAR 2 OF 2 — FINAL SEASON` next to a quiet `Year 1 of 2` purely
because one was `destructive` and the other `secondary`.

## Draft-board colour logic

**The design inverted this.** A cell's fill is no longer its _state_ — it is its
**position**. Each completed cell is filled with its position hue and outlined in
the solid hue, which is what lets a column be read positionally from across a
room. State is layered on top as marks rather than as rival fills:

- **Keeper** → a lock glyph beside the position label. On a board cell the glyph
  takes the *position* hue, since it sits inside the position label; elsewhere it
  takes neutral `--keeper`. Either way the lock is a shape, not a colour.
- **Traded pick** → a **trade banner across the bottom edge of the cell**: a
  right arrow and the _current_ owner's name on a solid `--trade` bar, which is
  the one mark here carried by lightness rather than hue, because it is the one
  mark that is not a position. This
  replaced an earlier `VIA <abbrev>` badge, which nobody could read as ownership
  — the abbreviation meant nothing at a glance and it competed with the player
  name for the same corner. The banner is the Smart Draft convention and it works
  because it occupies an edge no other mark uses, so ~29 of them can coexist on
  one board without fighting the single live cell.
- **On the clock** → the one cell with no player content at all: a **solid**
  `--live` fill with `ACTIVE` knocked out of it, plus `glow-live`.

Because keeper and traded are marks on different parts of the cell, a keeper in
an acquired slot composes naturally — position fill, lock glyph, and bottom
banner all coexist.

**The banner is a row of the cell, not an overlay.** It began as an absolutely
positioned strip with a `pb` on the cell guessing its height, and that guess is
what kept it tiny: anything bigger sat on top of the player's name. As a flow
child the content simply takes the space that is left, which is what allowed the
type to roughly double.

### The board runs deeper than the rest of the app

**Nothing on the board screen uses `--card`.** Every surface on it — the 160
cells, the franchise headers, the round labels, the on-the-clock bar and the
roster panel — sits on `--board-base`, which is the canvas value itself. Panel
grey was doing two things wrong there:

- **Empty cells were the brightest field on the board.** A filled cell's fill was
  a translucent tint that composited down over the near-black canvas, while an
  empty cell sat opaque at `--card` (#18181b). So an un-drafted slot rendered
  _brighter_ than a completed pick, which is backwards — the eye was drawn to the
  parts of the board where nothing had happened.
- **The grey never separated anything.** Cells, headers, round labels and the
  roster panel were all the same #18181b, so it was not marking a hierarchy; it
  was just lifting the whole screen off black for no gain.

On one flat base, structure is carried by hairlines and type, and **the position
fills become the only lightness on the screen** — which is exactly what should be
drawing the eye at distance. Borders are at full strength (`--border`, 1.9:1 on
the base) because on a near-black field the hairline is the only thing drawing the
grid.

Floating overlays are excluded on purpose. The pick menu, the delete confirmation
and the keeper warning still use `--popover` / `--card`: those have to separate
_from_ the board rather than join it.

**The cell fills are opaque, mixed rather than layered.** `--cell-qb…dst` are
`color-mix(in oklch, <hue> 18%, var(--board-base))`, where they used to be
`bg-pos-*/[0.13]`. Two reasons:

1. A translucent fill samples whatever is behind it, so the same position read
   slightly differently depending on where the cell fell relative to the canvas
   washes. Flat fills mean QB looks like QB in all sixteen rounds.
2. Strength is one number in one place instead of a magic `/[0.13]` repeated
   across five class strings. **`--cell-*` is the knob for board contrast** —
   raise the percentage and the positions shout, lower it and the grid calms.

18% rather than the old 13% because the base underneath is darker now, so the old
strength read weaker against it.

Note `--color-pos-*` and `--color-cell-*` are separate on purpose: the former stay
the full-strength hues used for borders, chips and label text, the latter are only
the board's fills.

### The live cell is solid, and that is what makes the hierarchy hold

Under the previous palette the live cell was a heavy `--live` outline over an 8%
wash. That lost. The board carries ~29 solid trade strips, and an outlined cell
against thirty thin bright marks is not the first thing the eye finds — which
fails the brief's hardest requirement, that exactly one cell be unmissable.

It is now a fully saturated fill. The point is that it wins on **treatment, not
hue**: it is the only mark on the board that fills a whole cell and the only one
that glows, so it stays first in the hierarchy no matter what colour — or how
bright — anything else gets. Fixing it by hue instead would mean re-tuning every
other mark every time the palette moves.

That robustness is now load-bearing rather than theoretical. The trade strip is
white, so it **beats the live cell on contrast** (19.1:1 against 8.2:1) and still
loses comfortably, because a ~10px bar is roughly a sixth of a cell's area and
carries no glow. A hierarchy built on hue would have broken at that change.

It also settles `--live` sharing the accent with the WR hue: a solid cyan cell
cannot be mistaken for a WR cell tinted at 13%.

### `--trade` has no hue, and its five revisions are the whole argument

1. The old QB orange — the same value `--live` then had, which let 29 traded picks
   shout as loudly as the single cell on the clock.
2. `--ds-slate` — a neutral, on the theory that all five hues are spoken for by a
   position so a coloured strip reads as a position claim. Right instinct, and it
   still failed: a **mid**-grey bar on a slate cell is about 2:1 contrast, and the
   thing it names is the single most misreadable fact on the board.
3. `--ds-cyan` (`#43cfe0`) — the one bright hue outside the five positions, so it
   read as an annotation rather than a position claim. Correct until the Zinc +
   Electric Cyan palette made cyan the accent _and_ gave WR the same hue, at
   which point cyan could no longer annotate anything.
4. `--ds-magenta` (`#f472b6`, 350°) — the last hue with no other job, 36° off the
   nearest claimed hue, solid with `--background` knocked out at 7.5:1. It worked.
   It was dropped on looks: thirty pink bars is a lot of pink.
5. `--ds-text` (`#fafafa`) — neutral again, at the opposite end of the lightness
   scale from where #2 sat.

**Step 2 is the one to read twice, because it makes #5 look like a repeat and it
is not one.** #2 failed on _lightness_, not on hue — it put a mid-tone on a
mid-tone. Nothing about "no hue" was ever the problem, so the fix is a neutral at
maximum lightness separation rather than another trip around the colour wheel.

**And there is no hue left to move to.** Rank every candidate by its distance to
the nearest already-claimed hue (`node scripts/hex-to-oklch.mjs` prints this):

| Candidate            | Hue  | Nearest claimed           | Verdict                      |
| -------------------- | ---- | ------------------------- | ---------------------------- |
| Old cyan `#06b6d4`   | 215° | **0°** off the accent     | Literally the accent         |
| Magenta `#f472b6`    | 350° | **0°** off QB             | Literally QB — it *is* the locked QB hue |
| Amber `#fbbf24`      | 84°  | **0°** off TE             | Literally TE                 |
| Mint `#4ade80`       | 152° | **0°** off WR             | Literally WR                 |
| Orange `#e85d30`     | 38°  | **12.4°** off the reach ring | Reads as an error         |
| Lime `#bdd225`       | 117° | 32.4° off TE              | Reads as TE or WR            |
| Teal `#14b8a6`       | 183° | 20° off the steal ring    | Reads as "good"              |

The bar to clear is **44.3°** — the board's tightest position pair (DST/QB).
Nothing clears it. Every candidate is a closer call than two positions are to each
other, which means it would be read _as_ a position or a status.

The top four rows are the punchline: every hue that ever looked available has since
become something. Magenta was `--trade`'s best candidate and is now literally the
QB hue, so had `--trade` kept
it, the board would be printing ownership in what reads as a position's colour.

So the neutral is not a compromise between those. It is the only mark on the board
that **cannot** be mistaken for a position, because hue is what "position" is
encoded in and this has none — which is what lets one strip treatment work over a
pink QB cell and a lavender DST cell alike.

It also pays for itself in the currency that has always mattered here: **19.1:1**
with `--background` knocked out, against magenta's 7.5:1. `--ds-text` rather than
pure white is deliberate — tying the fill to the board's brightest _ink_ means the
strip can never become a brighter rung than the type beside it, so thirty of them
still lose to the one live cell, which wins on area and glow rather than on being
brighter.

The constraint that matters here is contrast, not restraint. That never changed;
this is the first revision that gets it without spending a hue.

### No hue is free, and that is now a rule

`--trade` and `--keeper` both ran the same course — pick a hue, discover it reads
as something else, pick another — so the underlying fact is worth stating once
rather than rediscovering per token.

**On the board grid, hue means position. Nothing else may use one.** Positions own
five hues, and three more are spoken for by marks the grid draws on top of them —
the accent/live cell, and the reach and steal rings. Eight hues, and the gaps
between them are not wide enough for a ninth. `node scripts/hex-to-oklch.mjs`
prints every gap:

| Gap                | Width     | Clearance | Verdict          |
| ------------------ | --------- | --------- | ---------------- |
| reach → TE         | 59.1°     | 29.6°     | too tight        |
| **TE → WR**        | **67.3°** | **33.7°** | widest slot left |
| WR → steal         | 10.8°     | 5.4°      | the one overlap  |
| steal → accent     | 52.7°     | 26.4°     | too tight        |
| accent → RB        | 39.4°     | 19.7°     | too tight        |
| RB → DST           | 50.9°     | 25.5°     | too tight        |
| DST → QB           | 44.3°     | 22.2°     | too tight        |
| QB → reach         | 35.5°     | 17.8°     | too tight        |

**Nothing clears the 44.3° bar.** The widest slot left is ~118°, a chartreuse with
33.7° of room, and it would read as TE or WR anyway.

So every non-position mark on the board is carried by **lightness and treatment**
instead:

| Mark            | Value                | Treatment                        |
| --------------- | -------------------- | -------------------------------- |
| Traded pick     | `--ds-text` neutral  | Solid strip, bottom edge, 19.1:1 |
| Keeper          | `--ds-text` neutral  | Lock glyph beside the position   |
| Empty starter   | `--border` + 3% lift | Hairline weight only             |
| On the clock    | `--live` cyan        | Fills the whole cell, plus glow  |

Only the live cell keeps a hue, and only because there is exactly one of it.

**`--warning` amber is therefore banned from the board grid as a status** and kept
for genuine, exceptional cautions off it — modals, governance disclosures,
unsettled keeper tenure. The bar is a grid constraint: a governance banner never
sits beside a QB cell, so amber is safe there and still carries the convention.
Amber _is_ the TE hue now, which is the same rule read from the other side: on the
grid that value means TE and nothing else.

**`--success` green is the one standing exception, and it is accepted rather than
solved.** At 162.5° it is **10.8°** from WR mint, and mint is a locked hue, so
there is nowhere for either to go. It survives on treatment. The ring is drawn at
full strength on an 18% tint, so what the eye actually compares is the ring
against the cell — **5.27:1** — and not mint against green, which is 1.87:1 and
would be unreadable.

Two things are worth knowing before anyone tries to "fix" this. Saturating mint
*helped*: it lifted WR to L 0.874 against the steal ring's 0.696, so the pair now
separates on lightness where the pastel version had almost nothing (1.46:1 direct).
And a previous revision did solve it geometrically, by moving WR to a lime at 117°
that was 45.7° clear — which was arithmetically correct and looked like a
yellow-green nobody wanted. The hue is locked for a reason; this is the cost, and
it is a small one.

Three amber marks were removed for a second reason, independent of hue: they fired
on the **default** state. Seven open starting slots is where every roster begins,
an unfinished draft is what the recap page shows for the whole draft, and roughly
seventy of the rosters wall's ninety starter cells are empty early on. An alarm
colour on a normal condition is decoration, and it was most of the colour on both
screens. Those are now neutral, and `--success` green appears only once a lineup
is actually full — so colour marks what has been _achieved_ rather than what has
merely not happened yet.

### Franchise headers count by position, in words

Each column header carries what that franchise holds so far as `WR2 TE1`, in the
position hues. It was a coloured dot and a bare number, which failed as data: it
asked the room to learn five hues and then guess what was being counted. The
first person to read this board could not tell whether "•2" meant two keepers,
two picks, or round two. The letters are the shorthand every fantasy manager
already knows, and the hue is now reinforcement rather than the only signal.

### TV mode

The board header has a **TV mode** toggle that calls the Fullscreen API on
`documentElement`, so the projector loses the tab strip and address bar. The
button's state is mirrored from `document.fullscreenElement` via the
`fullscreenchange` event rather than stored, because the user can also leave
fullscreen with Esc and a stored flag would strand the icon.

### Legibility beats fitting on one screen

Rows are `grow shrink-0 basis-auto` with a `min-h-[3.4rem]` floor — **not**
`flex-1`. `flex-1` made the grid fit any screen by shrinking rows, and combined
with `vw`-based type whose clamp floors were around `0.4rem` the result was 6px
text on a laptop: it fit, and nobody could read it.

The floors are now around `0.6rem`, and the player name's is `0.68rem`, so the
type stops shrinking before it stops being type. The consequence is that sixteen
rounds no longer always fit, so the grid scrolls:

| Screen    | Result                                            |
| --------- | ------------------------------------------------- |
| 1280×800  | scrolls, ~4 rounds below the fold                 |
| 1440×900  | scrolls ~130px, about 2 rounds                    |
| 1920×1080 | fits exactly, no scroll                           |
| 2560×1440 | fits, rows grow to 72px and the name reaches 16px |

Because the floor governs on every screen that scrolls, **all sixteen rows stay
the same height** — a lower floor would let rows with a wrapped name and a banner
grow taller than their neighbours and the grid would look ragged.

Two things follow from the board being scrollable:

- The franchise-name row is **sticky**, so the columns stay identified.
- The live cell is **scrolled into view** whenever the target changes, because
  otherwise the commissioner would be scrolling with one hand and typing names
  with the other by round 15. Cells carry `scroll-mt-[7vh]`
  (`SCROLL_CLEARANCE`); `scrollIntoView` knows nothing about the sticky row and
  without it parks the live cell exactly underneath.

### Two rules the board must keep

1. **No truncated text.** Names print in full. `boardName()` — which rendered
   "Jahmyr Gibbs" as "J. Gibbs" — is gone, and so is the ellipsis. Column headers
   wrap rather than clip for the same reason, and a name that cannot fit one line
   wraps rather than shrinking.
2. **Ownership is answerable from the cell.** The column header names the
   _original_ owner, so without the banner a traded pick reads as having gone to
   the wrong franchise. Column headers show the franchise name (not the
   manager's handle) so the header and the banner are the same noun. The header's
   on-the-clock line spells it out too — "TRADED FROM ZACH", which replaced a
   "VIA PI" that nobody decoded.

### The picks list — the third view

`Board / Picks / Rosters`. The grid is keyed by franchise and round, which is the
right shape for "what has each franchise got" and the wrong shape for "what
happened, in order": pick order snakes, so pick 11 sits *under* pick 10 rather
than beside it, and reading the draft as a sequence means zig-zagging ten columns
wide and sixteen rows deep. `PickList` (`src/components/pick-list.tsx`) is the
same 160 slots on one axis — scroll down and the draft happened in that order.

It reuses the board's vocabulary wholesale, so nothing is relearned when the
toggle flips: `positionCell` fills, `EMPTY_CELL` for a slot not yet entered, the
padlock on a keeper, `FA` and `BYE n` spelled out, the manager's handle rather
than the franchise name. Three things differ, each for a reason:

- **The overall number leads the row.** It is the one fact the grid never prints
  — there a cell *is* its coordinates — and it is what the view is for.
- **Names print in full, with no `boardName` initial.** A row is one line of a
  64rem column instead of a 170px cell, so the width the abbreviation buys is not
  needed. The no-truncation rule is kept the easy way.
- **A traded pick says "from STEFAN" in that word**, not as an arrow between two
  handles. The grid's bare arrow works because the strip hangs inside the
  original owner's column, so direction is given by position; a row has no column
  to be read against, and "STEFAN → ZACH" and "ZACH ← STEFAN" are one fact
  written two ways.

The list is capped at 64rem and centred — a row is six short fields, and at full
width on a TV the owner and the player end up a foot apart. Round rules are
sticky, doing the job the grid's franchise row does. Opening the view scrolls to
the live pick centred rather than to 1.01, because sixteen rounds is taller than
any screen and the first round is not where the draft has got to.

`Tab` and `⌘B` now **cycle** rather than swap. With the board first, one press is
always "off the grid" and a third is always back on it, which is the only move
the operator makes under pressure.

## Every cell the same shape

The board grids — live, final and roster wall — all obey the same four rules,
and each one was arrived at by breaking it first.

**Rows are `grow shrink-0 basis-0` over a floor.** Three versions of this exist
in the history. `flex-1` fit any screen by shrinking rows until the type was 6px
on a laptop. `basis-auto` sized each row to its own content — legible, but a row
holding a name long enough to wrap stood 62px against its neighbours' 54px, and
at that point no two cells in a column agreed on where anything sat. `basis-0`
makes rows share the space equally rather than asking for what they contain, so
all sixteen are identical whatever is in them. Above the floor they grow to fill
a projector; below it they hold the floor and the surface scrolls.

**Content is top-aligned, marks are bottom-pinned.** Centring put the position
line at a different height in every cell, because what sits below it differs — a
traded cell gives up its bottom edge to the ownership strip and an untraded one
does not. `justify-start` on the content, with the strip as the last child of a
`flex-1` column, puts the position/club/bye on one baseline in all 160 cells and
the strip on another. The slack collects in the middle, where there is nothing to
misalign.

**A name is one line, always** — `boardName` in `src/lib/board-name.ts`. A
wrapped name needs ~59px of cell once the top line and a strip are counted, and
sixteen rounds of 59px does not fit 1080p, which affords 57. So wrapping and
uniformity are mutually exclusive. Names over 15 characters take a first
initial; shorter ones are untouched, because most names already fit and
abbreviating them would cost legibility for nothing. This is **not** the old
`boardName()` that rendered everything as "J. Gibbs" — that was rejected for
shortening names that had room. 15 is the budget of a 93px column at a 1280px
window; the full name is always in the tooltip.

**Column headers are the manager's handle, not the franchise name.** The header
was the franchise name on the reasoning that a traded cell's strip has to be read
against it and the two should agree — right principle, wrong direction, since the
strip already said "→ ZACH". Handles are also all three to six characters, so
they are one line at any width; franchise names ran to "Fingers are for painting"
and wrapped to one, two or three lines, leaving each column's position counts at
a different height. The raggedness is gone by construction rather than by
reserving blank lines for it.

### Where the club and bye live

On the top line, opposite the position, where the pick label used to be. The
label went because it is the one fact a filled cell states that the grid already
states twice — the row is headed "RD 4" and the column by a franchise, so a
filled cell *is* its slot. Empty cells still print it, being the coordinate the
operator types into.

Two earlier attempts are worth not repeating. Riding the top line *alongside* the
label clipped to "ATL BYE …" on every screen under 1600px. Sharing the
traded-pick strip fit, but crammed two unrelated facts into a 10px bar and read
as janky. Giving up the label solved both: it freed enough width that nothing
clips even at 1180px, and it took a filled cell from three lines to two, so the
strip has its own line back at no cost in height.

### Verifying it

Measure the leaf elements, not the cell. A cell is `overflow-hidden` with a flex
child, so the child clips while the cell reports `scrollHeight == clientHeight` —
a check written that way passed a board that was visibly cutting "Njigba" in
half. Walk every descendant and compare both axes.

## The final board — `/draft/final`

The board everyone stands around after the draft, to make fun of each other's
teams. It reads the same room view as `/draft` and regroups it, so there is
nothing to keep in sync.

**A column is who OWNS the player, not whose pick it was.** This is the whole
point. The live board must be keyed by original owner — the room calls picks by
slot ("who's got 4.06?") — which means an acquired pick shows up as a foreign
name inside someone else's column under a `→ SCOTT` strip. Correct for entering
picks, useless for reading the result: nobody can hold ten of those corrections
in their head while arguing. So this board drops trade attribution entirely.
Ownership is the column; there is nothing left to reconcile.

**Rows are each franchise's own pick order, not rounds.** Built the other way
first, and it was wrong. Trades do not respect rounds — Zach owns three picks in
round 4, Witte three in round 8 — so a round-keyed cell has to be a _list_, and
rounds 4 and 8 came out three players deep while 11, 14 and 15 were one. Ragged
row heights, twenty-three holes, three names stacked in a box. It read as janky
because it was. Keying rows to the franchise's own selection order gives a
perfectly uniform 10×16: one player per cell, no holes, no stacks.

The cost is real: **row 5 is not "round 5"** for a franchise that held two of
round 4. So the round is printed in every cell as `R4` and that is the only place
it appears. Do not add a row-level round label — it would be a lie for exactly
the franchises this layout exists to handle. The keepers-only board makes this
vivid: one row spans R8 to R10 across the ten columns.

**One screen, no scrolling.** Rows are `grow shrink-0 basis-auto` over a
`min-h-[2.7rem]` floor, so they expand to fill a projector and only the floor
binds on a laptop. Verified at 0 overflow on both 1920×1080 and 1512×856 with a
synthetically complete draft. The floor still clears two lines of the name type,
because names wrap rather than truncate. The "draft is not finished" banner costs
about 22px and does push a laptop into scrolling — acceptable, since that banner
by definition is not present on a _final_ board.

**Reaches and steals.** `picksEarlier = adp - overallPick`; positive means he
went earlier than consensus. Only the **top five in each direction** are marked,
and only past a 12-pick gap — a bare threshold would mark whatever the pool's ADP
noise exceeds, which is not "the biggest reaches and steals", it is a rash. The
mark is a `ring-2` outside the position fill plus a signed number, so the cell
still reads positionally first: `ring-destructive` for a reach (red, as asked),
`ring-success` for a steal. Keepers are never marked — a keeper was not a
decision made at that slot. ADP is joined from the pool, since a drafted player
keeps only the fields the board needs.

> **The rings are board hues, not off-board status.** Both are drawn _around_ a
> cell whose fill is already a position hue, so a position that lands near either
> one produces a ring that disappears into its own cell. That makes red and green
> constraints on the position palette rather than an unrelated concern.
>
> WR mint is **10.8°** from `ring-success`, which is the one real overlap in the
> system. It is accepted, because both hues are locked. What keeps it readable is
> that the ring is full strength on an 18% tint: ring-against-cell is **5.27:1**,
> where mint against the steal green directly is 1.87:1. Saturating mint helped
> here rather than hurting — it pulled WR to L 0.874 against the ring's 0.696, so
> the pair separates on lightness, where the pastel mint managed 1.46:1 direct.
>
> A previous revision solved this properly by moving WR to a lime at 117°, fully
> 45.7° clear of the ring. It was arithmetically ideal and read as a yellow-green
> that got rejected on sight. Locked hues win; this is the price.
>
> `node scripts/hex-to-oklch.mjs` prints the ring-against-cell ratio for all five
> positions, which is the number that actually decides this.

**Board / Rosters** is the same `ViewToggle` the live board uses, imported from
`draft-surface.tsx` rather than reimplemented, so the two boards cannot drift.
The Rosters half is `RosterWall` — the ten teams lined up QB against QB. Two
questions, one screen each: "what did he take, and when" versus "whose roster is
better".

## Position colours — the one intentional exception

`src/lib/positions.ts` uses `--color-pos-*` theme tokens rather than Tailwind
palette colours, but the reasoning is unchanged: these five hues encode position
at a glance and must stay **mutually distinct**, so they are the one group not
derived from the accent.

The five HUES are fixed by the design and were not ours to choose. What *was*
ours is their saturation, and that is where every complaint about this palette
ended up pointing.

| Position | Token     | Locked as              | Shipped   | Hue    | L     | C     |
| -------- | --------- | ---------------------- | --------- | ------ | ----- | ----- |
| TE       | `pos-te`  | Amber `#fbbf24`        | `#edb41a` | 84.4°  | 0.800 | 0.159 |
| WR       | `pos-wr`  | Mint Green `#4ade80`   | `#1fdf75` | 151.7° | 0.790 | 0.204 |
| RB       | `pos-rb`  | Soft Blue `#60a5fa`    | `#1187fc` | 254.6° | 0.628 | 0.198 |
| DST      | `pos-dst` | Lavender `#c084fc`     | `#b25cfc` | 305.5° | 0.650 | 0.230 |
| QB       | `pos-qb`  | Coral Pink `#f472b6`   | `#fc19a9` | 349.8° | 0.660 | 0.267 |

**Not one hue moved.** Tightest position pair is DST/QB at 44.3°.

### Pastel was never a hue choice

Worth recording, because two revisions were spent learning it. The locked set as
delivered drew complaints that all sounded like hue problems — the blue read
"close to teal", the pink wanted to be "a hot magenta", the whole thing read
faintly feminine — and each was answered by moving hues. They were all the same
chroma problem. Measured against the most chroma sRGB can express at each of
these exact hues, the delivered set was running at:

| Position | Delivered C | Ceiling at that hue | Using |
| -------- | ----------- | ------------------- | ----- |
| QB       | 0.175       | 0.275               | 64%   |
| RB       | 0.143       | 0.204               | 70%   |
| WR       | 0.182       | 0.231               | 79%   |
| TE       | 0.164       | 0.173               | 95%   |
| DST      | 0.177       | 0.297               | 60%   |

At 64% of its own ceiling, hue 349.8 reads as rose. At 97% the identical hue
reads as hot magenta. The colour that looked palest, DST, was the most starved of
all. So the fix was chroma, and getting chroma means **lowering lightness**,
because sRGB holds very little of it above L 0.80 for anything but green and
yellow. Pastel was the by-product of pinning lightness high and taking whatever
chroma fitted underneath.

**Mean chroma 0.168 → 0.212, +26%.** Per position: QB +52%, RB +38%, DST +30%,
WR +12%, TE −3%. The last two are held below their ceilings deliberately — see
_Loudness is weighted by frequency_ below.

That also settles the "does this read too feminine" question, since pastel was
the cause: saturating drops QB to L 0.660 and DST to L 0.650, so they land as hot
magenta and vivid purple rather than bubblegum and lavender.

**TE is the near-zero and it is a hard limit, not an oversight.** The amber band
tops out around C 0.17 in sRGB, barely half what pink or lavender reach. TE was
already at 95% of its ceiling. It will always be the least saturated of the five
and no tuning changes that.

### Loudness is weighted by frequency

Chroma and lightness are different axes, and **only lightness decides how loud a
cell looks on a full board.** Saturating all five to their individual maxima gave
a palette balanced on chroma and badly unbalanced on lightness — and that is
invisible in a swatch strip, because a swatch shows each hue once. A board shows
them in proportion.

Position frequency is nowhere near uniform. Measured over a real 93-pick draft:

| Position | Share of picks | L before | Perceived brightness vs RB |
| -------- | -------------- | -------- | -------------------------- |
| WR       | **38%**        | 0.874    | **3.0x**                   |
| RB       | 30%            | 0.628    | 1.0x                       |
| QB       | 17%            | 0.660    | 1.0x                       |
| TE       | 12%            | 0.840    | 2.4x                       |
| DST      | 3%             | 0.650    | 1.0x                       |

The two brightest hues were half of all cells, and the single loudest colour had
been handed to the most common position. The board read as *a green board* — not
because green was wrong, but because 38% of cells were green **and** green was the
brightest thing on screen.

So WR and TE are pulled down until brightness roughly tracks frequency: **WR
0.874 → 0.790** and **TE 0.840 → 0.800**, which takes the spread from 3.0x to
2.2x for 9% and 5% of their chroma. Green is the cheapest place to buy this, since
sRGB holds chroma across a wide lightness range there.

Two notes for anyone revisiting this:

- **~2.2x is close to the practical floor**, not a target worth chasing further.
  Green and yellow cannot be dark while saturated, and blue, purple and magenta
  cannot be light while saturated, so some spread is forced by the gamut.
- **Every contrast floor improved**, which is why this was free rather than a
  trade: the steal ring on a WR cell went 5.27:1 → 5.67:1.

### The two floors that stopped it going further

Both are legibility, not taste:

1. **The solid chip** must keep a knockout above 5:1. All five still take dark
   text — white peaks at 3.5:1 against these. Floor as shipped: **5.5:1**.
2. **The position label**, which is the hue drawn on an 18% tint *of that same
   hue*. Floor as shipped: **4.54:1**, and this is the one that actually binds.

The second is the useful one to understand, because it caps the whole palette. A
hue's contrast against a tint of itself is governed by that hue's own luminance,
so a genuinely dark position colour **cannot label its own cell**. And the tint
percentage is not an escape hatch: dropping `--cell-*` from 18% to 10% moves the
ratio by less than 0.2, because darkening the tint also darkens the thing being
compared with it. The only real lever is the hue's lightness.

Canvas-contrast floor went 7.5:1 → 5.5:1 as a result. That is the price of the
saturation step, paid knowingly, and 5:1 is where it was stopped — clear of AA
for normal text, and clear of the dead zone near L 0.59 where dark and white
knockouts both collapse to ~4.4:1 and neither is safe.

Position is also redundantly encoded — every cell carries the position letters as
well as the hue. Run `node scripts/hex-to-oklch.mjs` to re-derive this table; it
prints the tightest pair so a future palette cannot quietly close the gap.

**The accent is no longer a position hue, and that is the biggest win here.** WR
used to *be* `--ds-cyan`, so cyan was the accent, the WR hue and the live cell at
once — which cost `--live` and `positionCell` a paragraph each arguing that a
solid cyan cell could not be mistaken for a 13% cyan tint. True, but a defence
rather than a design. Cyan is one of the fixed points the palette is solved around,
so the nearest position to it is RB at 42.5° by construction — that argument is
retired and `--live` is unambiguous by hue *and* by treatment.

**No overlaps are listed here any more, which is new.** There were three. `--keeper`
amber sat 14.3° from the TE hue of the day, and `--trade` magenta 7° from QB; both
are neutral now. `--success` green sat 10.8° from WR mint, and that one is fixed by
this palette rather than excused by it — see _Reaches and steals_. Amber and TE are
now the same token, which is the one apparent overlap left and is deliberate: it is
one colour with one meaning on the grid, not two that nearly collide.

The module exposes five treatments — `positionStyle` (tinted chip),
`positionChipSolid` (**`--background` knocked out of** the solid hue; see the
contrast note in section 0), `positionCell` (the board's opaque `--cell-*` fill
plus a solid-hue outline), `positionText` (label inside a tinted cell), and
`EMPTY_CELL` (the board's base plus a full-strength hairline, for an un-drafted
slot).

## Integrating a design revision

1. Repoint the **semantic** block in `globals.css` — or `--ds-*` if the design's
   own palette moved. Leave the brand ramp as the record of the crest's values.
2. Update `--primary-a10/32/45/60` if `--primary` moved. Lightning CSS still
   cannot downlevel `oklch(from …)`, so they are longhand.
3. Replace the inner span of `BrandMark` if Figma supplies a small mark.
4. Drop new crest exports into `public/brand/` at the same filenames.
5. Re-check contrast. Every foreground token clears WCAG AA against both
   `--background` and `--card`. `--ds-muted` (2.6:1) and `--ds-border` (1.9:1) do
   not and are not text — see section 0.
6. `scripts/hex-to-oklch.mjs` converts a palette's hex to the exact oklch the
   token sheet records, and prints the contrast ratios used in the tables above.

No component hardcodes a colour. If you add one, it will survive the next
redesign and look wrong — put it in the token block instead.

### Reskin history

The skin moved from a warm **orange / navy** reading of the crest to **Zinc +
Electric Cyan**. Because the token layers were already clean, the repoint itself
was confined to the `--ds-*` block plus the semantic rows above. What was _not_
mechanical, and is the useful part of this record:

| Problem the new palette created                                             | Resolution                                                                       |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Cyan wanted four jobs at once: accent, WR hue, live cell, trade attribution  | Trade left the colour wheel entirely; live keeps the accent, distinguished by fill |
| Trade then had no hue available that would not be misread as a position       | `--trade` became neutral `--ds-text` — no hue, so no collision, and 7.5:1 → 19.1:1 |
| `--keeper`/`--warning` amber sat 15.6° from TE gold, the worst pair on the board | Amber left the board grid: keeper went neutral, open-starter marks went neutral    |
| Amber also flagged the *default* state — 7 open starters, an unfinished draft   | Those marks went quiet; `--success` now fires only when a lineup is actually full |
| WR *was* the accent, so cyan meant accent, position and live cell at once        | WR moved to the locked mint; cyan is exclusive again, nearest position RB at 39.4° |
| The locked position hues shipped at pastel saturation and looked washed out      | Diagnosed as chroma, not hue: they were using 60–79% of the chroma sRGB has at those hues. Saturated in place, mean C 0.168 → 0.217 (+29%) |
| Two revisions "fixed" that by moving hues — to magenta 342°, lime 117°, orange 58° | Wrong lever. The hues were locked by the design; reverted to them exactly and re-applied the saturation |
| TE amber and `--warning` amber sat 14.3° apart, closer than any two positions    | Collapsed into a single `--ds-amber`. Also retires the older `--ds-gold`/`--ds-amber` pair |
| Saturation costs contrast, since chroma lives at lower lightness                 | Chip knockout floor 7.5:1 → 5.5:1, stopped at 5:1 deliberately; the real cap is the position label at 4.54:1 |
| 29 solid trade strips out-shouted the outlined live cell                     | Live cell became a solid fill — hierarchy by treatment, not hue                   |
| Light accent broke every light-on-fill knockout                              | `--primary-foreground` and `positionChipSolid` flipped to dark; 2.3:1 → 8.2:1     |
| Greyscale had no step between 7.8:1 and 2.6:1                                | Bridged with alpha at the call site; a fourth token was tried and dropped         |
| Cyan glow sat directly behind the still-orange crest                         | Crest glows made neutral; flagged as the one asset outside the palette            |
| Panel grey made empty board cells brighter than completed picks               | The whole board screen moved to `--board-base`; fills became opaque `--cell-*`     |

Three escapes were also closed on the way through — raw `amber-500` in
`keeper-board.tsx` and `franchise-roster.tsx` now route through `--warning`, and
the `default` badge no longer hardcodes `text-white`.

## Pulling from Figma

`scripts/figma-mcp.sh` is a small JSON-RPC client for the Figma Dev Mode MCP
server on `127.0.0.1:3845`. It exists because Cursor's MCP namespace for Figma
Desktop drops out of the tool list intermittently while the server itself stays
up; the script talks to the same endpoint directly.

```bash
./scripts/figma-mcp.sh tools/list
./scripts/figma-mcp.sh tools/call '{"name":"get_metadata","arguments":{"nodeId":"0:1"}}'
```

Everything is scoped to the document open in Figma Desktop — there is no way to
search files by name, so the design has to be open. `scripts/skin-shots.mjs`
screenshots the implemented pages at the design's own frame sizes for comparison.
