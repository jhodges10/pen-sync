/**
 * Design → code: what a designer changed in Pencil, per component variant and
 * layer, against a fresh export of the same story.
 *
 *   node $DS/pen-diff.mjs button             # the open desktop app's file
 *   node $DS/pen-diff.mjs button --headless  # the .pen file on disk
 *   node $DS/pen-diff.mjs button --json
 *
 * Each variant is matched by the variant key its context records, each layer
 * by its name path (`Label`, `Container 2 › Icon`); an instance's overrides
 * are resolved through its base, so a recolored label in `Button/Outline` and
 * in its base both show up. Only design properties are compared (fills and
 * strokes as variables, radius, spacing, type), never sample text or measured
 * sizes, so a clean section reports nothing. The output is what to change in
 * the component's classes or cva, after which a re-sync replaces the section.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config, repo } from "./config.mjs";
import { call, openShell, parseResult } from "./pen-sync.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** Properties a designer changes on purpose; the rest follow the content. */
export const DESIGN_PROPS = [
  "fill",
  "stroke",
  "strokeWidth",
  "cornerRadius",
  "padding",
  "gap",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "opacity",
  "effect",
  "layout",
  "justifyContent",
  "alignItems",
];

/** Runs in Pencil: every component of a section, as JSON, keyed by variant. */
export const READ_SECTION = (prefix, id) =>
  `const ck=(n)=>{const x=/\\nVariant: (.*)$/.exec(n.context||"");return x?(x[1]==="(default)"?"":x[1]):null};` +
  `let sec=null;Get((n)=>{if(!sec&&n.metadata&&n.metadata.type===${JSON.stringify(`${prefix}-section`)}&&n.metadata.id===${JSON.stringify(id)})sec=n.id;return undefined});` +
  `const out={section:sec,components:{},bases:{}};if(sec)Get(sec,(n)=>{if(n.reusable){const k=ck(n);if(k!==null)out.components[k]=n;out.bases[n.id]=n}return undefined});` +
  `Print(JSON.stringify(out))`;

/**
 * `{ "Label": {fill:…}, "Container › Icon": {…} }` for a node tree: each layer
 * by its name path below the root ("" for the root), design props only.
 */
export function flatten(node, path = "", out = {}) {
  out[path] = Object.fromEntries(
    DESIGN_PROPS.filter((p) => node[p] !== undefined).map((p) => [p, node[p]]),
  );
  for (const child of node.children ?? []) {
    const name = child.name ?? child.type;
    flatten(child, path ? `${path} › ${name}` : name, out);
  }
  return out;
}

/** Layer name paths by node id, for resolving a Pencil instance's overrides. */
export function namesById(node, path = "", out = {}) {
  if (node.id) out[node.id] = path;
  for (const child of node.children ?? []) {
    const name = child.name ?? child.type;
    namesById(child, path ? `${path} › ${name}` : name, out);
  }
  return out;
}

/**
 * A component's layers with its overrides applied: a frame flattens as it is;
 * a ref takes its base's layers, then its own root props, then each
 * descendant override (keyed by node id in Pencil, by layer name in an export).
 */
export function resolve(node, bases, base = null) {
  if (node.type !== "ref") return flatten(node);
  const from = base ?? bases[node.ref];
  if (!from) return flatten(node);
  const layers = structuredClone(resolve(from, bases));
  const ids = from.type === "ref" ? {} : namesById(from);
  Object.assign(
    layers[""],
    Object.fromEntries(
      DESIGN_PROPS.filter((p) => node[p] !== undefined).map((p) => [p, node[p]]),
    ),
  );
  // Pencil keys an override by node id; an export, by the layer's own name.
  const pathOf = (key) =>
    ids[key] ??
    Object.keys(layers).find((p) => p === key || p.endsWith(` › ${key}`)) ??
    key;
  for (const [key, props] of Object.entries(node.descendants ?? {})) {
    const path = pathOf(key);
    layers[path] = {
      ...layers[path],
      ...Object.fromEntries(
        DESIGN_PROPS.filter((p) => props[p] !== undefined).map((p) => [p, props[p]]),
      ),
    };
  }
  return layers;
}

const SIDES = ["top", "right", "bottom", "left"];

/** Values Pencil fills in or drops on insert, so they mean "unset". */
const IMPLIED = {
  enabled: true,
  blur: 0,
  spread: 0,
  offset: { x: 0, y: 0 },
  size: { height: 1 },
};

/**
 * A value as Pencil stores it: a one-item list as its item, implied defaults
 * gone, keys sorted. Two values that differ only there are the same design.
 */
export function canonical(value) {
  if (Array.isArray(value))
    return value.length === 1 ? canonical(value[0]) : value.map(canonical);
  if (value && typeof value === "object") {
    // Per-side widths: Pencil keeps only the sides that are set.
    const sides = Object.keys(value).every((k) => SIDES.includes(k));
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((k) => !(sides && value[k] === 0))
        .filter((k) => !(k in IMPLIED && JSON.stringify(value[k]) === JSON.stringify(IMPLIED[k])))
        .map((k) => [k, canonical(value[k])]),
    );
  }
  return value;
}

