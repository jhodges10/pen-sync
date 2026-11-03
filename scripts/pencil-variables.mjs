/**
 * Turn the tokens file (`pen-sync.config.json` → tokens) into Pencil variable
 * definitions for the design-system file (→ pen).
 *
 *   node $DS/pencil-variables.mjs --chunks 4   # SetVariables payloads, one per line
 *
 * Pencil resolves a themed variable to the LAST entry whose theme matches the
 * frame, and an axis a frame does not set falls back to the FIRST value the
 * document registered for that axis (registration follows first appearance).
 * So `--theme-name` comes first, listing every theme in config order; every
 * themed variable then lists an exact full-tuple entry for each theme.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { EXT } from "./tokens-lib.mjs";
import { isMain } from "./main.mjs";

/** Tailwind's default spacing scale (`--spacing: 0.25rem`), which the apps use unchanged. */
const SPACING_STEPS = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16];

/** A theme's Pencil theme: one value per axis (`{ mode: "dark", brand: "b" }`). */
export function themeTuple(theme) {
  return theme.pencil;
}

const px = (value) => {
  const match = /^(-?\d*\.?\d+)px$/.exec(value);
  return match ? Number(match[1]) : null;
};

/**
 * A themed definition: one explicit entry per theme, in axis order. Pencil
 * silently drops an untagged default when the overrides leave a theme out, so
 * every theme is spelled out; a token that never varies stays a plain value.
 */
function themed(type, defaultValue, perTheme, themes) {
  const varies = themes.some(
    ({ key }) => key in perTheme && perTheme[key] !== defaultValue,
  );
  return varies
    ? {
        type,
        value: themes.map((theme) => ({
          value: perTheme[theme.key] ?? defaultValue,
          theme: themeTuple(theme),
        })),
      }
    : { type, value: defaultValue };
}

/**
 * Ordered `{ name: { type, value } }` for `SetVariables`. Names keep the CSS
 * custom property spelling, so `$--color-primary` in Pencil is `bg-primary` in
 * code. Lengths in em, viewport or container units, shadows and gradients have
 * no Pencil variable form; they are listed in `skipped` instead.
 */
