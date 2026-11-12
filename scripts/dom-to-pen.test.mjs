import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  asVariant,
  bindColor,
  bindFont,
  caption,
  codeLink,
  contextKey,
  nameLayers,
  buildExport,
  convertInstance,
  pencilSnippet,
  rowLabel,
  variableIndex,
  variantName,
} from "./dom-to-pen.mjs";

const THEMES = [
  { key: "light/A", pencil: { mode: "light", brand: "A", host: "app" } },
  { key: "dark/A", pencil: { mode: "dark", brand: "A", host: "app" } },
];
const themed = (light, dark) => ({
  type: "color",
  value: [
    { value: light, theme: { mode: "light", brand: "A", host: "app" } },
    { value: dark, theme: { mode: "dark", brand: "A", host: "app" } },
    // Embed host values are not part of the web themes and are ignored.
    {
      value: "#123456",
      theme: { mode: "dark", brand: "A", host: "embed" },
    },
  ],
});

// `--color-primary` and `--color-ring` are equal in every theme: only a class tells them apart.
const index = variableIndex(
  {
    "--color-background": themed("#ffffff", "#0a0a0f"),
    "--color-primary": themed("#062372", "#3969d9"),
    "--color-ring": themed("#062372", "#3969d9"),
    "--color-primary-foreground": themed("#ffffff", "#ffffff"),
    "--color-input": themed("#d1d5db", "#2a2f3a"),
    "--radius-sm": { type: "number", value: 4 },
    "--spacing-1": { type: "number", value: 4 },
    "--font-sans": { type: "string", value: "Geist" },
  },
  THEMES,
);

describe("bindColor", () => {
  test("prefers the variable a class names among equal matches", () => {
    const values = { "light/A": "#062372", "dark/A": "#3969d9" };
    assert.deepEqual(bindColor(values, ["ring"], index), {
      variable: "--color-ring",
      how: "class",
    });
    assert.deepEqual(bindColor(values, [], index), {
      variable: "--color-primary",
      how: "alias",
    });
  });

  test("matches by value only when every theme agrees", () => {
    assert.deepEqual(
      bindColor({ "light/A": "#d1d5db", "dark/A": "#2a2f3a" }, [], index),
      { variable: "--color-input", how: "value" },
    );
    assert.equal(
      bindColor({ "light/A": "#d1d5db", "dark/A": "#ffffff" }, [], index),
      null,
    );
  });
});

test("names a variant from its key, flags by axis and values by value", () => {
  assert.equal(variantName(""), "Default");
  assert.equal(variantName("size=default"), "Size Default");
  assert.equal(variantName("showCloseButton=false"), "No Close Button");
  assert.equal(variantName("tone=muted", { qualified: true }), "Tone Muted");
  assert.equal(
    variantName("checked=indeterminate&size=lg"),
    "Indeterminate / Lg",
  );
  assert.equal(
    variantName("aria-invalid&variant=ghost-on-dark"),
    "Aria Invalid / Ghost On Dark",
  );
});

const element = (overrides) => ({
  kind: "element",
  tag: "span",
  slot: null,
  cls: "",
  x: 0,
  y: 0,
  w: 16,
  h: 16,
  display: "block",
  position: "static",
  direction: "row",
  gap: [0, 0],
  padding: [0, 0, 0, 0],
  justify: "normal",
  align: "normal",
  bg: null,
  border: { widths: [0, 0, 0, 0], colors: [null, null, null, null] },
  radius: [0, 0, 0, 0],
  opacity: 1,
  clip: false,
  shadows: [],
  children: [],
  ...overrides,
});

const checkbox = (bg, mark, input) =>
  element({
    slot: "checkbox",
    cls: "inline-flex bg-background border-input data-checked:bg-primary data-checked:border-primary data-checked:text-primary-foreground",
    display: "inline-flex",
    justify: "center",
    align: "center",
    padding: [4, 4, 4, 4],
    bg,
    border: { widths: [1, 1, 1, 1], colors: [input, input, input, input] },
    radius: [4, 4, 4, 4],
    children: [
      {
        kind: "svg",
        cls: "text-current stroke-4",
        x: 3,
        y: 3,
        w: 10,
        h: 10,
        opacity: 1,
        viewBox: [0, 0, 24, 24],
        shapes: [
          {
            d: "M4 11l5 5L20 6",
            stroke: mark,
            strokeWidth: 1.67,
            fill: null,
            cap: "round",
            join: "round",
          },
        ],
      },
    ],
  });

