/**
 * Storybook's side of a polish pass: one PNG per VariantMatrix instance, as the
 * code renders it, to compare with Pencil's export of the same component.
 *
 *   node $DS/polish-shots.mjs card            # → <polishDir>/card/storybook/
 *   node $DS/polish-shots.mjs card --out dir --theme dark
 *
 * Files are named by variant key (`polishName`), and `storybook.json` lists
 * key → { file, width, height } in CSS pixels. Shots are at 2× to match
 * Pencil's default export scale. Needs the Storybook in `pen-sync.config.json`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import {
  config,
  globalsParam,
  packageRoot,
  registryPath,
  repo,
  storyThemes,
} from "./config.mjs";
import { matrixFile, storiesFile, storyIdSuffix } from "./matrix-files.mjs";
import { polishName } from "./polish-diff.mjs";

const { chromium } = createRequire(join(repo, config.playwright))("playwright");

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const [id] = args;
if (!id || id.startsWith("--"))
  throw new Error(
    "usage: polish-shots.mjs <registry id> [--out dir] [--theme <theme key>]",
  );
const out = flag("--out") ?? `${config.polishDir}/${id}/storybook`;
const themeKey = flag("--theme") ?? storyThemes[0].key;
const storybook = (flag("--storybook") ?? config.storybook).replace(/\/$/, "");

const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const component = registry.components.find((c) => c.id === id);
if (!component) throw new Error(`No registry entry "${id}"`);
const selector = component.selector ?? `[data-ds="${id}"]`;
// Pencil draws a slot as an empty frame, so the slot is hidden here (keeping
// its space): it then scores as the frame's outline, not as missing content.
const index = await (await fetch(`${storybook}/index.json`)).json();
const story = Object.values(index.entries).find(
  (e) =>
    e.type === "story" &&
    e.tags?.includes("ds-matrix") &&
    e.importPath.endsWith(`${config.package}/${storiesFile(component)}`) &&
    e.id.endsWith(`--${storyIdSuffix(component)}`),
);
if (!story) throw new Error(`${id} has no ds-matrix story`);
const theme = storyThemes.find((t) => t.key === themeKey);
if (!theme) throw new Error(`Unknown theme ${themeKey}`);

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const shots = {};
try {
  const page = await browser.newPage({
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 2,
  });
  await page.goto(
    `${storybook}/iframe.html?id=${story.id}&viewMode=story&globals=${globalsParam(theme.storybook)}`,
  );
  await page.waitForSelector(`[data-ds-variant] ${selector}`);
  // The matrix the story renders (`data-ds-matrix`), or an older story's file.
  const embedded = await page.evaluate(() =>
    document.querySelector("[data-ds-matrix]")?.getAttribute("data-ds-matrix"),
  );
  const matrix = embedded
    ? JSON.parse(embedded)
    : (await import(join(packageRoot, matrixFile(component)))).default;
  const slotParts = Object.keys(matrix.slots ?? {});
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getComputedTiming().endTime === Infinity) {
        animation.pause();
        animation.currentTime = 0;
      } else animation.finish();
    }
    await new Promise((r) => setTimeout(r, 50));
  });
  await page.evaluate((parts) => {
    for (const part of parts)
      for (const el of document.querySelectorAll(
        `[data-ds-variant] [data-slot="${part}"]`,
      ))
        el.style.visibility = "hidden";
  }, slotParts);
  // A story that starts editing selects the text; the selection is the
  // browser's, not the component's, and Pencil has none.
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active && typeof active.setSelectionRange === "function")
      try {
        active.setSelectionRange(active.value.length, active.value.length);
      } catch {}
    document.getSelection()?.removeAllRanges();
  });
  const wrappers = await page.$$("[data-ds-variant]");
  for (const wrapper of wrappers) {
    const key = await wrapper.getAttribute("data-ds-variant");
    // The same element the exporter mirrors.
    const el =
      (await wrapper.$("[data-ds-capture]")) ??
      ((await wrapper.evaluate((w, s) => w.matches(s), selector))
        ? wrapper
        : await wrapper.$(selector));
    if (!el) continue;
    const box = await el.boundingBox();
    if (!box) continue;
    const file = `${polishName(key)}.png`;
    // Pencil draws overflowing children (a slider's thumb past its track), so
    // the shot covers them too: the element's box grown to its descendants'.
    const drawn = await el.evaluate((node) => {
      const r = node.getBoundingClientRect();
      const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      const out = { ...box };
      const clips = (style) => style.overflowX !== "visible" || style.overflowY !== "visible";
      // Only what can show: each child cut to every clipping ancestor's box.
      const walk = (el, clip) => {
        for (const child of el.children) {
          const style = getComputedStyle(child);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const c = child.getBoundingClientRect();
          const seen = {
            left: Math.max(c.left, clip.left),
            top: Math.max(c.top, clip.top),
            right: Math.min(c.right, clip.right),
            bottom: Math.min(c.bottom, clip.bottom),
          };
          if (c.width && c.height && seen.right > seen.left && seen.bottom > seen.top) {
            out.left = Math.min(out.left, seen.left);
            out.top = Math.min(out.top, seen.top);
            out.right = Math.max(out.right, seen.right);
            out.bottom = Math.max(out.bottom, seen.bottom);
          }
          walk(child, clips(style) ? seen : clip);
        }
      };
      const open = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
      walk(node, clips(getComputedStyle(node)) ? box : open);
      return { x: out.left, y: out.top, width: out.right - out.left, height: out.bottom - out.top };
    });
    const grown = drawn.width - box.width > 1 || drawn.height - box.height > 1;
    if (grown)
      await page.screenshot({ path: join(out, file), clip: drawn, animations: "disabled" });
    else await el.screenshot({ path: join(out, file), animations: "disabled" });
    // The screenshot flattens translucent paint onto whatever is behind it (a
    // brand surface); the diff composites Pencil's export over the same color.
    const backdrop = await el.evaluate((node) => {
      const probe = document.createElement("canvas").getContext("2d");
      for (let n = node.parentElement; n; n = n.parentElement) {
        probe.clearRect(0, 0, 1, 1);
        probe.fillStyle = getComputedStyle(n).backgroundColor;
        probe.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
        if (a === 255) return [r, g, b];
      }
      return [255, 255, 255];
    });
    shots[key] = {
      file,
      width: Math.round(box.width),
      height: Math.round(box.height),
      ...(backdrop.every((c) => c === 255) ? {} : { backdrop }),
    };
  }
} finally {
  await browser.close();
}
writeFileSync(
  join(out, "storybook.json"),
  `${JSON.stringify(shots, null, 2)}\n`,
);
console.error(`${Object.keys(shots).length} shots → ${out}`);