const same = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/**
 * Differences between Pencil's components and the export's, per variant:
 * `[{ variant, layer, prop, code, pencil }]`, plus variants only one side has.
 */
export function diffSection(pencil, exported) {
  const changes = [];
  const exportedBases = Object.fromEntries(
    exported.components
      .filter((c) => c.base)
      .map((c) => [c.base, c.node]),
  );
  const codeOf = (c) =>
    resolve(c.node, {}, c.node.type === "ref" ? exportedBases[c.node.ref?.slice(1)] : null);
  const keys = new Set(exported.components.map((c) => c.key));
  for (const component of exported.components) {
    const theirs = pencil.components[component.key];
    if (!theirs) {
      changes.push({ variant: component.key, missing: "pencil" });
      continue;
    }
    const code = codeOf(component);
    const design = resolve(theirs, pencil.bases);
    // A layer added or removed is reported once, not again for each layer in it.
    const within = (layer, list) => list.some((p) => layer.startsWith(`${p} › `));
    const added = [];
    const removed = [];
    for (const layer of new Set([...Object.keys(code), ...Object.keys(design)])) {
      if (!(layer in design)) {
        if (!within(layer, removed)) {
          removed.push(layer);
          changes.push({ variant: component.key, layer, removed: true });
        }
        continue;
      }
      if (!(layer in code)) {
        if (!within(layer, added)) {
          added.push(layer);
          changes.push({ variant: component.key, layer, added: true });
        }
        continue;
      }
      for (const prop of DESIGN_PROPS) {
        const [a, b] = [code[layer][prop], design[layer][prop]];
        if (a !== undefined && b !== undefined && !same(a, b))
          changes.push({ variant: component.key, layer, prop, code: a, pencil: b });
      }
    }
  }
  for (const key of Object.keys(pencil.components))
    if (!keys.has(key)) changes.push({ variant: key, missing: "code" });
  return changes;
}

const show = (v) => (typeof v === "string" ? v : JSON.stringify(v));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const app = args.includes("--app") ? args[args.indexOf("--app") + 1] : "desktop";
  const ids = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--app");
  if (!ids.length) throw new Error("usage: pen-diff.mjs <id…> [--headless] [--app desktop] [--json]");
  const headless = args.includes("--headless");
  const pen = join(repo, config.pen);
  const shell = openShell(
    headless ? ["-i", pen, "-o", pen] : ["-a", app, "-i", pen],
  );
  await shell.ready;
  const all = {};
  try {
    for (const id of ids) {
      const exported = JSON.parse(
        execFileSync(process.execPath, [join(here, "export-matrix.mjs"), id], {
          cwd: repo,
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
          stdio: ["ignore", "pipe", "ignore"],
        }),
      );
      const result = parseResult(
        await shell.send(
          call("execute", {
            description: `Read the ${id} section`,
            input: READ_SECTION(config.metadataPrefix, id),
          }),
        ),
      );
      if (!result.ok) throw new Error(result.text);
      const pencil = JSON.parse(
        result.printed.split("\n").find((l) => l.startsWith("{")) ?? "{}",
      );
      if (!pencil.section) {
        all[id] = { error: "no section in Pencil" };
        continue;
      }
      const hashes = [
        ...new Set(
          Object.values(pencil.bases)
            .map((n) => n.metadata?.sourceHash)
            .filter(Boolean),
        ),
      ];
      const current = exported.components[0]?.node.metadata?.sourceHash;
      all[id] = Object.assign(diffSection(pencil, exported), {
        stale: Boolean(current && hashes.length && !hashes.includes(current)),
      });
    }
  } finally {
    await shell.close();
  }
  if (args.includes("--json")) console.log(JSON.stringify(all, null, 2));
  else
    for (const [id, changes] of Object.entries(all)) {
      if (changes.error) {
        console.log(`${id}: ${changes.error}`);
        continue;
      }
      console.log(
        `${id}: ${changes.length ? `${changes.length} difference(s)` : "matches the code"}` +
          (changes.stale
            ? " — the section predates the current source; re-sync it, then diff again to see only design changes"
            : ""),
      );
      for (const c of changes) {
        const where = `  ${c.variant || "(default)"}${c.layer ? ` › ${c.layer}` : ""}`;
        if (c.missing === "pencil") console.log(`${where}: not in Pencil`);
        else if (c.missing === "code") console.log(`${where}: only in Pencil (a variant the code doesn't render)`);
        else if (c.added) console.log(`${where}: layer added in Pencil`);
        else if (c.removed) console.log(`${where}: layer removed in Pencil`);
        else console.log(`${where}: ${c.prop} ${show(c.code)} → ${show(c.pencil)}`);
      }
    }
}