const fresh = () => ({
  scoped: { byValues: new Map(), variables: {} },
  report: { class: 0, value: 0, alias: 0, literal: 0, scoped: 0, warnings: [] },
});

describe("convertInstance", () => {
  test("draws a flex box with a bound fill, inner stroke, radius and an SVG path", () => {
    const ctx = { index, id: "checkbox", ...fresh() };
    const node = convertInstance(
      {
        "light/A": checkbox("#062372", "#ffffff", "#062372"),
        "dark/A": checkbox("#3969d9", "#ffffff", "#3969d9"),
      },
      ctx,
    );
    assert.equal(node.type, "frame");
    assert.equal(node.fill, "$--color-primary");
    assert.equal(node.stroke, "$--color-primary");
    assert.equal(node.strokeAlignment, "inner");
    assert.equal(node.cornerRadius, "$--radius-sm");
    assert.equal(node.padding, "$--spacing-1");
    assert.deepEqual(
      [node.layout, node.justifyContent, node.alignItems],
      ["horizontal", "center", "center"],
    );
    const [svg] = node.children;
    const [path] = svg.children;
    assert.deepEqual(path.viewBox, [0, 0, 24, 24]);
    assert.equal(path.geometry, "M4 11l5 5L20 6");
    // text-current names no token, so the stroke inherits the ancestor's text class.
    assert.equal(path.stroke, "$--color-primary-foreground");
    assert.equal(ctx.report.class, 3);
  });

  test("a block whose children stack evenly is a vertical layout; overlapping ones stay absolute", () => {
    const text = (y) => ({
      kind: "text",
      content: "Ships Friday",
      x: 8,
      y,
      w: 80,
      h: 16,
      color: "#ffffff",
      font: "Geist",
      size: 12,
      weight: "400",
      lineHeight: 16,
      transform: "none",
    });
    const block = (children) =>
      element({ w: 100, h: 52, padding: [6, 8, 6, 8], children });
    const stacked = convertInstance(
      { "light/A": block([text(6), text(30)]) },
      { index: { ...index, themes: ["light/A"] }, id: "tooltip", ...fresh() },
    );
    assert.equal(stacked.layout, "vertical");
    assert.equal(stacked.gap, 8);
    assert.deepEqual(stacked.padding, [6, 8]);
    assert.equal(stacked.children[0].x, undefined);
    const overlapping = convertInstance(
      { "light/A": block([text(6), text(10)]) },
      { index: { ...index, themes: ["light/A"] }, id: "tooltip", ...fresh() },
    );
    assert.equal(overlapping.layout, "none");
    assert.equal(overlapping.children[1].y, 10);
  });

  test("a turned box keeps its size and angle, its corner placed so it covers the measured box", () => {
    const arrow = element({
      x: 40,
      y: -5,
      w: 14.14,
      h: 14.14,
      rotation: 45,
      natural: [10, 10],
      bg: "#000000",
      position: "absolute",
    });
    const node = convertInstance(
      { "light/A": element({ w: 100, h: 40, children: [arrow] }) },
      { index: { ...index, themes: ["light/A"] }, id: "tooltip", ...fresh() },
    );
    const [drawn] = node.children;
    assert.deepEqual(
      [drawn.width, drawn.height, drawn.rotation, drawn.x, drawn.y],
      [10, 10, 315, 47.07, -5],
    );
  });

  test("an element with nothing inside is a rectangle", () => {
    const ctx = { index, id: "checkbox", ...fresh() };
    const empty = (bg, input) => ({
      ...checkbox(bg, null, input),
      children: [],
    });
    const node = convertInstance(
      {
        "light/A": empty("#ffffff", "#d1d5db"),
        "dark/A": empty("#0a0a0f", "#2a2f3a"),
      },
      ctx,
    );
    assert.equal(node.type, "rectangle");
    assert.equal(node.fill, "$--color-background");
    assert.equal(node.stroke, "$--color-input");
  });

  test("a ring is drawn as a stroke outside the box, bound like a border", () => {
    const ctx = { index, id: "field", ...fresh() };
    const field = (input) =>
      element({
        cls: "ring-1 ring-input",
        shadows: [
          { color: input, x: 0, y: 0, blur: 0, spread: 1, inset: false },
          { color: "#0000001a", x: 0, y: 1, blur: 2, spread: 0, inset: false },
        ],
      });
    const node = convertInstance(
      {
        "light/A": field("#d1d5db"),
        "dark/A": field("#2a2f3a"),
      },
      ctx,
    );
    assert.equal(node.stroke, "$--color-input");
    assert.equal(node.strokeWidth, 1);
    assert.equal(node.strokeAlignment, "outer");
    assert.equal(node.effect.length, 1);
    assert.ok(!ctx.report.warnings.some((w) => /spread/.test(w)));
  });

  test("a paint no token matches in every theme gets one scoped variable; a uniform one stays literal", () => {
    const ctx = { index, id: "button", ...fresh() };
    const pair = (bg, border) =>
      element({
        bg,
        border: {
          widths: [1, 1, 1, 1],
          colors: [border, border, border, border],
        },
      });
    const trees = {
      "light/A": pair(null, "#bcc4d599"),
      "dark/A": pair("#2a2f3a4d", "#bcc4d599"),
    };
    const node = convertInstance(trees, ctx);
    assert.equal(node.fill, "$--ds-button-1");
    assert.deepEqual(ctx.scoped.variables["--ds-button-1"], {
      "light/A": "#00000000",
      "dark/A": "#2a2f3a4d",
    });
    assert.equal(node.stroke, "#bcc4d599");
    // The same values reuse the variable.
    assert.equal(convertInstance(trees, ctx).fill, "$--ds-button-1");
    assert.equal(Object.keys(ctx.scoped.variables).length, 1);
  });

  test("text keeps its content, font variable and line height ratio; per-side borders stay per side", () => {
    const ctx = { index, id: "tab", ...fresh() };
    const tab = element({
      display: "flex",
      cls: "text-primary border-b",
      border: {
        widths: [0, 0, 2, 0],
        colors: [null, null, "#062372", null],
      },
      children: [
        {
          kind: "text",
          content: "Orders",
          x: 0,
          y: 0,
          w: 40,
          h: 20,
          color: "#062372",
          font: '"Geist", sans-serif',
          size: 14,
          weight: "500",
          lineHeight: 20,
          letterSpacing: 0,
          transform: "uppercase",
        },
      ],
    });
    const node = convertInstance({ "light/A": tab, "dark/A": tab }, ctx);
    assert.deepEqual(node.strokeWidth, {
      top: 0,
      right: 0,
      bottom: 2,
      left: 0,
    });
    const [text] = node.children;
    assert.equal(text.content, "ORDERS");
    assert.equal(text.fontFamily, "$--font-sans");
    assert.equal(text.lineHeight, 1.43);
    assert.equal(text.fontWeight, "500");
  });
});

