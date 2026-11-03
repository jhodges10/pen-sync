import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { THEMES } from "./test-themes.mjs";
import {
  buildDocument,
  exportableNames,
  inlineImports,
  primaryFamily,
  srgbToHex,
  toPlainCss,
  typographyRoles,
} from "./tokens-lib.mjs";

const build = (resolved, roles) => buildDocument(resolved, roles, THEMES);

test("inlines relative imports depth-first, each file once", () => {
  const dir = mkdtempSync(join(tmpdir(), "tokens-lib-"));
  try {
    writeFileSync(
      join(dir, "a.css"),
      '@import "./b.css";\n@import "./c.css";\n.a{}',
    );
    writeFileSync(join(dir, "b.css"), '@import "./c.css";\n.b{}');
    writeFileSync(join(dir, "c.css"), ".c{}");
    const css = inlineImports(join(dir, "a.css"));
    assert.equal(css.match(/\.c\{\}/g).length, 1);
    assert.ok(css.indexOf(".c{}") < css.indexOf(".b{}"));
    assert.ok(!css.includes("@import"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("turns @theme blocks into :root and drops Tailwind-only statements", () => {
  const css = toPlainCss(
    '@import "tailwindcss";\n@custom-variant dark (&:is(.dark *));\n@theme inline {\n  --radius-sm: 2px;\n}\n@theme { --x: 1px; }',
  );
  assert.ok(!css.includes("@import"));
  assert.ok(!css.includes("@custom-variant"));
  assert.equal(css.match(/:root \{/g).length, 2);
  assert.equal(
    toPlainCss("@utility type-page {\n  font-size: var(--type-page-size);\n}"),
    ".type-page {\n  font-size: var(--type-page-size);\n}",
  );
});

const SOURCE = `
@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-primary-soft: color-mix(in oklch, var(--primary) 20%, var(--background));
  --radius-sm: calc(var(--radius) - 2px);
  --animate-spin: spin 1s linear infinite;
}

:root {
  --background: oklch(1 0 0);
  --primary: oklch(0.3 0.14 264);
  --radius: 0.375rem;
  --paint-shadow-rgb: 0 0 0;
  --type-title-size: 0.875rem;
}

.dark {
  --background: oklch(0.13 0.015 264);
  --scroll-fade-size: 2rem;
}

@utility table-shadow {
  --ignored-utility-var: 1px;
}
`;

test("exports Tailwind-facing names plus raw tokens that nothing aliases", () => {
  assert.deepEqual(exportableNames(SOURCE), [
    "--color-background",
    "--color-primary-soft",
    "--primary",
    "--radius",
    "--radius-sm",
    "--scroll-fade-size",
  ]);
});

test("reads the @theme block that follows a @custom-variant statement", () => {
  // Regression: the block header used to swallow the preceding statement, so
  // the whole @theme block was mistaken for an unrelated at-rule and skipped.
  assert.ok(exportableNames(SOURCE).includes("--radius-sm"));
});

test("lists typography roles from their size declarations", () => {
  assert.deepEqual(
    typographyRoles(
      "--type-title-size: 1px; --type-body-size: 1px; --type-body-weight: 4; --type-dialog-title-size: 1px;",
    ),
    ["body", "dialog-title", "title"],
  );
});

test("converts color(srgb …) to hex, clipping and flagging out-of-gamut channels", () => {
  assert.deepEqual(srgbToHex("color(srgb 1 1 1)"), {
    hex: "#ffffff",
    outOfGamut: false,
  });
  assert.deepEqual(srgbToHex("color(srgb 1 1 1 / 0.1)"), {
    hex: "#ffffff1a",
    outOfGamut: false,
  });
  assert.deepEqual(srgbToHex("color(srgb 0 0 0 / 50%)"), {
    hex: "#00000080",
    outOfGamut: false,
  });
  assert.deepEqual(srgbToHex("color(srgb 1.08 -0.02 0.5)"), {
    hex: "#ff0080",
    outOfGamut: true,
  });
  assert.throws(() => srgbToHex("rgb(0, 0, 0)"), /Not a color\(srgb/);
});

test("takes the first family of a font stack, unquoted", () => {
  assert.equal(primaryFamily('"Geist", "Inter", ui-sans-serif'), "Geist");
  assert.equal(primaryFamily("ui-monospace, monospace"), "ui-monospace");
});

test("stores per-theme values only for tokens that change across themes", () => {
  const all = (value) =>
    Object.fromEntries(THEMES.map(({ key }) => [key, value]));
  const doc = build(
    {
      "--color-background": {
        type: "color",
        values: { ...all("#ffffff"), "dark/A": "#05070d" },
        outOfGamut: [],
      },
      "--radius": { type: "dimension", values: all("6px"), outOfGamut: [] },
      "--color-status-blue": {
        type: "color",
        values: all("#2563eb"),
        outOfGamut: ["light/A"],
      },
    },
    { title: all({ fontFamily: "Geist", fontSize: "14px" }) },
  );
  assert.equal(doc.color["--color-background"].$value, "#ffffff");
  assert.equal(
    doc.color["--color-background"].$extensions["pen-sync"].themes["dark/A"],
    "#05070d",
  );
  assert.deepEqual(doc.dimension["--radius"], {
    $type: "dimension",
    $value: "6px",
  });
  assert.deepEqual(doc.color["--color-status-blue"].$extensions["pen-sync"], {
    outOfGamut: ["light/A"],
  });
  assert.deepEqual(doc.typography.title, {
    $type: "typography",
    $value: { fontFamily: "Geist", fontSize: "14px" },
  });
  assert.equal(doc.$extensions["pen-sync"].defaultTheme, "light/A");
  assert.equal(doc.$extensions["pen-sync"].themes.length, THEMES.length);
  assert.ok(!("string" in doc), "empty groups are omitted");
});
