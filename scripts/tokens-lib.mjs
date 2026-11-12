/**
 * Pure helpers for `export-tokens.mjs`: everything that does not need a browser.
 *
 * The exporter resolves a component package's tokens in real Chromium, because
 * only a browser evaluates `var()` chains, `color-mix()` and relative colors
 * the way users see them. These helpers prepare the stylesheet it loads, decide
 * which custom properties are tokens, and shape the resolved values into the
 * committed tokens file (`pen-sync.config.json` → tokens), a DTCG document.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The DTCG `$extensions` key the token document's theme data lives under. */
export const EXT = "pen-sync";

/** Motion and layout plumbing that has no meaning on a design canvas. */
const SKIPPED = [
  /^--animate-/,
  /^--ease-/,
  /^--transition-/,
  /^--tw-/,
  /-rgb$/,
];

/** Inline every relative `@import "./x.css"`, depth-first, each file once. */
export function inlineImports(path, seen = new Set()) {
  if (seen.has(path)) return "";
  seen.add(path);
  return readFileSync(path, "utf8").replace(
    /^@import\s+"(\.[^"]+)";\s*$/gm,
    (_, relative) => inlineImports(join(dirname(path), relative), seen),
  );
}

/**
 * Make Tailwind's token CSS loadable as plain CSS. `@theme` blocks become
 * `:root` so their custom properties exist; every other Tailwind at-rule
 * (`@custom-variant`, `@utility`, bare `@import "tailwindcss"`) is either
 * ignored by the browser or removed here.
 */