test("a flex box with no width class hugs its content; a gradient becomes a themed gradient fill", () => {
  const ctx = { index, id: "button", ...fresh() };
  const button = (from) =>
    element({
      display: "inline-flex",
      w: 74,
      cls: "inline-flex px-3 bg-linear-to-r",
      gradient: {
        angle: 90,
        stops: [
          { color: from, position: 0 },
          { color: "#ffffff", position: 1 },
        ],
      },
      children: [
        {
          kind: "text",
          content: "Ask",
          x: 12,
          y: 8,
          w: 24,
          h: 20,
          color: "#ffffff",
          font: "Geist",
          size: 14,
          weight: "500",
          lineHeight: 20,
          letterSpacing: 0,
          transform: "none",
        },
      ],
    });
  const node = convertInstance(
    { "light/A": button("#062372"), "dark/A": button("#3969d9") },
    ctx,
  );
  assert.equal(node.width, undefined);
  assert.equal(node.height, 16);
  assert.equal(node.fill.type, "gradient");
  assert.equal(node.fill.rotation, 270);
  assert.deepEqual(
    node.fill.colors.map((c) => c.color),
    ["$--color-primary", "$--color-primary-foreground"],
  );
  const sized = convertInstance(
    {
      "light/A": { ...button("#062372"), cls: "inline-flex size-9" },
      "dark/A": { ...button("#3969d9"), cls: "inline-flex size-9" },
    },
    ctx,
  );
  assert.equal(sized.width, 74);
});

