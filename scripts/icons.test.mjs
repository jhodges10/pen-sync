import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { libraryAlias } from "./export-screen.mjs";
import { iconLists, pickNames, renameIcons } from "./icons.mjs";

test("picks the first alias Pencil knows, else the current name", () => {
  const lists = [
    ["triangle-exclamation-point", "alert-triangle", "triangle-alert"],
    ["brand-new-icon", "older-name"],
  ];
  const names = pickNames(lists, { "triangle-alert": true, "alert-triangle": false });
  assert.equal(names.get("triangle-exclamation-point"), "triangle-alert");
  assert.equal(names.get("brand-new-icon"), "brand-new-icon");
});

test("finds every icon's aliases in a snapshot and renames the converted icons", () => {
  const tree = {
    kind: "element",
    children: [
      { kind: "svg", icon: "a", icons: ["a", "b"] },
      { kind: "element", children: [{ kind: "svg", icon: "plus" }] },
    ],
  };
  assert.deepEqual(iconLists(tree), [["a", "b"]]);
  const node = {
    type: "frame",
    children: [{ type: "icon", icon: "a" }],
    descendants: { x: { children: [{ type: "icon", icon: "a" }] } },
  };
  renameIcons(node, new Map([["a", "b"]]));
  assert.equal(node.children[0].icon, "b");
  assert.equal(node.descendants.x.children[0].icon, "b");
});

test("reads the alias a design file imports the library under", () => {
  const dir = mkdtempSync(join(tmpdir(), "pen-sync-alias-"));
  writeFileSync(join(dir, "lib.pen"), "{}");
  mkdirSync(join(dir, "screens"));
  const app = join(dir, "screens", "app.pen");
  writeFileSync(app, JSON.stringify({ imports: { x: "../other.lib.pen", u: "../lib.pen" } }));
  assert.equal(libraryAlias(app, join(dir, "lib.pen")), "u");
  assert.equal(libraryAlias(app, join(dir, "missing.pen")), null);
  assert.equal(libraryAlias(join(dir, "none.pen"), join(dir, "lib.pen")), null);
});
