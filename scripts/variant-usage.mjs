/**
 * How often the code uses each variant of each registry component: JSX like
 * `<Button variant="ghost">` and cva calls like `buttonVariants({ size: "sm" })`
 * across `pen-sync.config.json` → usage (stories, tests and the component's own
 * file don't count). A value nothing uses is a candidate to remove from the
 * cva instead of mirroring it in Pencil.
 *
 *   node $DS/variant-usage.mjs               # unused values, per component
 *   node $DS/variant-usage.mjs button --all  # every value's count
 *   node $DS/variant-usage.mjs --json
 *
 * A prop set from an expression (`variant={tone}`) can't be counted statically;
 * it is reported as dynamic, and a component with dynamic uses of an axis
 * lists none of that axis's values as unused.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { config, packageRoot, registryPath, repo } from "./config.mjs";
import { isMain } from "./main.mjs";

const SOURCE = /\.(tsx|jsx|ts|js)$/;
const SKIP = /(\.stories|\.test|\.spec)\.[jt]sx?$|\/(node_modules|dist|build|generated|\.storybook)\//;

/** Every source file under `dir`, skipping stories, tests and build output. */
export function sourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const path = join(d, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (SOURCE.test(name) && !SKIP.test(`/${path}`)) out.push(path);
    }
  };
  walk(dir);
  return out;
}

/** The text of each `<Tag …>` opening tag in `source`, braces balanced. */
export function openingTags(source, tag) {
  const tags = [];
  const start = new RegExp(`<${tag}(?=[\\s/>])`, "g");
  for (let m = start.exec(source); m; m = start.exec(source)) {
    let depth = 0;
    let quote = null;
    let i = m.index + m[0].length;
    for (; i < source.length; i += 1) {
      const c = source[i];
      if (quote) {
        if (c === quote && source[i - 1] !== "\\") quote = null;
      } else if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
    }
    tags.push(source.slice(m.index + m[0].length, i));
  }
  return tags;
}

/**
 * The value each axis takes in one tag's attributes: a string, `true` for a
 * bare flag, `false` for `={false}`, or `DYNAMIC` for any other expression.
 */
export const DYNAMIC = Symbol("dynamic");
export function axisValues(attributes, axes) {
  const found = {};
  for (const axis of axes) {
    const name = axis.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(
      `(?:^|\\s)${name}(?:=("[^"]*"|'[^']*'|\\{[^}]*\\}))?(?=[\\s/]|$)`,
    ).exec(attributes);
    if (!m) continue;
    const raw = m[1];
    if (raw === undefined) found[axis] = true;
    else if (/^["']/.test(raw)) found[axis] = raw.slice(1, -1);
    else {
      const inner = raw.slice(1, -1).trim();
      const literal = /^(["'`])([^"'`$]*)\1$/.exec(inner);
      if (literal) found[axis] = literal[2];
      else if (inner === "true" || inner === "false") found[axis] = inner === "true";
      else found[axis] = DYNAMIC;
    }
  }
  return found;
}

/** `{ size: "sm", variant: "ghost" }` pairs inside each `fnName({ … })` call. */
export function cvaCalls(source, fnName, axes) {
  const calls = [];
  const start = new RegExp(`\\b${fnName}\\(\\s*\\{`, "g");
  for (let m = start.exec(source); m; m = start.exec(source)) {
    const end = source.indexOf("}", m.index);
    const body = source.slice(m.index + m[0].length, end);
    const found = {};
    for (const axis of axes) {
      const hit = new RegExp(`(?:^|[\\s,{])["']?${axis}["']?\\s*:\\s*([^,}]+)`).exec(body);
      // `{ size }` passes a variable through: set, but not knowably to what.
      if (!hit) {
        if (new RegExp(`(?:^|[\\s,{])${axis}\\s*(?=[,}]|$)`).test(body))
          found[axis] = DYNAMIC;
        continue;
      }
      const literal = /^(["'`])([^"'`$]*)\1$/.exec(hit[1].trim());
      found[axis] = literal ? literal[2] : DYNAMIC;
    }
    calls.push(found);
  }
  return calls;
}

/** Usage per component: `{ uses, axes: { axis: { counts: {value: n}, dynamic } } }`. */
export function countUsage(components, variants, files, read = (f) => readFileSync(f, "utf8")) {
  const usage = {};
  const sources = files.map((file) => ({ file, text: read(file) }));
  for (const component of components) {
    const axes = Object.keys(variants[component.id]?.axes ?? {});
    if (!axes.length) continue;
    const tag = component.export ?? component.name;
    const cva = `${tag.charAt(0).toLowerCase()}${tag.slice(1)}Variants`;
    const entry = {
      uses: 0,
      axes: Object.fromEntries(axes.map((a) => [a, { counts: {}, dynamic: 0 }])),
    };
    for (const { file, text } of sources) {
      if (component.absFile && file === component.absFile) continue;
      const found = [
        ...openingTags(text, tag).map((attrs) => axisValues(attrs, axes)),
        ...cvaCalls(text, cva, axes),
      ];
      for (const values of found) {
        entry.uses += 1;
        for (const [axis, value] of Object.entries(values)) {
          const a = entry.axes[axis];
          if (value === DYNAMIC) a.dynamic += 1;
          else a.counts[String(value)] = (a.counts[String(value)] ?? 0) + 1;
        }
      }
    }
    usage[component.id] = entry;
  }
  return usage;
}

/** Values of each axis no use sets, except the default and axes set dynamically. */
export function unusedValues(usage, variants) {
  const out = {};
  for (const [id, entry] of Object.entries(usage)) {
    for (const [axis, { counts, dynamic }] of Object.entries(entry.axes)) {
      if (dynamic) continue;
      const values = (variants[id]?.axes[axis] ?? [])
        .map(String)
        .filter((v) => v !== "default" && v !== "false" && !counts[v]);
      if (values.length) (out[id] ??= {})[axis] = values;
    }
  }
  return out;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const { components: variants } = JSON.parse(
    readFileSync(join(packageRoot, config.variants), "utf8"),
  );
  const only = args.filter((a) => !a.startsWith("--"));
  const components = registry.components
    .filter((c) => !only.length || only.includes(c.id))
    .map((c) => ({ ...c, absFile: join(packageRoot, c.file) }));
  const files = config.usage.flatMap((dir) => sourceFiles(join(repo, dir)));
  const usage = countUsage(components, variants, files);
  const unused = unusedValues(usage, variants);
  if (args.includes("--json")) {
    console.log(JSON.stringify({ usage, unused }, null, 2));
  } else if (args.includes("--all")) {
    for (const [id, entry] of Object.entries(usage)) {
      console.log(`${id} (${entry.uses} uses)`);
      for (const [axis, { counts, dynamic }] of Object.entries(entry.axes)) {
        const list = (variants[id].axes[axis] ?? [])
          .map((v) => `${v} ${counts[String(v)] ?? 0}`)
          .join(", ");
        console.log(`  ${axis}: ${list}${dynamic ? ` · ${dynamic} dynamic` : ""}`);
      }
    }
  } else {
    for (const [id, axes] of Object.entries(unused))
      for (const [axis, values] of Object.entries(axes))
        console.log(`${id.padEnd(22)} ${axis.padEnd(14)} ${values.join(", ")}`);
    const n = Object.values(unused).reduce(
      (sum, axes) => sum + Object.values(axes).flat().length,
      0,
    );
    console.error(
      `${n} variant values unused across ${files.length} files in ${config.usage.map((d) => relative(repo, join(repo, d)) || ".").join(", ")}`,
    );
  }
}