describe("buildExport and pencilSnippet", () => {
  const snapshot = (bg, mark, input) => ({
    instances: [
      { key: "", row: 0, tree: { ...checkbox(bg, null, input), children: [] } },
      { key: "checked", row: 1, tree: checkbox(bg, mark, input) },
    ],
    surfaces: { 1: "brand" },
  });
  const exported = buildExport({
    id: "checkbox",
    name: "Checkbox",
    story: "design-system-atoms-checkbox--variant-matrix",
    source: "src/ui/checkbox.tsx",
    sourceHash: "abc123",
    snapshots: {
      "light/A": snapshot("#062372", "#ffffff", "#062372"),
      // The dark render lost its check mark: reported, drawn from light/A.
      "dark/A": {
        instances: [
          snapshot("#3969d9", "#ffffff", "#3969d9").instances[0],
          {
            key: "checked",
            row: 1,
            tree: { ...checkbox("#3969d9", null, "#3969d9"), children: [] },
          },
        ],
        surfaces: {},
      },
    },
    index,
    rows: [{ vary: [] }, { vary: ["checked"] }],
  });

  test("names each component and records its variant and source", () => {
    const [plain, checked] = exported.components;
    assert.equal(plain.node.name, "Checkbox/Default");
    assert.equal(checked.node.name, "Checkbox/Checked");
    assert.equal(checked.node.reusable, true);
    assert.deepEqual(checked.node.metadata, {
      type: "ds",
      id: "checkbox",
      variant: { checked: "true" },
      story: "design-system-atoms-checkbox--variant-matrix",
      source: "src/ui/checkbox.tsx",
      sourceHash: "abc123",
    });
    assert.match(
      exported.report.warnings[0],
      /^checked: renders differently under dark\/A/,
    );
  });

  test("the snippet replaces the old section, re-points instances and drops stale variables", () => {
    const snippet = pencilSnippet(exported, {
      "light/A": { mode: "light", brand: "A", host: "app" },
      "dark/A": { mode: "dark", brand: "A", host: "app" },
    });
    // A flat fake document: the old section holds two components, a board
    // elsewhere holds an instance of one of them.
    const nodes = [
      { id: "board", parent: "doc" },
      {
        id: "old",
        parent: "board",
        metadata: { type: "ds-section", id: "checkbox" },
        width: "fill_container",
      },
      {
        id: "o1",
        parent: "old",
        reusable: true,
        metadata: { type: "ds", id: "checkbox", variant: {} },
      },
      // A variant exported as an instance of the base: Pencil keeps its
      // context but not its metadata, so it is found by the context's key.
      {
        id: "o2",
        parent: "old",
        type: "ref",
        ref: "o1",
        reusable: true,
        name: "Checkbox/Checked",
        context:
          "<Checkbox checked />\nsrc/ui/checkbox.tsx\nStorybook: s\nVariant: checked",
      },
      { id: "matrix", parent: "doc" },
      {
        id: "r1",
        parent: "matrix",
        type: "ref",
        ref: "o2",
        name: "Checked",
        x: 8,
      },
    ];
    let variables = {
      "--color-primary": { type: "color", value: "#062372" },
      "--ds-checkbox-9": { type: "color", value: "#ffffff" },
    };
    const children = (id) => nodes.filter((n) => n.parent === id);
    const visit = (fn) => {
      const out = [];
      const walk = (id, parentCtx) =>
        children(id).forEach((node, index) => {
          const ctx = { node, parentCtx, index };
          const hit = fn(node, ctx);
          if (hit !== undefined) out.push(hit);
          walk(node.id, ctx);
        });
      walk("doc", undefined);
      return out;
    };
    let next = 0;
    const api = {
      document: "doc",
      GetVariables: () => ({ variables }),
      SetVariables: (vars, replace) => {
        variables = replace ? vars : { ...variables, ...vars };
      },
      Get: visit,
      Insert: (parent, node) => {
        next += 1;
        nodes.push({ ...node, id: `n${next}`, parent });
        return `n${next}`;
      },
      Move: (id, parent, index) => {
        const node = nodes.splice(
          nodes.findIndex((n) => n.id === id),
          1,
        )[0];
        const siblings = children(parent);
        const at = siblings[index]
          ? nodes.indexOf(siblings[index])
          : nodes.length;
        nodes.splice(at, 0, node);
      },
      Replace: (id, node) => {
        const at = nodes.findIndex((n) => n.id === id);
        nodes[at] = { ...node, id, parent: nodes[at].parent };
      },
      Delete: (id) => {
        const doomed = new Set([id]);
        for (const n of nodes) if (doomed.has(n.parent)) doomed.add(n.id);
        for (let i = nodes.length - 1; i >= 0; i -= 1)
          if (doomed.has(nodes[i].id)) nodes.splice(i, 1);
      },
      Print: () => {},
      TakeScreenshot: () => {},
    };
    new Function(...Object.keys(api), snippet)(...Object.values(api));

    const [section] = children("board");
    assert.equal(section.metadata.type, "ds-section");
    assert.equal(section.width, "fill_container");
    assert.equal(
      nodes.some((n) => ["old", "o1", "o2"].includes(n.id)),
      false,
    );
    // One group per matrix row, headed by its axes, each instance captioned.
    const groups = children(section.id).filter((n) => n.name !== "Header");
    assert.deepEqual(
      groups.map((g) => g.name),
      ["Example", "Checked"],
    );
    const [stage] = children(groups[1].id);
    assert.equal(stage.fill, "$--color-primary");
    const [line] = children(stage.id);
    const [cell] = children(line.id);
    assert.deepEqual(
      children(cell.id).map((n) => n.name),
      ["Checkbox/Checked", "Caption"],
    );
    assert.equal(children(cell.id)[1].content, "checked");
    const checked = nodes.find((n) => n.name === "Checkbox/Checked");
    assert.equal(nodes.find((n) => n.id === "r1").ref, checked.id);
    assert.equal(nodes.find((n) => n.id === "r1").x, 8);
    assert.equal("--ds-checkbox-9" in variables, false);
    assert.equal("--color-primary" in variables, true);
  });
});

