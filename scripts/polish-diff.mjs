/**
 * Ranks how far each Pencil component drifts from its Storybook render, so a
 * polish pass looks at the worst first.
 *
 *   node $DS/polish-diff.mjs card     # reads <polishDir>/card/
 *
 * Expects `storybook/` from polish-shots.mjs and `pencil/` holding Pencil's
 * 2× exports, one folder per variant (`--pencil-export <id…>` prints the
 * snippet that writes them). Prints one row per variant,
 * worst first: size delta in CSS px, the mean per-channel difference (0–255)
 * at the best alignment, and the share of Storybook's ink Pencil leaves blank;
 * rows past any threshold are flagged.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { config, metaType } from "./config.mjs";
import { isMain } from "./main.mjs";

/** A variant key as a file name: `disabled&variant=outline` → `disabled__variant-outline`. */
export const polishName = (key) =>
  key
    ? key
        .replace(/&/g, "__")
        .replace(/=/g, "-")
        .replace(/[^\w.-]/g, "_")
    : "default";

const WHITE = [255, 255, 255];
/** One channel of a pixel composited over the backdrop's same channel. */
const over = (value, alpha, under) => (value * alpha + under * (255 - alpha)) / 255;

/**
 * Mean absolute channel difference over the overlap of two decoded PNGs, with
 * `b` read `dx`/`dy` pixels further right and down than `a`.
 */
export function meanDifference(
  a,
  b,
  dx = 0,
  dy = 0,
  stride = 1,
  backdrop = WHITE,
) {
  const x0 = Math.max(0, -dx);
  const y0 = Math.max(0, -dy);
  const width = Math.min(a.width, b.width - dx);
  const height = Math.min(a.height, b.height - dy);
  if (width - x0 <= 0 || height - y0 <= 0) return 255;
  let total = 0;
  let count = 0;
  for (let y = y0; y < height; y += stride) {
    for (let x = x0; x < width; x += stride) {
      count += 1;
      const i = (y * a.width + x) * 4;
      const j = ((y + dy) * b.width + x + dx) * 4;
      // Both are composited over what the component sits on (the white card,
      // or a brand surface): Pencil keeps a translucent fill's alpha where a
      // browser screenshot has flattened it onto that backdrop.
      for (let c = 0; c < 3; c += 1) {
        const av = over(a.data[i + c], a.data[i + 3], backdrop[c]);
        const bv = over(b.data[j + c], b.data[j + 3], backdrop[c]);
        total += Math.abs(av - bv);
      }
    }
  }
  return total / (count * 3);
}

/**
 * Largest shadow Pencil's export may add around a component, in device pixels:
 * a sheet's `shadow-lg` grows it by about 140 across.
 */
export const MAX_BLEED = 192;
/** How far from a drawn pixel Pencil's ink may land and still count. */
export const SLACK = 2;
/** How far to search for the best alignment, in device pixels. */
export const NUDGE = 4;

/** Alpha below which a pixel is shadow, not paint. */
export const FAINT = 100;

/**
 * Whether every pixel outside the centred `width`×`height` part of `pen` is
 * faint: the extra size is a shadow, however it is split across the sides.
 */
export function faintMargin(pen, width, height) {
  const x0 = Math.floor((pen.width - width) / 2);
  const y0 = Math.floor((pen.height - height) / 2);
  for (let y = 0; y < pen.height; y += 1)
    for (let x = 0; x < pen.width; x += 1) {
      const inside = x >= x0 && x < x0 + width && y >= y0 && y < y0 + height;
      if (!inside && pen.data[(y * pen.width + x) * 4 + 3] >= FAINT) return false;
    }
  return true;
}

/**
 * Compares a Storybook shot with Pencil's export of the same variant. Pencil's
 * export grows by a drop shadow's extent on every side where a browser element
 * screenshot doesn't, so growth on both axes within MAX_BLEED is cropped away as
 * `bleed` rather than counted as a size change. Text that lands a pixel or two
 * apart scores high on its own, so the lowest difference within NUDGE pixels of
 * that alignment is the one reported.
 */
