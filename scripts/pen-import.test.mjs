import assert from "node:assert/strict";
import { test } from "node:test";

import { cell, fillsParent, insertionOrder, refsOf, rewrite, variablesOf } from "./pen-import.mjs";

test("a component comes after what it instantiates, even nested in another source", () => {
  const sources = new Map([
    ["a", { id: "a", children: [{ id: "x", type: "ref", ref: "inner" }] }],
    ["b", { id: "b", children: [{ id: "inner" }] }],
  ]);
  assert.deepEqual(insertionOrder(sources), ["b", "a"]);
});

test("a reference nothing provides and a cycle both fail", () => {
  assert.throws(() => insertionOrder(new Map([["a", { id: "a", type: "ref", ref: "z" }]])), /wasn't read/);
  assert.throws(
    () =>
      insertionOrder(
        new Map([
          ["a", { id: "a", type: "ref", ref: "b" }],
          ["b", { id: "b", type: "ref", ref: "a" }],
        ]),
      ),
    /cycle/,
  );
});

test("an instance and its overrides point at the copies, ids dropped", () => {
  const out = rewrite(
    { id: "i", x: 5, y: 6, type: "ref", ref: "m", descendants: { k: { content: "yo" }, "k/l": { fill: "$a" } } },
    { m: "M", k: "K", l: "L" },
  );
  assert.deepEqual(out, { type: "ref", ref: "M", descendants: { K: { content: "yo" }, "K/L": { fill: "$a" } } });
});

test("an instance of something not yet copied fails instead of losing its look", () => {
  assert.throws(() => rewrite({ id: "i", type: "ref", ref: "m" }, {}), /no copy of component m/);
  assert.throws(() => rewrite({ id: "i", type: "ref", ref: "m", descendants: { k: {} } }, { m: "M" }), /override target k/);
});

test("a child keeps its place, and variables and references are found through a tree", () => {
  const tree = { id: "r", x: 9, children: [{ id: "c", x: 3, fill: "$bg-canvas", children: [{ id: "d", type: "ref", ref: "m" }] }] };
  assert.equal(rewrite(tree, { m: "M" }).x, undefined);
  assert.equal(rewrite(tree, { m: "M" }).children[0].x, 3);
  assert.deepEqual(variablesOf(tree), ["bg-canvas"]);
  assert.deepEqual([...refsOf(tree)], ["m"]);
});

test("an override that replaces a child with another component is followed and rewritten", () => {
  const instance = {
    id: "i",
    type: "ref",
    ref: "m",
    descendants: { k: { id: "new", type: "ref", ref: "other", descendants: { z: { stroke: "#fff" } } } },
  };
  assert.deepEqual([...refsOf(instance)].sort(), ["m", "other"]);
  assert.deepEqual(rewrite(instance, { m: "M", k: "K", other: "O", z: "Z" }), {
    type: "ref",
    ref: "M",
    descendants: { K: { type: "ref", ref: "O", descendants: { Z: { stroke: "#fff" } } } },
  });
});

test("only a node that fills its parent gets a cell, sized on the axes it fills", () => {
  assert.equal(fillsParent({ width: 40, height: "fit_content" }), false);
  assert.deepEqual(cell({ width: "fill_container", height: 20 }, { width: 300, height: 20 }), { type: "frame", name: "Cell", width: 300 });
});