describe("section layout", () => {
  test("a row is headed by the axes it varies", () => {
    assert.equal(rowLabel(["variant", "disabled"]), "Variant × Disabled");
    assert.equal(rowLabel(["aria-invalid"]), "Invalid");
    assert.equal(rowLabel(["borderStyle"]), "Border style");
    assert.equal(rowLabel([]), "Example");
  });

  test("an instance is captioned with its values on the row's axes", () => {
    assert.equal(
      caption("disabled&variant=outline", ["variant", "disabled"]),
      "outline · disabled",
    );
    assert.equal(caption("size=sm", ["size"]), "sm");
    assert.equal(
      caption("showCloseButton=false", ["showCloseButton"]),
      "no close button",
    );
    assert.equal(caption("", ["variant"]), "default");
    assert.equal(caption("aria-invalid&variant=field", []), "invalid · field");
  });

  test("a long row breaks into lines", () => {
    const wide = buildExport({
      id: "badge",
      name: "Badge",
      story: "s",
      source: "src/ui/badge.tsx",
      sourceHash: "h",
      snapshots: {
        "light/A": {
          instances: Array.from({ length: 30 }, (_, i) => ({
            key: `variant=v${i}`,
            row: 0,
            tree: element({ w: 80 }),
          })),
          surfaces: {},
        },
      },
      index: { ...index, themes: ["light/A"] },
      rows: [{ vary: ["variant"] }],
    });
    const data = JSON.parse(
      pencilSnippet(wide, { "light/A": {} })
        .split("\n")[0]
        .replace(/^const D=|;$/g, ""),
    );
    const lines = data.rows[0].lines.map((l) => l.length);
    assert.equal(
      lines.reduce((a, b) => a + b),
      30,
    );
    assert.ok(lines.length > 1);
  });
});