export function compare(shot, pen, backdrop = WHITE) {
  const bx = pen.width - shot.width;
  const by = pen.height - shot.height;
  // Growth on both axes is a shadow's; on one axis (a popup whose shadow falls
  // inside the shot's own blank area below) only when what grew is faint.
  const bleed =
    bx >= 0 &&
    by >= 0 &&
    bx + by > 0 &&
    bx <= MAX_BLEED &&
    by <= MAX_BLEED &&
    ((bx > 0 && by > 0) || faintMargin(pen, shot.width, shot.height));
  // A shadow offset downward bleeds more below than above, so the component
  // can sit anywhere in the bleed: a coarse search over a sampled grid, then
  // a fine one around the best place.
  const best = (xs, ys, stride) => {
    let found = { diff: Infinity, at: [0, 0] };
    for (const oy of ys)
      for (const ox of xs) {
        const d = meanDifference(shot, pen, ox, oy, stride, backdrop);
        if (d < found.diff) found = { diff: d, at: [ox, oy] };
      }
    return found;
  };
  const range = (from, to, step) =>
    Array.from(
      { length: Math.floor((to - from) / step) + 1 },
      (_, i) => from + i * step,
    );
  const coarse = bleed
    ? best(range(0, bx, 4), range(0, by, 4), 3)
    : { at: [0, 0] };
  const [cx, cy] = coarse.at;
  const { diff, at } = best(
    range(cx - NUDGE, cx + NUDGE, 1),
    range(cy - NUDGE, cy + NUDGE, 1),
    1,
  );
  return {
    dw: bleed ? 0 : bx,
    dh: bleed ? 0 : by,
    bleed: bleed ? Math.max(bx, by) : 0,
    diff,
    missing: missingInk(shot, pen, ...at, backdrop),
  };
}

/**
 * The share of what Storybook draws (pixels well away from the backdrop) that
 * Pencil leaves blank. A mostly white component scores a low mean difference
 * even when its border and text are gone; this catches that.
 */
export function missingInk(shot, pen, dx = 0, dy = 0, backdrop = WHITE) {
  const ink = (img, i) =>
    Math.max(
      ...[0, 1, 2].map((c) =>
        Math.abs(backdrop[c] - over(img.data[i + c], img.data[i + 3], backdrop[c])),
      ),
    );
  let drawn = 0;
  let lost = 0;
  for (let y = 0; y < shot.height; y += 1) {
    for (let x = 0; x < shot.width; x += 1) {
      const i = (y * shot.width + x) * 4;
      if (ink(shot, i) < 64) continue;
      drawn += 1;
      // A pixel or two off (a 1px border, antialiased text) still counts as
      // drawn: lost means no ink anywhere within SLACK pixels.
      let found = false;
      for (let oy = -SLACK; oy <= SLACK && !found; oy += 1)
        for (let ox = -SLACK; ox <= SLACK && !found; ox += 1) {
          const px = x + dx + ox;
          const py = y + dy + oy;
          if (px < 0 || py < 0 || px >= pen.width || py >= pen.height) continue;
          if (ink(pen, (py * pen.width + px) * 4) >= 24) found = true;
        }
      if (!found) lost += 1;
    }
  }
  return drawn ? lost / drawn : 0;
}

/**
 * The Pencil `execute` snippet that exports one or more components' sections
 * at 2×: each variant into `<polishDir>/<id>/pencil/<polishName(key)>/`,
 * found by the `Variant:` line of its `context`, so no map has to be copied
 * back out of Pencil.
 */
