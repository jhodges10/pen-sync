---
name: pen-polish
description: Polish the Pencil design-system library (pen-sync.config.json → pen) against the code — screenshot each component's VariantMatrix story, export the same components from Pencil, rank where they drift, and fix the cause in the matrix, story wrapper or exporter (never by hand-editing Pencil), then re-export. Use after exporting components to Pencil, when a section "looks off", when asked to polish, review or QA the design-system file, or for a level ("polish the molecules"). Triggers on "polish the Pencil file", "design library looks wrong", "compare Pencil to Storybook", "pen-polish", work on the pen-sync exporter or a VariantMatrix story's matrix.
---

# Design-system polish (Pencil ↔ Storybook)

The Pencil library is **generated**: `export-matrix.mjs` turns each component's
`VariantMatrix` story into a Pencil section, and a re-sync replaces the whole section. So a fix
made by editing Pencil nodes is lost on the next sync. **Every fix goes into an input** — the
matrix in the component's story file, its story wrapper, the registry, the exporter
(`dom-to-pen.mjs`) — and is then re-synced (the pen-sync skill has the background).

**Scripts:** `$DS` below is the plugin's `scripts/` folder — `${CLAUDE_PLUGIN_ROOT}/scripts`
when installed as a plugin. Run them
from the repo root: they find the repo by walking up to `pen-sync.config.json`.

## Prerequisites

- Storybook running (config `storybook`; don't start a second one; ask), or, with `source` in the
  config, a current build of what its commands run. There, "Storybook shots" are the `shots`
  command's, and a fix goes in that repo's matrix or exporter; the table's class-name and
  `data-ds` causes don't apply.
- The pen.dev CLI (`pen`), logged in, with Pencil open on the design-system file.
- Scripts that launch Chromium, reach localhost or talk to the CLI run **outside the sandbox**.
- The section was exported by the current exporter, so each component's `context` ends in a
  `Variant: <key>` line. If `polish-diff` reports every row MISSING, re-export first.

## The loop, per component

1. **Storybook shots** — one PNG per variant, as the code renders it (2×, the first story
   theme; `--theme <key>` for another), with the matrix's slot parts hidden (Pencil draws a
   slot as an empty frame), text selections collapsed, overflow that isn't clipped included,
   and the color behind each component recorded so translucent paint compares fairly:
   `node $DS/polish-shots.mjs <id>` → `<polishDir>/<id>/storybook/`.
2. **Pencil export** — `node $DS/pen-sync.mjs <id> [<id>…] --polish-only` (or `--all`)
   exports each variant through the pen.dev CLI to
   `<polishDir>/<id>/pencil/<variant>/<node>.png`, found by the `Variant:` line of its
   `context`, four sections per call. After a re-push, `pen-sync.mjs <id> --polish` pushes
   and exports in one go. Without the CLI, run the snippet from
   `node $DS/polish-diff.mjs --pencil-export <id> [<id>…]` with Pencil `execute`
   (about six ids per call; Pencil interrupts calls past ~55 s).
3. **Rank** — `node $DS/polish-diff.mjs <id>`. One row per variant, worst
   first: size delta (CSS px), mean channel difference (0–255) at the best alignment, and
   `lost` — the share of Storybook's ink Pencil leaves blank, which catches a missing
   border or text that a mostly white image hides from the mean. `CHECK` = past ±3 px,
   12, or 15 % lost. A drop shadow's bleed (Pencil's export includes it, a browser element
   shot doesn't) is cropped and shown as `(shadow +N)`, not counted as size — on one axis
   too, when everything outside the match is faint.
4. **Look** at every `CHECK` row: Read both PNGs. Also screenshot the whole section once
   (`TakeScreenshot`) for layout-level problems the per-instance diff can't see (an
   invisible variant, a row of identical instances, captions that don't explain the
   difference). If the Storybook shot itself looks wrong (another variant's popup or spill
   overlapping it), the story wrapper is the bug: contain it (see the table).
5. **Diagnose and fix the input** with the table below. Keep fixes general: a conversion bug
   is fixed once in the exporter (with a test in `dom-to-pen.test.mjs`), not per component.
6. **Re-sync** the component (`node $DS/pen-sync.mjs <id> --polish` pushes and re-exports the
   PNGs), then repeat from step 1 until only accepted gaps remain.