describe("design-library structure", () => {
  test("names layers so instances can override them by name", () => {
    const root = nameLayers({
      type: "frame",
      name: "Button",
      children: [
        { type: "icon", name: "Icon" },
        { type: "text", name: "Label" },
        { type: "icon", name: "Icon" },
        {
          type: "frame",
          name: "Badge",
          children: [{ type: "text", name: "Label" }],
        },
      ],
    });
    assert.deepEqual(
      root.children.map((c) => c.name),
      ["Leading Icon", "Label", "Trailing Icon", "Badge"],
    );
    assert.equal(root.children[3].children[0].name, "Label 2");
  });

  test("a variant with the same layers is an instance of the base that overrides only what differs", () => {
    const base = {
      type: "frame",
      name: "Button/Default",
      fill: "$--color-primary",
      width: 80,
      children: [
        {
          type: "text",
          name: "Label",
          content: "Button",
          fill: "$--color-primary-foreground",
        },
      ],
    };
    const ghost = {
      type: "frame",
      name: "Button/Ghost",
      children: [
        {
          type: "text",
          name: "Label",
          content: "Button",
          fill: "$--color-muted-foreground",
        },
      ],
    };
    assert.deepEqual(asVariant(base, ghost), {
      type: "ref",
      ref: "@base",
      fill: "#00000000",
      width: "fit_content",
      descendants: { Label: { fill: "$--color-muted-foreground" } },
    });
    const iconOnly = { ...ghost, children: [{ type: "icon", name: "Icon" }] };
    assert.equal(asVariant(base, iconOnly), null);
  });

  test("context records the variant key, read back across re-exports", () => {
    assert.equal(
      contextKey(codeLink("Button", "size=sm", "s", "t")),
      "size=sm",
    );
    assert.equal(contextKey(codeLink("Button", "", "s", "t")), "");
    assert.equal(contextKey("<Button />\nsrc\nStorybook: x"), null);
  });

  test("context links back to the code", () => {
    assert.equal(
      codeLink(
        "Button",
        "disabled&variant=outline",
        "src/ui/button.tsx",
        "atoms-button--variant-matrix",
        "packages/components",
      ),
      '<Button disabled variant="outline" />\npackages/components/src/ui/button.tsx\nStorybook: atoms-button--variant-matrix\nVariant: disabled&variant=outline',
    );
  });

  test("a text-only wrapper becomes its text; a declared slot becomes an empty slot frame", () => {
    const ctx = {
      index,
      id: "card",
      ...fresh(),
      slots: { "card-content": ["button"] },
    };
    const text = (content) => ({
      kind: "text",
      content,
      x: 0,
      y: 0,
      w: 60,
      h: 20,
      color: "#062372",
      font: "Geist",
      size: 14,
      weight: "600",
      lineHeight: 20,
      letterSpacing: 0,
      transform: "none",
    });
    const card = element({
      slot: "card",
      display: "flex",
      direction: "column",
      w: 200,
      h: 120,
      bg: "#ffffff",
      children: [
        element({ slot: "card-title", h: 20, children: [text("Orders")] }),
        element({
          slot: "card-content",
          display: "flex",
          direction: "column",
          y: 40,
          h: 60,
          children: [text("Body")],
        }),
      ],
    });
    const node = convertInstance({ "light/A": card, "dark/A": card }, ctx);
    const [title, content] = node.children;
    assert.deepEqual(
      [title.type, title.name, title.context, title.content],
      ["text", "Title", "card-title", "Orders"],
    );
    assert.deepEqual(
      [content.name, content.slot, content.children],
      ["Content", ["@button"], []],
    );
  });
});

describe("centred boxes around one text", () => {
  const day = (overrides) =>
    element({
      w: 28,
      h: 28,
      children: [
        {
          kind: "text",
          content: "18",
          x: 9,
          y: 7,
          w: 10,
          h: 14,
          color: "#0a0a0f",
          font: "Geist",
          size: 14,
          weight: "400",
          lineHeight: 14,
          letterSpacing: 0,
          transform: "none",
        },
      ],
      ...overrides,
    });
  const row = (cell) =>
    element({
      display: "flex",
      w: 56,
      h: 28,
      children: [cell, { ...cell, x: 28 }],
    });

  test("a flex cell that centres its label stays a frame of its size", () => {
    const ctx = { index, id: "calendar", ...fresh() };
    const cell = day({
      display: "flex",
      justify: "center",
      align: "center",
      cls: "size-7",
    });
    const [first] = convertInstance({ "light/A": row(cell) }, ctx).children;
    assert.equal(first.type, "frame");
    assert.equal(first.width, 28);
    assert.equal(first.justifyContent, "center");
  });

  test("a block with centred text stays a frame and centres its child", () => {
    const ctx = { index, id: "calendar", ...fresh() };
    const cell = day({ textAlign: "center" });
    const [first] = convertInstance({ "light/A": row(cell) }, ctx).children;
    assert.equal(first.type, "frame");
    assert.equal(first.alignItems, "center");
    // Vertical inset only: the centring places it across.
    assert.deepEqual(first.padding, [7, 0]);
  });

  test("a wrapper the text fills is still just the text", () => {
    const ctx = { index, id: "calendar", ...fresh() };
    const cell = day({ display: "flex", align: "center", w: 10, h: 14 });
    const [first] = convertInstance({ "light/A": row(cell) }, ctx).children;
    assert.equal(first.type, "text");
  });
});

