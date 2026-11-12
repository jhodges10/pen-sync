/**
 * Export a story as a Pencil screen built from the library's components.
 *
 *   node $DS/export-screen.mjs <story id> --to design/app/orders.pen          # into the open app
 *   node $DS/export-screen.mjs <story id> --to design/app/orders.pen --headless
 *   node $DS/export-screen.mjs <story id> --json                               # the node, not pushed
 *
 * Renders the story (any story: a page, a panel, a dialog) in headless
 * Chromium under each Storybook theme and converts the whole render. Each
 * element with `data-ds` becomes an instance of the closest variant of that
 * library component (`screen.mjs`), overriding what differs; a slot takes the
 * element's content. Elements no component fits are drawn, bound to the token
 * variables like a synced component's layers.
 *
 * The target file must import the library (pen-sync.config.json → pen); a
 * headless run imports it when it doesn't. The screen replaces the one exported
 * from the same story before (`<prefix>-screen` metadata), in its place;
 * otherwise it goes to the right of the last screen. Options: `--name`,
 * `--selector` (default `#storybook-root`), `--width`/`--height` (the
 * viewport, default 1440×900), `--storybook`, `--app`, `--at x,y`.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

import { config, globalsParam, repo, storyThemes } from "./config.mjs";
import { convertInstance, snapshotMatrix, variableIndex } from "./dom-to-pen.mjs";
import { isMain } from "./main.mjs";
import { call, openShell, parseResult } from "./pen-sync.mjs";
import { toPencilVariables, toSnippets, themeTuple } from "./pencil-variables.mjs";
import { iconLists, knownIcons, pickNames, renameIcons } from "./icons.mjs";
import { instanceMatcher, libraryComponents } from "./screen.mjs";
import { themeReady } from "./themes.mjs";
import { EXT } from "./tokens-lib.mjs";

/**
 * The import alias a design file gives the library, from its `imports`
 * (`{ alias: relative path }`), or null when it doesn't import it.
 */
export function libraryAlias(target, library) {
  if (!existsSync(target)) return null;
  const { imports = {} } = JSON.parse(readFileSync(target, "utf8"));
  const want = resolve(library);
  for (const [alias, path] of Object.entries(imports))
    if (resolve(dirname(target), path) === want) return alias;
  return null;
}

/** Runs in Pencil: put the screen where the last export of the story was, or right of the last screen. */
export const SCREEN_APPLY = `const D=JSON.parse(DS);let old=null,last=null;
Get((n,c)=>{const m=n.metadata;if(!c.parentCtx&&m&&m.type===D.type){if(m.story===D.story&&!old)old=n;if(!last||n.x>last.x)last=n}return undefined});
const at=old?{x:old.x,y:old.y}:D.at?D.at:last?{x:last.x+(typeof last.width==="number"?last.width:1600)+200,y:last.y}:{x:0,y:0};
if(Object.keys(D.variables).length)SetVariables(D.variables);
const id=Insert(document,{...D.node,...at});if(old)Delete(old.id);
Print(JSON.stringify({screen:id,replaced:Boolean(old)}));`;

