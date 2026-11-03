/**
 * Export the component package's design tokens, resolved per theme, to the
 * tokens file (`pen-sync.config.json` → tokens) — the input the Pencil design-system file's
 * variables are built from (see the `pen-sync` skill).
 *
 *   node $DS/export-tokens.mjs
 *   node $DS/export-tokens.mjs --check   # exit 1 if it is stale
 *
 * Values are resolved in headless Chromium: Pencil only takes hex colors and
 * plain numbers, and only a browser evaluates the tokens' `var()` chains,
 * `color-mix()` and relative colors exactly as users see them. Playwright comes
 * from the package `pen-sync.config.json` → playwright names.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildDocument,
  exportableNames,
  inlineImports,
  primaryFamily,
  srgbToHex,
  toPlainCss,
  typographyRoles,
} from "./tokens-lib.mjs";
import { config, packageRoot, repo } from "./config.mjs";

const OUTPUT = join(repo, config.tokens);
const SOURCE = join(packageRoot, config.tokenSource);

// Playwright comes from the package `pen-sync.config.json` → playwright names.
const { chromium } = createRequire(join(repo, config.playwright))("playwright");

/** Runs in the page: classify and resolve every token under the current theme. */
function resolveInPage({ names, roles }) {
  const root = document.documentElement;
  const rootStyle = getComputedStyle(root);
  const probe = document.getElementById("probe");
  const read = (property, value) => {
    probe.style.cssText = "";
    probe.style.setProperty(property, value);
    return getComputedStyle(probe).getPropertyValue(property);
  };

  /** Computed `box-shadow` → layers whose colors are read as `color(srgb …)`. */
  const shadowLayers = (computed) => {
    if (computed === "none") return [];
    const layers = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i <= computed.length; i += 1) {
      const char = computed[i];
      if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;
      else if ((char === "," && depth === 0) || i === computed.length) {
        layers.push(computed.slice(start, i).trim());
        start = i + 1;
      }
    }
    return layers.map((layer) => {
      const color =
        layer.match(/[a-z-]+\([^()]*\)|transparent/i)?.[0] ?? "transparent";
      return {
        color: read("color", `color(from ${color} srgb r g b / alpha)`),
        lengths: [...layer.replace(color, "").matchAll(/-?\d*\.?\d+px/g)].map(
          (m) => m[0],
        ),
        inset: /\binset\b/.test(layer),
      };
    });
  };

  const tokens = {};
  for (const name of names) {
    const text = rootStyle.getPropertyValue(name).trim();
    if (!text) continue;
    if (CSS.supports("color", text)) {
      tokens[name] = {
        type: "color",
        value: read("color", `color(from ${text} srgb r g b / alpha)`),
      };
    } else if (
      CSS.supports("width", text) &&
      !/^-?\d*\.?\d+$/.test(text) &&
      // Relative to a container or the viewport: a probe-sized px would lie.
      !/%|cq[whib]|v[whib]|clamp\(/.test(text)
    ) {
      tokens[name] = {
        type: "dimension",
        value: read("width", text),
        raw: text,
      };
    } else if (name.includes("shadow") && CSS.supports("box-shadow", text)) {
      tokens[name] = {
        type: "shadow",
        value: shadowLayers(read("box-shadow", text)),
      };
    } else if (name.startsWith("--font-")) {
      tokens[name] = { type: "fontFamily", value: text };
    } else {
      tokens[name] = { type: "string", value: text };
    }
  }

  const typography = {};
  for (const role of roles) {
    probe.style.cssText = "";
    probe.className = `type-role-${role}`;
    const style = getComputedStyle(probe);
    typography[role] = {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      textTransform: style.textTransform,
    };
    probe.className = "";
  }
  return { tokens, typography };
}

const px = (value) => Number.parseFloat(value);

function normalizeToken(name, { type, value, raw }) {
  if (type === "color") return { type, ...srgbToHex(value) };
  if (type === "shadow") {
    const layers = value.map(({ color, lengths, inset }) => {
      const [offsetX = "0px", offsetY = "0px", blur = "0px", spread = "0px"] =
        lengths;
      return { ...srgbToHex(color), offsetX, offsetY, blur, spread, inset };
    });
    return {
      type,
      value: layers.map(({ hex, offsetX, offsetY, blur, spread, inset }) => ({
        color: hex,
        offsetX,
        offsetY,
        blur,
        spread,
        ...(inset ? { inset } : {}),
      })),
      outOfGamut: layers.some((layer) => layer.outOfGamut),
    };
  }
  if (type === "dimension") {
    // An em length (tracking, control spacing) stays relative: it scales with text.
    const em = raw.match(/^(-?\d*\.?\d+)em$/);
    return { type, value: em ? `${Number(em[1])}em` : `${px(value)}px` };
  }
  // Gradients and shadows keep the stylesheet's line breaks; one line is enough.
  return { type, value: value.replace(/\s+/g, " ").trim() };
}

function normalizeRole(role) {
  const size = px(role.fontSize);
  const ratio = (value) =>
    value === "normal" ? 0 : Math.round((px(value) / size) * 1000) / 1000;
  return {
    fontFamily: primaryFamily(role.fontFamily),
    fontSize: `${size}px`,
    fontWeight: Number(role.fontWeight),
    lineHeight:
      role.lineHeight === "normal" ? "normal" : ratio(role.lineHeight),
    letterSpacing: `${ratio(role.letterSpacing)}em`,
    textTransform: role.textTransform,
  };
}

async function exportTokens() {
  const source = inlineImports(SOURCE);
  const names = exportableNames(source);
  const roles = typographyRoles(source);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<!doctype html><html><head><style>${toPlainCss(source)}</style></head>` +
        `<body><div id="probe" style="position:absolute;font-size:16px">Ag</div></body></html>`,
    );
    const resolved = {};
    const typography = {};
    for (const theme of config.themes) {
      await page.evaluate((attributes) => {
        const root = document.documentElement;
        for (const attribute of [...root.attributes])
          root.removeAttribute(attribute.name);
        for (const [key, value] of Object.entries(attributes))
          root.setAttribute(key, value);
      }, theme.html);
      const result = await page.evaluate(resolveInPage, { names, roles });
      for (const [name, token] of Object.entries(result.tokens)) {
        const { type, value, hex, outOfGamut } = normalizeToken(name, token);
        resolved[name] ??= { type, values: {}, outOfGamut: [] };
        resolved[name].values[theme.key] = hex ?? value;
        if (outOfGamut) resolved[name].outOfGamut.push(theme.key);
      }
      for (const [role, values] of Object.entries(result.typography)) {
        typography[role] ??= {};
        typography[role][theme.key] = normalizeRole(values);
      }
    }
    return buildDocument(resolved, typography, config.themes);
  } finally {
    await browser.close();
  }
}

const tokenDocument = await exportTokens();
const json = `${JSON.stringify(tokenDocument, null, 2)}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUTPUT, "utf8");
  } catch {}
  if (current !== json) {
    console.error(
      `✗ ${config.tokens} is stale. Re-run the token export and commit the result.`,
    );
    process.exit(1);
  }
  console.log(
    `✓ ${config.tokens} matches ${config.package}/${config.tokenSource}.`,
  );
} else {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, json);
  const counts = Object.entries(tokenDocument)
    .filter(([key]) => !key.startsWith("$"))
    .map(([group, tokens]) => `${Object.keys(tokens).length} ${group}`);
  console.log(`Wrote ${config.tokens} (${counts.join(", ")}).`);
}
