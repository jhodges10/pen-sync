import assert from "node:assert/strict";
import { test } from "node:test";

import { commandLine, expandIcons, shapesFromSvg, tokensOf } from "./source-command.mjs";

test("a source command keeps a value with a space as one argument", () => {
  assert.deepEqual(commandLine("bin/app --snap {id} {theme}  {out}", { id: "a b", theme: "$(x)", out: "/t/o.json" }), [
    "bin/app",
    "--snap",
    "a b",
    "$(x)",
    "/t/o.json",
  ]);
});

test("a source command naming an unknown hole fails", () => {
  assert.throws(() => commandLine("bin/app {nope}", {}), /unknown \{nope\}/);
});

test("a stroked icon inherits its paints from the root and scales its stroke", () => {
  const { viewBox, shapes } = shapesFromSvg(
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 2"/><circle cx="12" cy="12" r="3"/></svg>',
    12,
    "#ffffff",
  );
  assert.deepEqual(viewBox, [0, 0, 24, 24]);
  assert.equal(shapes.length, 2);
  assert.deepEqual(shapes[0], { d: "M1 2", stroke: "#ffffff", strokeWidth: 1, fill: null, cap: "round", join: "miter" });
  assert.match(shapes[1].d, /^M9 12a3 3/);
});

test("a filled icon draws in the tint, and a group's attributes reach its shapes only", () => {
  const { shapes } = shapesFromSvg(
    '<svg viewBox="0 0 10 10"><g fill="none" stroke="#000"><rect width="4" height="4"/></g><polygon points="0,0 1,1 2,0"/></svg>',
    10,
    "#123456",
  );
  assert.equal(shapes[0].stroke, "#123456");
  assert.equal(shapes[0].fill, null);
  assert.equal(shapes[1].stroke, null);
  assert.equal(shapes[1].fill, "#123456");
  assert.equal(shapes[1].d, "M0 0L1 1L2 0Z");
});

test("a tree's svg documents become shapes, wherever they are", () => {
  const tree = expandIcons({
    kind: "element",
    children: [{ kind: "svg", w: 24, h: 24, opacity: 1, color: "#fff", source: '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>' }],
  });
  const [icon] = tree.children;
  assert.equal(icon.source, undefined);
  assert.equal(icon.color, undefined);
  assert.equal(icon.shapes[0].fill, "#fff");
});

test("each theme's tokens gather by name", () => {
  const { resolved, roles } = tokensOf({
    dark: { tokens: { "--a": { type: "color", value: "#000000" } }, typography: { body: { fontSize: "12px" } } },
    light: { tokens: { "--a": { type: "color", value: "#ffffff" } } },
  });
  assert.deepEqual(resolved["--a"], { type: "color", values: { dark: "#000000", light: "#ffffff" } });
  assert.deepEqual(roles.body, { dark: { fontSize: "12px" } });
});