export function toPlainCss(css) {
  return css
    .replace(/^@import\s+"[^"]+";\s*$/gm, "")
    .replace(/^@custom-variant[^;]*;\s*$/gm, "")
    // A Tailwind v4 `@utility` is a plain class to a browser that never ran Tailwind.
    .replace(/@utility\s+([\w-]+)\s*\{/g, ".$1 {")
    .replace(/@theme(\s+(inline|static|reference))*\s*\{/g, ":root {");
}

/** `--name: value;` pairs declared directly inside each top-level block. */
function declarations(css) {
  const blocks = [];
  let depth = 0;
  let start = -1;
  let header = "";
  for (let i = 0; i < css.length; i += 1) {
    const char = css[i];
    if (char === "{") {
      if (depth === 0) {
        // A header starts after the previous block or statement (`@custom-variant …;`).
        const from =
          Math.max(css.lastIndexOf("}", i), css.lastIndexOf(";", i)) + 1;
        header = css
          .slice(from, i)
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .trim();
        start = i + 1;
      }
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) blocks.push({ header, body: css.slice(start, i) });
    }
  }
  return blocks.flatMap(({ header, body }) =>
    [...body.matchAll(/(?:^|[;{\s])(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g)].map(
      (m) => ({
        header,
        name: m[1],
        value: m[2].trim(),
      }),
    ),
  );
}

/**
 * The custom properties worth exporting. Names come from `@theme` blocks (the
 * Tailwind-facing names: `--color-primary` is `bg-primary`), plus raw theme
 * tokens no `@theme` entry aliases as a bare `var(--x)`. Typography role parts
 * (`--type-*`) are exported as composite roles instead, so they are left out.
 */
export function exportableNames(sourceCss) {
  const all = declarations(sourceCss);
  const themed = all.filter((d) => /^@theme\b/.test(d.header));
  const aliased = new Set(
    themed.flatMap((d) => {
      const alias = d.value.match(/^var\((--[a-zA-Z0-9-]+)\)$/);
      return alias ? [alias[1]] : [];
    }),
  );
  const names = new Set(themed.map((d) => d.name));
  for (const d of all) {
    if (/^@/.test(d.header) || aliased.has(d.name)) continue;
    names.add(d.name);
  }
  return [...names]
    .filter(
      (name) =>
        !name.startsWith("--type-") && !SKIPPED.some((re) => re.test(name)),
    )
    .sort();
}

/** Typography role names from `--type-<role>-size` declarations. */
export function typographyRoles(sourceCss) {
  return [
    ...new Set(
      [...sourceCss.matchAll(/--type-([a-z][a-z0-9-]*)-size\s*:/g)].map((m) => m[1]),
    ),
  ].sort();
}

/**
 * Hex for a computed `color(srgb r g b / a)` string. Channels outside 0..1
 * are clipped (what Chromium paints on an sRGB screen) and reported.
 */
export function srgbToHex(computed) {
  const match = computed.match(
    /^color\(srgb\s+(\S+)\s+(\S+)\s+(\S+)(?:\s*\/\s*(\S+))?\)$/,
  );
  if (!match) throw new Error(`Not a color(srgb …) value: ${computed}`);
  const [r, g, b] = match.slice(1, 4).map(Number);
  const alpha =
    match[4] === undefined
      ? 1
      : Number(match[4].replace(/%$/, "")) / (match[4].endsWith("%") ? 100 : 1);
  const tolerance = 0.002;
  const outOfGamut = [r, g, b].some((v) => v < -tolerance || v > 1 + tolerance);
  const byte = (v) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  const hex = `#${byte(r)}${byte(g)}${byte(b)}${alpha < 1 ? byte(alpha) : ""}`;
  return { hex, outOfGamut };
}

/** First family of a `font-family` list, unquoted — what Pencil takes. */
export function primaryFamily(fontFamily) {
  return fontFamily
    .split(",")[0]
    .trim()
    .replace(/^["']|["']$/g, "");
}

/**
 * Shape resolved values into the DTCG document. `resolved` maps a token name
 * to `{ type, values: { [themeKey]: value }, outOfGamut?: themeKey[] }`;
 * `roles` maps a role name to `{ [themeKey]: typography }`; `themes` are the
 * config's, the first the default. A token whose value never changes across
 * themes stores just `$value`.
 */
export function buildDocument(resolved, roles, themes) {
  const defaultTheme = themes[0].key;
  const groups = {
    color: {},
    dimension: {},
    shadow: {},
    fontFamily: {},
    string: {},
    typography: {},
  };
  const themed = (values) =>
    new Set(Object.values(values).map((v) => JSON.stringify(v))).size > 1;

  for (const name of Object.keys(resolved).sort()) {
    const { type, values, outOfGamut = [] } = resolved[name];
    const ext = {};
    if (themed(values)) ext.themes = values;
    if (outOfGamut.length > 0) ext.outOfGamut = outOfGamut;
    groups[type][name] = {
      $type: type,
      $value: values[defaultTheme],
      ...(Object.keys(ext).length > 0 ? { $extensions: { [EXT]: ext } } : {}),
    };
  }
  for (const role of Object.keys(roles).sort()) {
    const values = roles[role];
    groups.typography[role] = {
      $type: "typography",
      $value: values[defaultTheme],
      ...(themed(values) ? { $extensions: { [EXT]: { themes: values } } } : {}),
    };
  }
  return {
    $description:
      "Generated by the pen-sync plugin's export-tokens.mjs from the component package's token CSS. Do not edit; re-run the export.",
    $extensions: {
      [EXT]: {
        themes: themes.map(({ key, pencil }) => ({ key, pencil })),
        defaultTheme,
      },
    },
    ...Object.fromEntries(
      Object.entries(groups).filter(
        ([, tokens]) => Object.keys(tokens).length > 0,
      ),
    ),
  };
}

/**
 * The font loader's variables (config `fonts`), defined as the family each one
 * names. The loader sets them outside the token source (next/font puts them on
 * `<html>`), so without them every `var(--font-…)` chain resolves to nothing.
 */
export function fontAliasCss(fonts = {}) {
  const entries = Object.entries(fonts);
  if (entries.length === 0) return "";
  return `:root{${entries.map(([name, family]) => `${name}:${JSON.stringify(family)}`).join(";")}}`;
}
