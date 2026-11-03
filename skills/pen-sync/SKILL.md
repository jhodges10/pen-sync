---
name: pen-sync
description: Mirror a React component library into its Pencil (pen.dev) design-system file — register a component, give it a VariantMatrix story, export it from Storybook and push it into Pencil as reusable components bound to the token variables, through the pen.dev CLI. Use when adding or changing a shared component, when a component's Pencil section is missing or stale, when asked to "sync to Pencil", "export to Pencil", "push the design system", "add X to the design file", re-push a level ("re-sync the molecules"), push token changes, set a repo up for pen-sync, or check the file in CI. For how faithful a pushed section is, use pen-polish; for designing with the library or taking design edits back to code, pen-design.
---

# Design-system sync (code → Pencil)

Code is the source of truth. Pencil holds a **generated** mirror: one section per component,
each variant a reusable Pencil component whose `context` links back to its JSX, source file,
story and variant key. Designers compose with those components; a re-sync replaces the
section and re-points their instances by variant key, so nothing they built breaks.

Repo specifics (component package, registry, Storybook, tokens, Pencil file, themes, metadata
prefix) live in `pen-sync.config.json` at the repo root.

**Scripts:** `$DS` below is the plugin's `scripts/` folder — `${CLAUDE_PLUGIN_ROOT}/scripts`
when installed as a plugin. Run them from the repo
root: they find the repo by walking up to `pen-sync.config.json`.

## Prerequisites

- Storybook running (config `storybook`). Don't start a second one; ask.
- The pen.dev CLI (`pen`) installed and logged in. Pushes go into the **open desktop app** by
  default; `--headless` rewrites the file on disk instead.
- Scripts that launch Chromium, reach localhost or talk to the CLI run **outside the sandbox**.

## 0. A repo without pen-sync yet

`node $DS/init.mjs [--package packages/ui] [--prefix acme]` writes `pen-sync.config.json`,
copies the React kit into `<package>/src/design-system/` (matrix types, `variantMatrixStory`,
an empty registry, a contract test) and creates the `.pen` file with a board per level.
Nothing existing is overwritten. Then fix `themes` in the config: per theme, the Storybook
globals that render it, the `<html>` attributes that switch the token CSS to it, and its Pencil
theme tuple. Then `node $DS/export-tokens.mjs` and `node $DS/pen-sync.mjs --tokens`.

## 1. Make the component mirrorable

1. **Registry entry** in the registry (config `registry`): permanent kebab-case `id`, story
   `name`, `level` (atom / molecule / organism / template), `file`. Never rename or reuse an
   id; a removed component moves to `retired`.
2. **`data-ds="<id>"`** on the element that *is* the component visually (an overlay's popup,
   a select's trigger); a registry `selector` finds one whose DOM can't carry it.
3. **Variants**: `node $DS/variants.mjs` after changing a cva or the component's props (axes
   are literal-union props declared in the package; states are styled inherited props like
   `disabled`).
4. **Matrix** in the story file, beside its `VariantMatrix` story (tagged `ds-matrix`, last in
   the file). `{ id }` gets the default rows — each axis on its own, then each state turned on.
   Add only exceptions: `ignore` (axis → reason), `rows` when the default is wrong (crossed
   axes, `surface: "brand"` for a dark backdrop, row props such as sample content),
   `extraRows`, `overrides`, `slots` (parts that take arbitrary children → the registry ids
   that usually go there), `axes`/`defaults` for root or wrapper props. The kit's contract
   test fails until every axis is decided.
5. Wrap the component in the story when its `data-ds` element needs context (an open popup
   portaled into the cell with `transform-gpu`; `data-ds-capture` widens what's mirrored).

## 2. Push

```bash
node $DS/pen-sync.mjs <id> [<id>…]       # export from Storybook and push into the open app
node $DS/pen-sync.mjs --level molecule   # a level; --all for everything
node $DS/pen-sync.mjs --all --changed    # skip components whose export didn't change
node $DS/pen-sync.mjs --tokens           # token variables (after export-tokens.mjs)
node $DS/pen-sync.mjs --all --headless   # rewrite the .pen file on disk and save (no app)
node $DS/export-matrix.mjs <id>          # just the export: JSON + binding report
```

Each component prints `{components, replaced, repointed, orphans}`. **Orphans** are designer
instances whose variant no longer exists; their old section is kept, renamed "(old: instances
still use it)". Report them; never delete them. Read the export's binding report: `literal`
paints or many `scoped` variables mean a color no token expresses — usually fine (opacity
modifiers), worth a look when a whole component goes scoped.

- Never run headless on the file while the desktop app has it open with unsaved changes: the
  app's next save overwrites it. One writer at a time.
- Pencil warns "Collapsed size … fit_content" for every empty slot frame; that's expected.
- Pencil interrupts an `execute` call past ~55 s; pushes are one component per call, so only a
  huge component would hit it.

**No CLI?** Payloads can go in through Pencil's integrated browser and MCP `execute` instead:
`pencil-chunks.mjs --setup` and `export-matrix.mjs --pencil-apply` once per Pencil session,
`pencil-chunks.mjs --page batch.html <data.js…>` per batch (data from `export-matrix.mjs <id>
--pencil-data`), Pencil `browser` `load-page` + `import-to-canvas` (`#pen-sync-payload`), then
the printed take snippet with the imported frame's id (it checks the hash and stores the batch
as `dsBody`), then one component per `execute` call:
`eval(dsBody.split("\n")[i])`.

## 3. Check and save

- Run the **pen-polish** loop on what you pushed.
- `node $DS/pen-sync.mjs --check` (read-only, works on a copy of the saved file) lists
  sections missing, built from older source, or orphaned; `node $DS/pen-library.mjs` refreshes
  the library reference agents design from (`--check` in CI).
- In app mode Pencil writes the `.pen` file only when the user saves. Ask, then commit the
  file with the code changes.

## Rules

- Never hand-edit a generated section: fix the matrix, story wrapper or exporter and re-push
  (the pen-polish skill's table maps symptoms to inputs).
- Never change `metadataPrefix` on an existing file: sections would stop being found.
- Exporter changes need a test beside them (`node --test $DS/*.test.mjs`).