const flagOf = (args) => (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

async function main(args) {
  const flag = flagOf(args);
  const [storyId] = args;
  if (!storyId || storyId.startsWith("--"))
    throw new Error("usage: export-screen.mjs <story id> (--to <file.pen> [--headless] | --json) [--name …]");
  const toFlag = flag("--to");
  const target = toFlag ? resolve(toFlag) : null;
  const libraryPath = join(repo, config.pen);
  const headless = args.includes("--headless");

  const tokens = JSON.parse(readFileSync(join(repo, config.tokens), "utf8"));
  const themes = storyThemes.map((theme) => ({
    ...theme,
    pencil:
      tokens.$extensions[EXT].themes.find((t) => t.key === theme.key)?.pencil ?? theme.pencil,
  }));
  const variables = toPencilVariables(tokens).variables;
  const index = variableIndex(variables, themes, config.aliasOrder);

  // The alias the target gives the library; a headless run adds the import first.
  let alias = target ? libraryAlias(target, libraryPath) : "lib";
  if (target && !alias) {
    if (!headless)
      throw new Error(
        `${relative(repo, target)} doesn't import ${config.pen}: import it in Pencil, or run with --headless`,
      );
    const shell = openShell(["-i", target, "-o", target]);
    await shell.ready;
    await shell.send(call("import_library", { path: libraryPath }));
    await shell.send("save()");
    await shell.close();
    alias = libraryAlias(target, libraryPath);
    if (!alias) throw new Error(`importing ${config.pen} into ${relative(repo, target)} failed`);
  }
  const library = libraryComponents(JSON.parse(readFileSync(libraryPath, "utf8")), config.metadataPrefix);

  // Render the story under each theme.
  const { chromium } = createRequire(join(repo, config.playwright))("playwright");
  const storybook = (flag("--storybook") ?? config.storybook).replace(/\/$/, "");
  const entries = (await (await fetch(`${storybook}/index.json`)).json()).entries;
  const story = entries[storyId];
  if (!story) throw new Error(`Storybook has no story ${storyId}`);
  const selector = flag("--selector") ?? "#storybook-root";
  const browser = await chromium.launch();
  const trees = {};
  try {
    const page = await browser.newPage({
      viewport: { width: Number(flag("--width") ?? 1440), height: Number(flag("--height") ?? 900) },
    });
    for (const theme of themes) {
      await page.goto(
        `${storybook}/iframe.html?id=${storyId}&viewMode=story&globals=${globalsParam(theme.storybook)}`,
      );
      // Rendered: an element child with a size (Storybook puts a script there first).
      await page.waitForFunction(
        (sel) =>
          [...(document.querySelector(sel)?.children ?? [])].some(
            (el) => el.tagName !== "SCRIPT" && el.getBoundingClientRect().height > 0,
          ),
        selector,
      );
      await page.waitForFunction(themeReady, {
        html: theme.html,
        others: config.themes.map((t) => t.html),
      });
      await page.evaluate(async () => {
        // A story that focuses a control would draw its focus ring into the screen.
        document.activeElement?.blur?.();
        await document.fonts.ready;
        for (const animation of document.getAnimations()) {
          if (animation.effect?.getComputedTiming().endTime === Infinity) {
            animation.pause();
            animation.currentTime = 0;
          } else animation.finish();
        }
        await new Promise((r) => setTimeout(r, 300));
      });
      const snapshot = await page.evaluate(snapshotMatrix, {
        id: "screen",
        screen: selector,
        fontAliases: config.fonts,
      });
      if (!snapshot.screen) throw new Error(`${storyId}: nothing at ${selector}`);
      trees[theme.key] = snapshot.screen;
    }
  } finally {
    await browser.close();
  }

  const report = { class: 0, value: 0, alias: 0, literal: 0, scoped: 0, warnings: [] };
  const shapeOf = (n) =>
    n.kind === "element" ? `${n.tag}(${n.children.map(shapeOf).join(",")})` : n.kind;
  const [first] = index.themes;
  for (const t of index.themes)
    if (shapeOf(trees[t]) !== shapeOf(trees[first])) {
      report.warnings.push(`renders differently under ${t}; drew ${first}`);
      trees[t] = trees[first];
    }
  const slug = storyId.replace(/[^a-z0-9]+/gi, "-");
  // A paint the library already scoped to a component (`--ds-button-2`) reuses
  // that variable, with the same values, rather than minting one per screen.
  const scoped = { byValues: new Map(), variables: {} };
  const libVariables = JSON.parse(readFileSync(libraryPath, "utf8")).variables ?? {};
  const keyOf = (theme) => themes.find((t) => JSON.stringify(themeTuple(t)) === JSON.stringify(theme))?.key;
  const reuse = new Map();
  const canonical = new Map();
  for (const [name, def] of Object.entries(libVariables)) {
    if (!name.startsWith("--ds-") || def.type !== "color" || !Array.isArray(def.value)) continue;
    const values = Object.fromEntries(
      def.value.map((v) => [keyOf(v.theme), v.value]).filter(([k]) => k),
    );
    if (Object.keys(values).length !== themes.length) continue;
    const ordered = Object.fromEntries(index.themes.map((t) => [t, values[t]]));
    const signature = JSON.stringify(ordered);
    // Several library variables can share values: the first named keeps them all.
    if (!reuse.has(signature)) reuse.set(signature, name);
    canonical.set(`$${name}`, `$${reuse.get(signature)}`);
  }
  scoped.byValues = {
    get: (sig) => scopedMap.get(sig) ?? reuse.get(sig),
    set: (sig, name) => scopedMap.set(sig, name),
    get size() {
      return scopedMap.size;
    },
  };
  const scopedMap = new Map();
  const node = convertInstance(trees, {
    index,
    id: `screen-${slug}`,
    scoped,
    report,
    slots: {},
    instanceOf: instanceMatcher(library, { alias, report, same: (v) => canonical.get(v) ?? v }),
  });
  const name = flag("--name") ?? `${story.title.split("/").pop()} / ${story.name}`;
  const screen = {
    ...node,
    name,
    context: `Storybook: ${storyId}\n${story.importPath}`,
    metadata: { type: `${config.metadataPrefix}-screen`, story: storyId },
  };
  const tuples = Object.fromEntries(themes.map((t) => [t.key, themeTuple(t)]));
  const scopedVariables = Object.fromEntries(
    Object.entries(scoped.variables).map(([n, values]) => [
      n,
      {
        type: "color",
        value: Object.entries(values).map(([key, value]) => ({ value, theme: tuples[key] })),
      },
    ]),
  );
  // The library's scoped variables the screen reused go along with it.
  for (const name of new Set(JSON.stringify(screen).match(/\$--ds-[\w-]+/g) ?? [])) {
    const bare = name.slice(1);
    if (!(bare in scopedVariables) && libVariables[bare]) scopedVariables[bare] = libVariables[bare];
  }
  const instances = Object.values(report.instances).reduce((a, b) => a + b, 0);
  const drawn = Object.entries(report.drawn).sort((a, b) => b[1] - a[1]);
  const summary =
    `${name}: ${instances} instances of ${Object.keys(report.instances).length} components` +
    (drawn.length ? `; drawn by hand: ${drawn.map(([id, n]) => `${id}×${n}`).join(", ")}` : "");

  if (!target || args.includes("--json")) {
    console.log(JSON.stringify({ screen, variables: scopedVariables, report }, null, 2));
    console.error(summary);
    return;
  }
  const at = flag("--at")?.split(",").map(Number);
  const shell = openShell(headless ? ["-i", target, "-o", target] : ["-a", flag("--app") ?? "desktop", "-i", target]);
  await shell.ready;
  // Icons by a name this Pencil knows (Lucide keeps older names as aliases).
  const lists = iconLists(trees[first]);
  if (lists.length) renameIcons(screen, pickNames(lists, await knownIcons(shell, lists.flat())));
  const data = {
    type: `${config.metadataPrefix}-screen`,
    story: storyId,
    node: screen,
    variables: scopedVariables,
    ...(at ? { at: { x: at[0], y: at[1] } } : {}),
  };
  try {
    // The screen's layers bind to the token variables, so the file needs them.
    for (const snippet of toSnippets(tokens, 4)) {
      const result = parseResult(await shell.send(call("execute", { description: "Set token variables", input: snippet })));
      if (!result.ok) throw new Error(result.text);
    }
    const result = parseResult(
      await shell.send(
        call("execute", {
          description: `Export screen ${name}`,
          input: `const DS=${JSON.stringify(JSON.stringify(data))};${SCREEN_APPLY}`,
        }),
      ),
    );
    if (!result.ok) throw new Error(`${result.text}\n${shell.takeErrors()}`);
    if (headless || args.includes("--save")) await shell.send("save()");
    console.log(`✓ ${summary}`);
    for (const w of new Set(report.warnings)) console.error(`  ${w}`);
  } finally {
    await shell.close();
  }
}

if (isMain(import.meta.url)) await main(process.argv.slice(2));
