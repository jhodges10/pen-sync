/**
 * Export a component's VariantMatrix story as Pencil components.
 *
 *   node $DS/export-matrix.mjs checkbox            # JSON export
 *   node $DS/export-matrix.mjs checkbox --pencil   # execute snippet
 *   node $DS/export-matrix.mjs --pencil-apply      # store the apply step in Pencil once
 *   node $DS/export-matrix.mjs checkbox --pencil-data  # then just the data
 *
 * Renders the story (tagged `ds-matrix` in the component's story file) in
 * headless Chromium under each Storybook theme, snapshots every instance and
 * converts it with `dom-to-pen.mjs`. The snippet is one Pencil `execute`
 * call. `--storybook <url>` points at another Storybook (default
 * `pen-sync.config.json` → storybook, which must be running). With
 * `pen-sync.config.json` → source, a command writes the snapshots instead.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { toPencilVariables, themeTuple } from "./pencil-variables.mjs";
import {
  config,
  globalsParam,
  packageRoot,
  registryPath,
  repo,
  source,
  storyThemes,
} from "./config.mjs";
import {
  PENCIL_APPLY,
  buildExport,
  pencilSnippet,
  snapshotMatrix,
  variableIndex,
} from "./dom-to-pen.mjs";
import {
  matrixFile,
  storiesFile,
  storyExport,
  storyIdSuffix,
} from "./matrix-files.mjs";
import { EXT } from "./tokens-lib.mjs";
import { themeReady } from "./themes.mjs";
import { sourceHash } from "./source-hash.mjs";
import { snapshotOf } from "./source-command.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
if (args.includes("--pencil-apply")) {
  console.log(
    `dsApply=${JSON.stringify(PENCIL_APPLY)};Print("stored",dsApply.length)`,
  );
  process.exit(0);
}
const [id] = args;
if (!id || id.startsWith("--")) {
  throw new Error(
    "usage: export-matrix.mjs <registry id> [--pencil] [--storybook url]",
  );
}
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const component = registry.components.find((c) => c.id === id);
if (!component) throw new Error(`No registry entry "${id}"`);

const doc = JSON.parse(readFileSync(join(repo, config.tokens), "utf8"));
// The themes stories render in, with their Pencil theme from the token file.
const themes = storyThemes.map((theme) => ({
  ...theme,
  pencil:
    doc.$extensions[EXT].themes.find((t) => t.key === theme.key)?.pencil ??
    theme.pencil,
}));
const vars = variableIndex(
  toPencilVariables(doc).variables,
  themes,
  config.aliasOrder,
);

/** Renders the matrix story in Chromium, under each theme. */
async function storybookSnapshots() {
  const { chromium } = createRequire(join(repo, config.playwright))("playwright");
  const storyFile = storiesFile(component);
  const selector = component.selector ?? `[data-ds="${id}"]`;
  const storybook = (flag("--storybook") ?? config.storybook).replace(/\/$/, "");

  const index = await (await fetch(`${storybook}/index.json`)).json();
  const story = Object.values(index.entries).find(
    (e) =>
      e.type === "story" &&
      e.tags?.includes("ds-matrix") &&
      e.importPath.endsWith(`${config.package}/${storyFile}`) &&
      e.id.endsWith(`--${storyIdSuffix(component)}`),
  );
  if (!story)
    throw new Error(
      `${storyFile} has no ds-matrix ${storyExport(component)} story`,
    );

  const browser = await chromium.launch();
  const snapshots = {};
  try {
    const page = await browser.newPage({
      viewport: { width: 1600, height: 1200 },
    });
    for (const theme of themes) {
      await page.goto(
        `${storybook}/iframe.html?id=${story.id}&viewMode=story&globals=${globalsParam(theme.storybook)}`,
      );
      await page.waitForSelector(`[data-ds-variant] ${selector}`);
      await page.waitForFunction(themeReady, {
        html: theme.html,
        others: config.themes.map((t) => t.html),
      });
      // Settle entrance animations (the checkmark draws in) at their end state.
      await page.evaluate(async () => {
        await document.fonts.ready;
        // A looping one (a spinner, a skeleton pulse) has no end: hold its first frame.
        for (const animation of document.getAnimations()) {
          if (animation.effect?.getComputedTiming().endTime === Infinity) {
            animation.pause();
            animation.currentTime = 0;
          } else animation.finish();
        }
        await new Promise((r) => setTimeout(r, 50));
      });
      snapshots[theme.key] = await page.evaluate(snapshotMatrix, { id, selector });
    }
  } finally {
    await browser.close();
  }

  return { story: story.id, snapshots };
}

const { story, snapshots } = source
  ? {
      story: `native:${id}`,
      snapshots: Object.fromEntries(
        themes.map((theme) => [theme.key, snapshotOf(source.snapshot, id, theme.key, repo)]),
      ),
    }
  : await storybookSnapshots();

// The story renders its matrix into the page (`data-ds-matrix`); an older story
// that doesn't keeps it in `<id>.matrix.ts`.
const matrix =
  snapshots[themes[0].key].matrix ??
  (await import(join(packageRoot, matrixFile(component)))).default;

const exported = {
  level: component.level,
  ...buildExport({
    id,
    name: component.name,
    story,
    call: component.call,
    source: component.file,
    sourceHash: sourceHash(component.file),
    snapshots,
    index: vars,
    slots: matrix.slots,
    rows: matrix.rows,
    packagePath: config.package,
    metadataPrefix: config.metadataPrefix,
  }),
};

const tuples = Object.fromEntries(themes.map((t) => [t.key, themeTuple(t)]));
const snippetOptions = {
  prefix: config.metadataPrefix,
  chrome: config.chrome,
  theme: themeTuple(config.themes[0]),
};
if (args.includes("--pencil")) {
  console.log(pencilSnippet(exported, tuples, snippetOptions));
} else if (args.includes("--pencil-data")) {
  const [data] = pencilSnippet(exported, tuples, snippetOptions).split("\n");
  console.log(`${data}eval(dsApply);`);
} else {
  console.log(JSON.stringify(exported, null, 2));
}
console.error(
  `${exported.components.length} components; bound ${JSON.stringify({ ...exported.report, warnings: exported.report.warnings.length })}`,
);
for (const warning of new Set(exported.report.warnings))
  console.error(`  ${warning}`);