test("a child stretched across a column fills it; a narrower one keeps its width", () => {
  const ctx = { index, id: "dialog", ...fresh() };
  const header = (w) =>
    element({
      display: "flex",
      w,
      h: 40,
      border: { widths: [0, 0, 1, 0], colors: [null, null, "#d1d5db", null] },
    });
  const column = element({
    display: "flex",
    direction: "column",
    w: 220,
    h: 100,
    padding: [0, 10, 0, 10],
    children: [header(200), { ...header(120), y: 40 }],
  });
  const [full, narrow] = convertInstance({ "light/A": column }, ctx).children;
  assert.equal(full.width, "fill_container");
  assert.equal(narrow.width, 120);
});

test("a flex-1 child fills its flex parent's main axis", () => {
  const ctx = { index, id: "drawer", ...fresh() };
  const panel = element({
    display: "flex",
    direction: "column",
    w: 300,
    h: 400,
    children: [
      element({
        cls: "flex-1 overflow-auto",
        w: 300,
        h: 340,
        display: "flex",
        children: [element({ w: 20, h: 20 })],
      }),
      element({
        cls: "mt-auto",
        y: 340,
        w: 300,
        h: 60,
        display: "flex",
        children: [element({ w: 20, h: 20 })],
      }),
    ],
  });
  const [body, footer] = convertInstance({ "light/A": panel }, ctx).children;
  assert.equal(body.height, "fill_container");
  assert.equal(footer.height, 60);
});

test("the widest child of a centred column keeps its width; it wasn't stretched", () => {
  const ctx = { index, id: "empty", ...fresh() };
  const column = element({
    display: "flex",
    direction: "column",
    align: "center",
    w: 200,
    h: 60,
    children: [
      element({
        display: "flex",
        w: 200,
        h: 20,
        children: [element({ w: 10, h: 10 })],
      }),
      element({
        display: "flex",
        y: 20,
        x: 50,
        w: 100,
        h: 20,
        children: [element({ w: 10, h: 10 })],
      }),
    ],
  });
  const [widest] = convertInstance({ "light/A": column }, ctx).children;
  assert.notEqual(widest.width, "fill_container");
});

test("a flex column stretched across its parent passes the stretch on to its children", () => {
  const ctx = { index, id: "drawer", ...fresh() };
  const button = (y) =>
    element({
      display: "inline-flex",
      y,
      w: 280,
      h: 36,
      children: [element({ w: 40, h: 16 })],
    });
  const panel = element({
    display: "flex",
    direction: "column",
    w: 300,
    h: 200,
    children: [
      element({
        cls: "mt-auto flex shrink-0 flex-col gap-2 p-4 pt-0",
        display: "flex",
        direction: "column",
        y: 100,
        w: 300,
        h: 96,
        padding: [0, 10, 16, 10],
        children: [button(100), button(144)],
      }),
    ],
  });
  const [footer] = convertInstance({ "light/A": panel }, ctx).children;
  assert.equal(footer.width, "fill_container");
  assert.deepEqual(
    footer.children.map((b) => b.width),
    ["fill_container", "fill_container"],
  );
});

test("a flex item moved with order-last comes last in Pencil too", () => {
  const ctx = { index, id: "drawer", ...fresh() };
  const popup = element({
    display: "flex",
    w: 300,
    h: 200,
    children: [
      element({
        slot: "drawer-swipe-handle",
        order: 9999,
        x: 288,
        w: 12,
        h: 200,
      }),
      element({
        slot: "drawer-content",
        w: 288,
        h: 200,
        children: [element({ w: 20, h: 20 })],
      }),
    ],
  });
  const names = convertInstance({ "light/A": popup }, ctx).children.map(
    (c) => c.context,
  );
  assert.deepEqual(names, ["drawer-content", "drawer-swipe-handle"]);
});

test("an ml-auto item stays at the row's end: the sibling before it fills", () => {
  const ctx = { index, id: "sonner", ...fresh() };
  const toast = element({
    display: "flex",
    cls: "w-[356px]",
    w: 356,
    h: 64,
    children: [
      element({ slot: "content", w: 140, h: 40, children: [element({ w: 140, h: 20 })] }),
      element({
        slot: "action",
        autoMargin: ["Left"],
        bg: "#0a0a0a",
        x: 276,
        w: 80,
        h: 28,
        children: [element({ w: 60, h: 20 })],
      }),
    ],
  });
  const [content, action] = convertInstance({ "light/A": toast }, ctx).children;
  assert.equal(content.width, "fill_container");
  assert.notEqual(action.width, "fill_container");
});

