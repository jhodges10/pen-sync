# pen-sync

A Claude Code plugin that keeps a [pen.dev](https://pen.dev) (Pencil) design-system file in
step with a React component library. Code is the source of truth: every component's Storybook
variants become reusable Pencil components, bound to your design tokens in every theme, with
a link back to their JSX, source file and story. Designers build screens from them; their
edits to a library component come back as a list of code changes.

```
registry + data-ds ─▶ VariantMatrix story ─▶ export (Chromium, every theme) ─▶ pen.dev CLI ─▶ .pen
                                                                                   │
           code changes ◀── pen-diff (Pencil vs a fresh export) ◀──────────────────┘
```

## What you get

| Part | What it does |
| --- | --- |
| `skills/pen-sync` | Code → Pencil: make a component mirrorable, export it, push it. |
| `skills/pen-polish` | Screenshot Storybook and Pencil, rank where they drift, fix the input, re-push. |
| `skills/pen-design` | Design screens from the library, inspect nodes, bring library edits back to code. |
| `agents/pen-polisher` | Runs the polish loop on a batch of components. |
| `scripts/` | The tools the skills run (below). |
| `templates/design-system/` | The React kit `init.mjs` copies into your package. |

| Script | |
| --- | --- |
| `init.mjs` | Write `pen-sync.config.json`, copy the React kit, create the `.pen` file with a board per level. |
| `export-tokens.mjs` | Resolve your token CSS per theme in Chromium into a DTCG file (Pencil takes only hex and numbers). |
| `variants.mjs` | Read each component's prop types into variant axes and styled states. |
| `pen-sync.mjs` | Export components and push them through the CLI (`--all`, `--changed`, `--tokens`, `--headless`), `--check` (read-only, for CI). |
| `pen-diff.mjs` | Design → code: what a designer changed, per variant and layer. |
| `pen-inspect.mjs` | What the selected Pencil nodes are in code. |
| `pen-import.mjs` | Copy nodes from a design file into the library, for what no code renders yet. |
| `pen-library.mjs` | The library reference agents read before designing. |
| `polish-shots.mjs`, `polish-diff.mjs` | Storybook vs Pencil screenshots, ranked. |
| `variant-usage.mjs` | How often the apps use each variant; unused ones are candidates to delete. |

## Requirements

- **React components with Storybook** (8 or later). Stories render the variant matrix. Or,
  for anything else, [commands that describe your components](#components-that-dont-render-in-a-browser).
- **The pen.dev CLI**, logged in: `pen interactive` is how everything reaches Pencil. For CI,
  a CLI key in `PEN_CLI_KEY`, and `PEN_SYNC_PEN="bunx @pen.dev/cli@<version>"` if `pen` isn't
  on the runner's PATH.
- **Node 22.19+** and, in the repo's own dependencies, **Playwright** (Chromium). The plugin's
  other dependencies (`lz-string`, `pngjs`) are vendored in `vendor/`, so it runs straight from
  Claude Code's plugin cache.
- **TypeScript 5 or 6** for the bundled prop-type reader, or your own docgen module
  (`docgen` in the config).
- Token CSS that switches themes on `<html>` (a class or attribute), e.g. shadcn's `.dark`.
  Tailwind isn't required, but class names like `bg-primary` are how a paint finds its
  token when several share a value.

## Install

**The plugin** (skills and agent), in Claude Code:

```
/plugin marketplace add jhodges10/pen-sync
/plugin install pen-sync@pen-sync
```

To have everyone who opens a repo get it, add this to the repo's `.claude/settings.json`;
contributors are set up once they trust the folder. `ref` pins the release, so everyone runs
the same version until you bump it:

```json
{
  "extraKnownMarketplaces": {
    "pen-sync": {
      "source": { "source": "github", "repo": "jhodges10/pen-sync", "ref": "v0.3.0" }
    }
  },
  "enabledPlugins": { "pen-sync@pen-sync": true }
}
```

The skills call the scripts as `$DS` = `${CLAUDE_PLUGIN_ROOT}/scripts`. Set a repo up with:

```bash
node ~/.claude/plugins/cache/pen-sync/pen-sync/*/scripts/init.mjs --package packages/ui
```

**Outside Claude Code** (a Makefile, CI, other editors), run the scripts from a checkout of
the same tag. A small launcher can use Claude Code's install when its version matches the
pinned `ref` and download the tag otherwise; [`templates/pen-sync.sh`](templates/pen-sync.sh) is
one to copy into the repo:

```bash
scripts/pen-sync variants --check     # = node <plugin>/scripts/variants.mjs --check
```

`init` writes `pen-sync.config.json`, copies the React kit into the package and creates the
`.pen` file with a board per level.

## Components that don't render in a browser

A native toolkit has no Storybook, DOM or CSS. Name commands in `source` instead, and everything
after the snapshot (conversion, binding, push, `--check`, `pen-diff`, polish) runs unchanged:

```json
"source": {
  "snapshot": "bin/app --ds-snapshot {id} {theme} {out}",
  "tokens": "bin/app --ds-tokens {theme} {out}",
  "shots": "bin/app --ds-shots {id} {theme} {out}"
}
```

Each runs from the repo root, without a shell. Playwright and TypeScript aren't needed, and
`node init.mjs --source` sets a repo up with only the registry.

| Command | Writes to `{out}` |
| --- | --- |
| `snapshot` | `{ instances: [{ key, row, tree }], matrix: { rows: [{ vary }], slots }, surfaces }`. A `tree` is what `snapshotMatrix` records: `kind` `element` (box, `direction`, `gap`, `padding`, `justify`, `align`, `bg`, `gradient`, `border`, `radius`, `shadows`, `children`), `text`, or `svg`. An `svg` may give its document as `source` with a tint `color`. Sizing the layout can't show goes in `cls` as class names: `w-full`, `w-fixed`, `flex-1`. Capture animations at their end state. |
| `tokens` | `{ tokens: { name: { type, value } }, typography }`, values finished: `#rrggbb[aa]`, `6px`. |
| `shots` | Folder: a 2x PNG per variant, named by `polishName`, plus `storybook.json` (`{ key: { file, width, height, backdrop } }`). |

A registry entry's `call` (`w.button`) replaces the JSX in its Pencil context, `@import("x.zig")`
counts toward the source hash, and `variants.mjs` and `variant-usage.mjs` don't apply: the
source declares its own variants. Without class names, ties between tokens of the same value are
settled by `aliasOrder` alone, so order it carefully.

## Bringing in what no code renders yet

When the library should hold things with no component behind them yet, `pen-import.mjs` copies
them from a design file:

```bash
node $DS/pen-import.mjs --from design/app.pen --list import.json --headless
```

`import.json` is `[{ id, level, group }]`: a source node, its board and its heading. The script
follows what those nodes reference (other components and variables), rewrites instances and
overrides to the new ids, and gives a node that fills its parent a frame of its original size.
Copies are tagged `<prefix>-design`, a re-import replaces them, and a sync ignores them. Edit
them in the source file, not the library. `boards` in the config sets the boards `init.mjs` creates.

## Make a component mirrorable

1. Add it to `src/design-system/registry.json`: a permanent kebab-case `id`, `name`, `level`
   (atom, molecule, organism, template), `file`.
2. Stamp `data-ds="<id>"` on the element that is the component.
3. Add its `VariantMatrix` story, last in the story file:

   ```tsx
   const matrix: ComponentMatrix = { id: "button" };   // default: every axis, then every state

   export const VariantMatrix: Story = {
     tags: ["ds-matrix"],
     ...variantMatrixStory(Button, matrix),
   };
   ```

   A matrix only needs more than `id` for its exceptions: `ignore` (an axis left out, with a
   reason), `rows` (when the default is wrong: crossed axes, a brand surface, sample content),
   `extraRows`, `overrides`, `slots`.
4. `node $DS/variants.mjs`, then `node $DS/pen-sync.mjs button`.

## Everyday commands

```bash
node $DS/pen-sync.mjs --all --changed        # push what changed into the open app
node $DS/pen-sync.mjs --all --headless       # rewrite the .pen file on disk (CI, no app)
node $DS/pen-sync.mjs --tokens               # token variables
node $DS/pen-sync.mjs --check                # missing / stale / orphaned, read-only
node $DS/pen-diff.mjs button                 # what a designer changed
node $DS/pen-inspect.mjs                     # what the selection is in code
node $DS/variant-usage.mjs                   # variants nothing uses
```

Pushes are idempotent. A re-sync replaces each component's section and re-points every
instance a designer placed to the new component with the same variant key, so their screens
keep working. An instance whose variant no longer exists is reported as an orphan, and its
old section is kept rather than deleted.

## Screens from stories

Any story (a page, a panel, a dialog) can become a screen in an app's design file, built from the
library's components:

```bash
node $DS/export-screen.mjs orders-paymentslayout--invoiced --to design/app/orders.pen
node $DS/export-screen.mjs <story id> --to design/app/orders.pen --headless --width 1440
node $DS/export-screen.mjs <story id> --json        # the node and its report, nothing pushed
```

The story renders under every theme, like a matrix. Each element with `data-ds` becomes an
instance of that component's closest library variant: its data attributes (`data-variant`,
`data-size`) pick among the variants, and the one needing the fewest overrides wins, a restyled
paint counting more than a size or a label. What differs is overridden by layer, a layer the
element lacks is hidden, and a slot takes the element's content, whose own components become
instances too. An element no variant fits is drawn, and the summary lists those by component.
Everything else is drawn as a synced component's layers are, bound to the token variables.

The target file imports the library (a headless run adds the import) and gets the token
variables. Exporting a story again replaces its screen in place (`<prefix>-screen` metadata);
a new one goes to the right of the last. Icons use a name the running Pencil knows: Lucide keeps
renamed icons' old names as aliases, and each is checked in Pencil once.

A screen is a picture of the code: change it by changing the story or the components, then
export it again.

## How it works

- **Export:** headless Chromium renders the VariantMatrix story under every theme, snapshots
  each instance's DOM and layout, and converts it to Pencil nodes. Flex becomes auto-layout,
  `ml-auto` a fill, and wrapping rows become lines. Each paint binds to the token variable that
  matches it in every theme, with the element's classes breaking ties. Variants share a base
  component and override only what differs.
- **Fonts:** a text binds to the font variable whose family matches in every theme. A font
  loader that generates face names (next/font's `font-3319ae`) and passes them in a CSS
  variable needs config `fonts`, mapping each variable to the family the design file knows
  (`{ "--font-brand": "Brand Sans" }`). The token export then resolves `var(--font-brand)`
  chains, and the component export records `Brand Sans` where the page drew the generated
  face. The design file still needs those faces in its own fonts.
- **Push:** `pen-sync.mjs` drives `pen interactive`, connected to the desktop app (`-a
  desktop`) or headless on the file. It stores the apply step once and sends one `execute`
  per component.
- **Ids:** Pencil node ids are random, so the join key is in each node's `metadata` (registry
  id, variant, source hash) and `context` (JSX, source, story, variant key).

Without the CLI, `pencil-chunks.mjs` can still get payloads in through Pencil's integrated
browser and the MCP `execute` tool; see the pen-sync skill.

## Releases

Versions follow [Conventional Commits](https://www.conventionalcommits.org/): every push to
`main` runs the tests, then commitizen bumps the version from the commits since the last tag
(`fix` → patch, `feat` → minor; breaking changes bump the minor until 1.0), updates
`CHANGELOG.md`, `plugin.json` and `package.json`, tags `vX.Y.Z` and publishes a GitHub
Release. Pull requests check every commit message.

## Known gaps

These come from Pencil's model, and the polish skill lists them: dashed borders draw solid, a
shadow's spread isn't drawn, `::before`/`::after` marks are missing, and empty slot frames make
Pencil warn about collapsed sizes.
