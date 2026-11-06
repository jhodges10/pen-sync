/**
 * A repo whose components don't render in a browser (a native toolkit, say)
 * names commands in `pen-sync.config.json` → source instead of a Storybook:
 *
 *   "source": {
 *     "snapshot": "bin/app --ds-snapshot {id} {theme} {out}",
 *     "tokens": "bin/app --ds-tokens {theme} {out}",
 *     "shots": "bin/app --ds-shots {id} {theme} {out}"
 *   }
 *
 * Each runs from the repo root, without a shell, and writes its result to
 * `{out}`; the JSON shapes are in `pen-sync.config.schema.json` and the README.
 * `snapshot` gives what `snapshotMatrix` gives from a page, so the conversion,
 * the binding and the push are the same code either way. An `svg` node may carry
 * its document as `source` rather than `shapes`: `expandIcons` reads it here.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * A template and its values → argv. It splits first, so a value with a space
 * or a shell metacharacter stays one argument.
 */
export function commandLine(template, values) {
  return template
    .trim()
    .split(/\s+/)
    .map((word) =>
      word.replace(/\{(\w+)\}/g, (hole, name) => {
        if (!(name in values)) throw new Error(`source command: unknown ${hole} in "${template}"`);
        return values[name];
      }),
    );
}

/** Runs one source command; returns the JSON it wrote to `{out}`. */
export function runForJson(template, values, repo) {
  const dir = mkdtempSync(join(tmpdir(), "pen-sync-source-"));
  const out = join(dir, "out.json");
  try {
    const [command, ...args] = commandLine(template, { ...values, out });
    execFileSync(command, args, { cwd: repo, stdio: ["ignore", "ignore", "inherit"] });
    return JSON.parse(readFileSync(out, "utf8"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs a source command that writes files of its own (`shots`). */
export function runForFiles(template, values, repo) {
  const [command, ...args] = commandLine(template, values);
  execFileSync(command, args, { cwd: repo, stdio: ["ignore", "ignore", "inherit"] });
}

const attributesOf = (tag) =>
  Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );

/** One shape element → a path's `d`, as `snapshotMatrix`'s `shapeD` reads it. */
function shapePath(name, a) {
  const n = (key) => Number(a[key] ?? 0);
  switch (name) {
    case "path":
      return a.d ?? null;
    case "line":
      return `M${n("x1")} ${n("y1")}L${n("x2")} ${n("y2")}`;
    case "polyline":
    case "polygon": {
      const v = (a.points ?? "").match(/-?\d*\.?\d+/g) ?? [];
      const pairs = [];
      for (let i = 0; i + 1 < v.length; i += 2) pairs.push(`${v[i]} ${v[i + 1]}`);
      return `M${pairs.join("L")}${name === "polygon" ? "Z" : ""}`;
    }
    case "circle": {
      const [cx, cy, r] = [n("cx"), n("cy"), n("r")];
      return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
    }
    case "rect":
      return `M${n("x")} ${n("y")}h${n("width")}v${n("height")}h${-n("width")}Z`;
    default:
      return null;
  }
}

/**
 * An SVG document → `{ viewBox, shapes }` at `width` points, with every paint
 * in `color` (a monochrome icon, tinted as it's drawn). Attributes inherit
 * from the root and any enclosing group. A document it can't read has no
 * shapes, and the caller reports that.
 */
export function shapesFromSvg(source, width, color) {
  const root = source.match(/<svg\b[^>]*>/i)?.[0];
  if (!root) return { viewBox: [0, 0, width, width], shapes: [] };
  const rootAttrs = attributesOf(root);
  const box = (rootAttrs.viewBox ?? "").trim().split(/[\s,]+/).map(Number);
  const viewBox =
    box.length === 4 && box.every(Number.isFinite)
      ? box
      : [0, 0, Number.parseFloat(rootAttrs.width) || width, Number.parseFloat(rootAttrs.height) || width];
  const scale = width / viewBox[2];
  const stack = [rootAttrs];
  const shapes = [];
  const body = source.slice(source.indexOf(root) + root.length);
  for (const match of body.matchAll(/<(\/?)([a-z]+)\b([^>]*?)(\/?)>/gi)) {
    const [, closing, name, attrs, selfClosed] = match;
    const lower = name.toLowerCase();
    if (lower === "g") {
      if (closing) stack.pop();
      else if (!selfClosed) stack.push({ ...stack.at(-1), ...attributesOf(`<g ${attrs}>`) });
      continue;
    }
    if (closing) continue;
    const a = { ...stack.at(-1), ...attributesOf(`<${name} ${attrs}>`) };
    const d = shapePath(lower, a);
    if (!d) continue;
    const painted = (paint, fallback) => ((paint ?? fallback) === "none" ? null : color);
    const stroke = painted(a.stroke, "none");
    shapes.push({
      d,
      stroke,
      strokeWidth: stroke ? Math.round(Number(a["stroke-width"] ?? 1) * scale * 100) / 100 : 0,
      fill: painted(a.fill, "#000"),
      cap: a["stroke-linecap"] ?? "butt",
      join: a["stroke-linejoin"] ?? "miter",
    });
  }
  return { viewBox, shapes };
}

/** A snapshot tree with each `svg` node's `source` read into shapes. */
export function expandIcons(node) {
  if (node.kind === "svg" && node.source != null) {
    const { source, color, ...rest } = node;
    return { ...rest, ...shapesFromSvg(source, node.w, color) };
  }
  return node.children ? { ...node, children: node.children.map(expandIcons) } : node;
}

/** The checked snapshot of one component under one theme. */
export function snapshotOf(template, id, theme, repo) {
  const snapshot = runForJson(template, { id, theme }, repo);
  if (!Array.isArray(snapshot.instances))
    throw new Error(`source.snapshot for ${id} wrote no instances`);
  return {
    surfaces: {},
    ...snapshot,
    instances: snapshot.instances.map((instance) => ({
      ...instance,
      tree: expandIcons(instance.tree),
    })),
  };
}

/**
 * `source.tokens` per theme → what `buildDocument` takes. A command gives
 * finished values: `{ tokens: { name: { type, value } }, typography: { role } }`.
 */
export function tokensOf(perTheme) {
  const resolved = {};
  const roles = {};
  for (const [theme, { tokens = {}, typography = {} }] of Object.entries(perTheme)) {
    for (const [name, { type, value }] of Object.entries(tokens)) {
      resolved[name] ??= { type, values: {} };
      resolved[name].values[theme] = value;
    }
    for (const [role, values] of Object.entries(typography)) {
      roles[role] ??= {};
      roles[role][theme] = values;
    }
  }
  return { resolved, roles };
}