test("an ms-auto item after a bordered button gets a spacer, not a stretched button", () => {
  const ctx = { index, id: "filters", ...fresh() };
  const bordered = { widths: [1, 1, 1, 1], colors: ["#e5e7eb", "#e5e7eb", "#e5e7eb", "#e5e7eb"] };
  const footer = element({
    display: "flex",
    cls: "w-[500px]",
    w: 500,
    h: 36,
    children: [
      element({ slot: "add", border: bordered, w: 100, h: 36, children: [element({ w: 60, h: 20 })] }),
      element({ slot: "clear", autoMargin: ["Left"], x: 430, w: 70, h: 36, children: [element({ w: 60, h: 20 })] }),
    ],
  });
  const kids = convertInstance({ "light/A": footer }, ctx).children;
  assert.deepEqual(kids.map((k) => k.name), ["Add", "Spacer", "Clear"]);
  assert.equal(kids[1].width, "fill_container");
  assert.notEqual(kids[0].width, "fill_container");
});

test("a flex-1 wrapper around one text keeps its fill when it collapses to the text", () => {
  const ctx = { index, id: "cascader", ...fresh() };
  const item = element({
    display: "flex",
    cls: "w-[240px]",
    w: 240,
    h: 28,
    children: [
      element({ cls: "flex-1", w: 200, h: 20, children: [
          { kind: "text", content: "East", x: 0, y: 0, w: 30, h: 20, color: "#0a0a0a", font: "Geist", size: 14, weight: "400", lineHeight: 20, transform: "none" },
        ],
      }),
      element({ slot: "count", w: 30, h: 20, children: [element({ w: 20, h: 20 })] }),
    ],
  });
  const [label] = convertInstance({ "light/A": item }, ctx).children;
  assert.equal(label.type, "text");
  assert.equal(label.width, "fill_container");
  assert.equal(label.textGrowth, "fixed-width");
});

test("a translated child (a checked switch's thumb) keeps its drawn position", () => {
  const ctx = { index, id: "switch", ...fresh() };
  const track = element({
    display: "inline-flex",
    cls: "w-11 h-6",
    w: 44,
    h: 24,
    children: [element({ slot: "switch-thumb", translated: true, x: 22, y: 2, w: 20, h: 20, bg: "#ffffff" })],
  });
  const [thumb] = convertInstance({ "light/A": track }, ctx).children;
  assert.equal(thumb.layoutPosition, "absolute");
  assert.equal(thumb.x, 22);
});

describe("bindFont", () => {
  const STORES = [
    { key: "hodges", pencil: { store: "hodges" } },
    { key: "iar", pencil: { store: "iar" } },
  ];
  const store = (hodges, iar) => ({
    type: "string",
    value: [
      { value: hodges, theme: { store: "hodges" } },
      { value: iar, theme: { store: "iar" } },
    ],
  });
  const fonts = variableIndex(
    {
      "--font-sans": store("system-ui", "Figtree"),
      "--font-body": store("system-ui", "Figtree"),
      "--font-heading": store("hodgesGoudy", "Figtree"),
      "--font-serif": store("hodgesGoudy", "Figtree"),
      "--font-display": store("hodgesFranklin", "Figtree"),
      "--font-mono": { type: "string", value: "JetBrains Mono" },
    },
    STORES,
  );

  test("binds the variable whose family matches in every theme", () => {
    assert.equal(
      bindFont(
        { hodges: '"hodgesFranklin", Impact, sans-serif', iar: '"Figtree", Arial' },
        fonts,
      ),
      "$--font-display",
    );
    assert.equal(
      bindFont({ hodges: "JetBrains Mono", iar: "JetBrains Mono" }, fonts),
      "$--font-mono",
    );
  });

  test("breaks a tie between equal variables by rank, then name", () => {
    assert.equal(
      bindFont({ hodges: "hodgesGoudy, serif", iar: "Figtree" }, fonts),
      "$--font-heading",
    );
  });

  test("falls back to a first-theme match, then to the family itself", () => {
    // A face only one theme swaps in (an inline style) still binds by the first theme.
    assert.equal(
      bindFont({ hodges: "hodgesFranklin", iar: "Arial" }, fonts),
      "$--font-display",
    );
    assert.equal(
      bindFont({ hodges: '"Courier New", monospace', iar: "Courier New" }, fonts),
      "Courier New",
    );
  });
});