Scores are a triage aid, not a verdict: anti-aliasing and font hinting alone give ~3–8; a
diff of 20+, a `lost` past ~40 % or any size delta past a few px is real. Thin borders lose a
few percent to half-pixel offsets, and small components (checkboxes, badges) score high on
tiny offsets — look before acting.

## What you'll find and where it's fixed

| Symptom (Pencil vs Storybook) | Cause | Fix (input) |
|---|---|---|
| Variant invisible / near-white on the white card | made for dark or photo backdrops | `surface: "brand"` on its matrix row |
| Content spills, overlaps the next row, giant instance | unbounded width/height in the story | bound it in the matrix (`props.className: "w-80"`) or the wrapper |
| Variant only meaningful inside another component (popup scroll area) | depends on a parent | `exclude` it in that row with a comment; show it in the parent's matrix |
| A row of identical instances | the axis doesn't change the look | `ignore` the axis with the reason |
| "Default" on a variant that turns something off | prop defaults to true | matrix `defaults: { prop: true }` → "No …" naming |
| Open popup / list missing | only the `data-ds` element is captured | wrap field + popup in `data-ds-capture`, popup portaled into the cell |
| Variant of a root/wrapper prop missing (drawer edge, split direction) | not in the prop types | matrix `axes: { prop: [values] }`, wrapper passes it |
| Purple slot where the look should be (menu items, chips) | slot declared on a part that IS the look | remove that `slots` entry |
| Component found nowhere / MISSING rows | third-party DOM can't carry `data-ds` | registry `selector` |
| Text wraps differently / overflows its box | text-sizing rule | exporter: `convertInstance` text handling + test |
| A popup or spill from another variant overlaps the Storybook shot | the wrapper doesn't contain it | `transform-gpu` cell (containing block), or only fix a cell's height for the states that scroll |
| Field border or value missing (inputs, comboboxes) | ring drawn as `box-shadow`; value not a DOM text node | exporter: rings become strokes, input values become text (done) |
| Grid cells or headers collapse into run-on text | a centring box around one text was flattened | exporter: centring boxes stay frames (done) |
| Divider, header or footer stops short; buttons don't stretch | stretched child exported at hug width | exporter: stretched children `fill_container` (done) |
| Footer not pinned; body doesn't grow | `flex-1` child exported at its size | exporter: `flex-1`/`grow` fills the main axis (done) |
| An item pushed to the end (`ml-auto`) sits next to its sibling | Pencil has no margins | exporter: the sibling before fills, or a spacer does (done) |
| A moved part (a checked switch's thumb, `order-last`) in its DOM place | `translate`/`order` | exporter: drawn position / browser order (done) |
| Chips on one long line instead of wrapping | Pencil frames don't wrap | exporter: wrapped lines become rows (done) |
| Component narrower than in Storybook | a block-level root hugged its content | exporter: only an inline root hugs (done) |
| Children stacked wrong, `layout: none` overlaps | block layout inference | exporter: `flowOf` + test |
| Rotated or clipped parts wrong | transform / overflow rule | exporter: `turned`, `clip` + test |
| Wrong color in one theme only | binding chose the wrong token | exporter `bindColor` hints, or the component's class tokens |
| Dashed borders drawn solid; a shadow's spread (other than a ring) missing | Pencil has no equivalent | **accept**, note it in the report |
| A mark drawn by `::before`/`::after` missing (a drawer's swipe-handle pill) | the snapshot reads elements only | **accept**; if it matters, render the mark as a real element in the component |

Never "fix" a difference by changing the component's real styles to suit Pencil. If the
code itself looks wrong in Storybook, report it as a component bug instead.

## Pushing to Pencil

Re-push with `node $DS/pen-sync.mjs <id>` (the **pen-sync** skill). It replaces the section
in place, re-points designers' instances by variant key, and keeps the old section (renamed
"(old: …)") if any instance couldn't be matched — report those orphans rather than deleting
them. In app mode Pencil only writes the file when the user saves — ask them to save before
committing it.

## Report

Per component: rows checked, flagged → fixed (and in which input), accepted gaps, anything
reported as a component bug. Commit the input changes and the saved `.pen` file together.
