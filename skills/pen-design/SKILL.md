---
name: pen-design
description: Design screens in Pencil with the synced design-system library, and bring a designer's library edits back to code. Use when building or editing a screen, page or mockup in a .pen file that uses the design-system library; when asked what a Pencil node is in code ("which component is this", "what token is this"); when a designer changed a library component in Pencil and the change should land in code ("apply the design changes", "design to code", "pen-to-code"); or before placing components on a canvas by hand.
---

# Designing with the synced library (Pencil ↔ code)

The design-system file is generated from code by the **pen-sync** skill: every component is a
reusable Pencil component with a code link in its `context` (JSX, source file, story, variant
key) and its colors bound to the token variables. Designing well with it means reusing those
components, and a designer's change to one of them is a request to change the code.

**Scripts:** `$DS` below is the plugin's `scripts/` folder — `${CLAUDE_PLUGIN_ROOT}/scripts`
when installed as a plugin. Run them from the repo root (they find `pen-sync.config.json`).
They drive the pen.dev CLI (`pen`, logged in), connected to the open desktop app by default.

## Before designing: read the library

`pen-sync.config.json` → `library` (e.g. `design/design-system.library.md`) lists every
component by level with its Pencil component names, variant keys, node ids and slots, then the
token variables. Regenerate it after a sync: `node $DS/pen-library.mjs`.

## Screens that exist in code: export them

When the screen already exists in code and has a story (a page, a tab, a dialog with fixture
data), don't draw it: `node $DS/export-screen.mjs <story id> --to <app>.pen` renders the story
and builds the screen from library instances, overriding only what differs. Its summary lists
elements drawn by hand because no library variant fits; each is a component the library lacks a
variant for, or one missing from the registry. Export again after the code changes. A screen
that doesn't render well is fixed in its story or components, not on the canvas.

## Building a screen

- **Place components, never copies.** Insert a `ref` to the library component's node id and
  override layers by name: `{type:"ref", ref:"<node id>", descendants:{Label:{content:"Save"}}}`.
  A hand-drawn lookalike has no code behind it and drifts on the next sync.
- **Pick the variant, don't restyle.** Need a ghost button? Use `Button/Ghost`, not a
  `Button/Default` with its fill overridden. If no variant fits, that's a code change (below).
- **Fill slots with what they recommend.** An empty slot frame lists the components meant for
  it; put refs inside it.
- **Bind to variables.** Every color, radius and spacing value takes a `$--…` variable from the
  library's list; a literal hex won't follow themes.
- **Compose at the right level.** Atoms go into molecules and organisms; a page starts from a
  template when the library has one.
- Check what you placed: `node $DS/pen-inspect.mjs` (the selection) or
  `node $DS/pen-inspect.mjs <node id>…` names each node's component, variant, source and
  tokens, and says "hand-drawn" for anything with no library component behind it.

## Design → code

When a designer edits a library component in Pencil (a color, a radius, padding, a type
size), the code changes and the next sync makes Pencil match it again:

1. **See what changed:** `node $DS/pen-diff.mjs <id>` lists, per variant and layer, each
   design property that differs from a fresh export of the code (`size=sm › Label: fill
   $--color-foreground → $--color-primary`). It says when the section predates the current
   source: re-sync first (`pen-sync.mjs <id>`), then diff again, so only design edits remain.
2. **Change the code, not the canvas.** Translate each difference into the component's
   Tailwind classes or cva (`bg-primary`, `rounded-lg`, `px-3`): the variable name *is* the
   class token (`$--color-primary` → `bg-primary`/`text-primary`; `$--radius-lg` →
   `rounded-lg`; `$--spacing-3` → `p-3`). A layer added or removed means a structural change
   in the component's JSX: confirm it with the designer before writing it.
3. **Verify:** run the component's tests and its stories, then re-sync
   (`node $DS/pen-sync.mjs <id>`) and diff again; it should report "matches the code".
4. Changes that apply to every variant usually belong in the base classes; ones on a single
   variant in that variant's cva entry.
5. With `source` in the config there are no classes: a `$--color-…` variable is a token in that
   repo's theme and a value is a widget's option. The component's `context` names the call and
   file to change.

## Rules

- Never hand-edit a library section to "fix" it: a sync replaces it. Fix the code or the
  matrix, then re-sync (the pen-sync and pen-polish skills).
- A component a design needs but the library lacks is new code first (registry entry,
  `data-ds`, story), then a sync — not a drawing.
