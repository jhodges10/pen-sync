import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import {
  chunkVariables,
  pencilEffects,
  toPencilVariables,
  toSnippets,
} from "./pencil-variables.mjs";
import { THEMES } from "./test-themes.mjs";
import { buildDocument } from "./tokens-lib.mjs";

const build = (resolved, roles) => buildDocument(resolved, roles, THEMES);

const all = (value) =>
  Object.fromEntries(THEMES.map(({ key }) => [key, value]));

const DOC = build(
  {
    "--color-background": {
      type: "color",
      values: {
        ...all("#ffffff"),
        "dark/A": "#05070d",
        "dark/embed": "#05070d",
      },
    },
    // Varies only for the panel: the case Pencil mangles without explicit entries.
    "--color-panel-chrome": {
      type: "color",
      values: { ...all("#f2f3f5"), "dark/embed": "#0e1218" },
    },
    "--color-overlay": { type: "color", values: all("#00000080") },
    "--radius-md": { type: "dimension", values: all("6px") },
    "--tracking-overline": { type: "dimension", values: all("0.18em") },
    "--shadow-card": { type: "shadow", values: all([]) },
    "--font-sans": {
      type: "fontFamily",
      values: all('"Geist", "Inter", sans-serif'),
    },
  },
  {
    title: all({
      fontFamily: "Geist",
      fontSize: "14px",
      fontWeight: 600,
      lineHeight: 1.429,
      letterSpacing: "-0.025em",
      textTransform: "none",
    }),
  },
);

test("registers every theme first, in axis order, through --theme-name", () => {
  const { variables } = toPencilVariables(DOC);
  const [first] = Object.keys(variables);
  assert.equal(first, "--theme-name");
  assert.deepEqual(
    variables["--theme-name"].value.map((entry) => entry.value),
    THEMES.map(({ key }) => key),
  );
});

test("spells out every theme for a token that varies, and nothing for one that does not", () => {
  const { variables } = toPencilVariables(DOC);
  const chrome = variables["--color-panel-chrome"].value;
  assert.equal(chrome.length, THEMES.length);
  assert.ok(
    chrome.every((entry) => entry.theme),
    "no untagged default for Pencil to drop",
  );
  assert.equal(chrome.at(-1).value, "#0e1218");
  assert.deepEqual(chrome.at(-1).theme, {
    mode: "dark",
    brand: "A",
    host: "embed",
  });
  assert.equal(chrome[0].value, "#f2f3f5");
  assert.deepEqual(variables["--color-overlay"], {
    type: "color",
    value: "#00000080",
  });
});

test("maps lengths to numbers, fonts to their first family, and roles to parts", () => {
  const { variables, skipped } = toPencilVariables(DOC);
  assert.deepEqual(variables["--radius-md"], { type: "number", value: 6 });
  assert.deepEqual(variables["--font-sans"], {
    type: "string",
    value: "Geist",
  });
  assert.deepEqual(variables["--spacing-4"], { type: "number", value: 16 });
  assert.deepEqual(variables["--type-title-size"], {
    type: "number",
    value: 14,
  });
  assert.deepEqual(variables["--type-title-weight"], {
    type: "string",
    value: "600",
  });
  assert.deepEqual(variables["--type-title-leading"], {
    type: "number",
    value: 1.429,
  });
  // -0.025em at 14px, because Pencil letter spacing is absolute.
  assert.deepEqual(variables["--type-title-tracking"], {
    type: "number",
    value: -0.35,
  });
  assert.deepEqual(
    skipped.map((entry) => entry.name),
    ["--tracking-overline", "--shadow-card"],
  );
});

test("snippets reproduce the definitions exactly when Pencil runs them", () => {
  const { variables } = toPencilVariables(DOC);
  const received = {};
  for (const snippet of toSnippets(DOC, 3)) {
    vm.runInNewContext(snippet, {
      SetVariables: (chunk) => Object.assign(received, chunk),
    });
  }
  // Objects built inside the VM have its own prototypes; compare the data.
  assert.deepEqual(JSON.parse(JSON.stringify(received)), variables);
  assert.deepEqual(
    Object.keys(received),
    Object.keys(variables),
    "order preserved",
  );
});

test("chunks keep every variable once", () => {
  const { variables } = toPencilVariables(DOC);
  const chunks = chunkVariables(variables, 4);
  assert.ok(chunks.length <= 4);
  assert.deepEqual(Object.assign({}, ...chunks), variables);
});

test("turns shadow layers into Pencil effects and reports what they cannot hold", () => {
  const doc = build(
    {
      "--shadow-ring": {
        type: "shadow",
        values: {
          ...all([
            {
              color: "#0000001a",
              offsetX: "0px",
              offsetY: "0px",
              blur: "0px",
              spread: "1px",
            },
          ]),
          "dark/A": [
            {
              color: "#ffffff1a",
              offsetX: "0px",
              offsetY: "0px",
              blur: "0px",
              spread: "1px",
            },
          ],
        },
      },
      "--shadow-knob": {
        type: "shadow",
        values: all([
          {
            color: "#ffffff4d",
            offsetX: "0px",
            offsetY: "1px",
            blur: "0px",
            spread: "0px",
            inset: true,
          },
        ]),
      },
    },
    {},
  );
  const { effects, lossy, themedShadows } = pencilEffects(doc);
  assert.deepEqual(effects["--shadow-knob"], [
    {
      type: "shadow",
      shadowType: "inner",
      offset: { x: 0, y: 1 },
      blur: 0,
      color: "#ffffff4d",
    },
  ]);
  assert.deepEqual(lossy, ["--shadow-ring"]);
  assert.deepEqual(themedShadows, ["--shadow-ring"]);
});