export function toPencilVariables(doc) {
  const { themes } = doc.$extensions[EXT];
  const variables = {
    "--theme-name": {
      type: "string",
      value: themes.map((theme) => ({
        value: theme.key,
        theme: themeTuple(theme),
      })),
    },
  };
  const skipped = [];

  const perThemeOf = (token, map = (v) => v) => {
    const values = token.$extensions?.[EXT]?.themes;
    return values
      ? Object.fromEntries(Object.entries(values).map(([k, v]) => [k, map(v)]))
      : {};
  };

  for (const [name, token] of Object.entries(doc.color ?? {})) {
    variables[name] = themed("color", token.$value, perThemeOf(token), themes);
  }
  for (const [name, token] of Object.entries(doc.dimension ?? {})) {
    const value = px(token.$value);
    if (value === null) {
      skipped.push({ name, reason: `relative length ${token.$value}` });
      continue;
    }
    variables[name] = themed("number", value, perThemeOf(token, px), themes);
  }
  for (const step of SPACING_STEPS) {
    variables[`--spacing-${step}`] = { type: "number", value: step * 4 };
  }
  for (const [name, token] of Object.entries(doc.fontFamily ?? {})) {
    const family = token.$value
      .split(",")[0]
      .trim()
      .replace(/^["']|["']$/g, "");
    variables[name] = { type: "string", value: family };
  }
  for (const [role, token] of Object.entries(doc.typography ?? {})) {
    const { fontFamily, fontSize, fontWeight, lineHeight, letterSpacing } =
      token.$value;
    const size = px(fontSize);
    const em = Number.parseFloat(letterSpacing);
    variables[`--type-${role}-font`] = { type: "string", value: fontFamily };
    variables[`--type-${role}-size`] = { type: "number", value: size };
    variables[`--type-${role}-weight`] = {
      type: "string",
      value: String(fontWeight),
    };
    if (lineHeight !== "normal") {
      variables[`--type-${role}-leading`] = {
        type: "number",
        value: lineHeight,
      };
    }
    // Pencil letter spacing is absolute, so the em tracking is fixed at the role's size.
    variables[`--type-${role}-tracking`] = {
      type: "number",
      value: Math.round(em * size * 100) / 100,
    };
  }
  for (const group of ["shadow", "string"]) {
    for (const name of Object.keys(doc[group] ?? {})) {
      skipped.push({
        name,
        reason:
          group === "shadow" ? "shadow (Effects board)" : "no Pencil form",
      });
    }
  }
  return { variables, skipped };
}

/**
 * Pencil shadow effects for each shadow token, from its first theme's layers. Pencil
 * has no spread, so a layer that relies on spread is listed in `lossy`; a token
 * whose layers change by theme says so, since an effect holds one value.
 */
export function pencilEffects(doc) {
  const effects = {};
  const lossy = [];
  const themedShadows = [];
  for (const [name, token] of Object.entries(doc.shadow ?? {})) {
    effects[name] = token.$value.map((layer) => ({
      type: "shadow",
      shadowType: layer.inset ? "inner" : "outer",
      offset: { x: px(layer.offsetX), y: px(layer.offsetY) },
      blur: px(layer.blur),
      color: layer.color,
    }));
    if (token.$value.some((layer) => px(layer.spread) !== 0)) lossy.push(name);
    if (token.$extensions?.[EXT]?.themes) themedShadows.push(name);
  }
  return { effects, lossy, themedShadows };
}

/** Split into payloads of at most `count` roughly equal parts, `--theme-name` first. */
export function chunkVariables(variables, count) {
  const entries = Object.entries(variables);
  const size = Math.ceil(entries.length / count);
  const chunks = [];
  for (let i = 0; i < entries.length; i += size) {
    chunks.push(Object.fromEntries(entries.slice(i, i + size)));
  }
  return chunks;
}

/**
 * The same definitions as compact `execute` snippets: theme tuples are declared
 * once and each variable is `V(type, default, { themeKey: value })`.
 */
export function toSnippets(doc, count) {
  const { variables } = toPencilVariables(doc);
  const { themes } = doc.$extensions[EXT];
  const keyOf = (theme) =>
    themes.find((t) => JSON.stringify(themeTuple(t)) === JSON.stringify(theme))
      .key;
  const prelude =
    `const K=${JSON.stringify(Object.fromEntries(themes.map((t) => [t.key, themeTuple(t)])))};` +
    "const V=(t,d,o)=>({type:t,value:o?Object.keys(K).map((k)=>({value:o[k]??d,theme:K[k]})):d});";
  return chunkVariables(variables, count).map((chunk) => {
    const body = Object.entries(chunk)
      .map(([name, { type, value }]) => {
        if (name === "--theme-name")
          return `${JSON.stringify(name)}:${JSON.stringify({ type, value })}`;
        if (!Array.isArray(value))
          return `${JSON.stringify(name)}:V(${JSON.stringify(type)},${JSON.stringify(value)})`;
        // Default = the first theme's entry; only the themes that differ are spelled out.
        const base = value[0].value;
        const map = Object.fromEntries(
          value
            .filter((entry) => entry.value !== base)
            .map((entry) => [keyOf(entry.theme), entry.value]),
        );
        return `${JSON.stringify(name)}:V(${JSON.stringify(type)},${JSON.stringify(base)},${JSON.stringify(map)})`;
      })
      .join(",");
    return `${prelude}SetVariables({${body}})`;
  });
}

if (isMain(import.meta.url)) {
  const { config, repo } = await import("./config.mjs");
  const doc = JSON.parse(readFileSync(join(repo, config.tokens), "utf8"));
  const { variables, skipped } = toPencilVariables(doc);
  const count = Number(process.argv[process.argv.indexOf("--chunks") + 1]) || 1;
  for (const snippet of toSnippets(doc, count)) console.log(snippet);
  console.error(
    `${Object.keys(variables).length} variables; skipped ${skipped.length}: ${skipped.map((s) => s.name).join(", ")}`,
  );
}