export const pencilExport = (ids, dir = config.polishDir) =>
  `const IDS=${JSON.stringify(ids)},DIR=${JSON.stringify(dir)};const pn=${polishName.toString().replace(/^\(key\) =>/, "(key)=>")};const ck=(n)=>{const x=/\\nVariant: (.*)$/.exec(n.context||"");return x?(x[1]==="(default)"?"":x[1]):null};const secs={};Get((n)=>{const m=n.metadata;if(m&&m.type===${JSON.stringify(metaType.section)}&&IDS.includes(m.id))secs[m.id]=n.id;return undefined});const done={};for(const id of IDS){if(!secs[id]){done[id]="no section";continue}let c=0;Get(secs[id],(n)=>{const k=n.reusable?ck(n):null;if(k!==null){Export([n.id],"png",DIR+"/"+id+"/pencil/"+pn(k));c+=1}return undefined});done[id]=c}Print(JSON.stringify(done));`;

export const SIZE_TOLERANCE = 3;
export const DIFF_TOLERANCE = 12;
export const INK_TOLERANCE = 0.15;

if (isMain(import.meta.url)) {
  const { PNG } = (await import("../vendor/pngjs.mjs")).default;
  const [id] = process.argv.slice(2);
  if (!id)
    throw new Error(
      "usage: polish-diff.mjs <registry id> [--dir dir] | --pencil-export <id>",
    );
  if (id === "--pencil-export") {
    console.log(pencilExport(process.argv.slice(3)));
    process.exit(0);
  }
  const i = process.argv.indexOf("--dir");
  const dir = i === -1 ? `${config.polishDir}/${id}` : process.argv[i + 1];
  const shots = JSON.parse(
    readFileSync(join(dir, "storybook/storybook.json"), "utf8"),
  );
  const read = (file) => PNG.sync.read(readFileSync(file));
  // pencil/<polishName(key)>/<node id>.png, as pencilExport writes it.
  const exported = (key) => {
    const folder = join(dir, "pencil", polishName(key));
    if (!existsSync(folder)) return null;
    // A re-push gives the variant a new node; the newest export is current.
    const [png] = readdirSync(folder)
      .filter((f) => f.endsWith(".png"))
      .map((f) => ({ f, at: statSync(join(folder, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
      .map((x) => x.f);
    return png ? { node: png.slice(0, -4), file: join(folder, png) } : null;
  };
  const rows = Object.entries(shots).map(([key, shot]) => {
    const found = exported(key);
    const node = found?.node;
    const pencilFile = found?.file;
    if (!pencilFile || !existsSync(pencilFile))
      return { key, missing: true, score: Infinity };
    const sb = read(join(dir, "storybook", shot.file));
    const pen = read(pencilFile);
    // Both are 2× exports; sizes are reported in CSS pixels.
    const c = compare(sb, pen, shot.backdrop);
    const dw = Math.round(c.dw / 2);
    const dh = Math.round(c.dh / 2);
    const diff = Math.round(c.diff * 10) / 10;
    const lost = Math.round(c.missing * 100);
    const flag =
      Math.abs(dw) > SIZE_TOLERANCE ||
      Math.abs(dh) > SIZE_TOLERANCE ||
      diff > DIFF_TOLERANCE ||
      c.missing > INK_TOLERANCE;
    return {
      key,
      node,
      dw,
      dh,
      diff,
      flag,
      lost,
      bleed: c.bleed / 2,
      score: Math.abs(dw) + Math.abs(dh) + diff + lost,
    };
  });
  rows.sort((a, b) => b.score - a.score);
  for (const r of rows) {
    console.log(
      r.missing
        ? `MISSING  ${r.key || "default"}  (no Pencil export)`
        : `${r.flag ? "CHECK" : "ok   "}  Δw ${r.dw}  Δh ${r.dh}  diff ${r.diff}  lost ${r.lost}%${r.bleed ? `  (shadow +${r.bleed})` : ""}  ${r.key || "default"}  [${r.node}]`,
    );
  }
  const flagged = rows.filter((r) => r.flag || r.missing).length;
  console.error(`${flagged} of ${rows.length} to check`);
}
