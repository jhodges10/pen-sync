import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { applyOverrides, instanceMatcher, libraryComponents, matchInstance } from "./screen.mjs";

// A library as the sync writes it: a base frame with metadata, a variant that
// is an instance of it, and a card with a slot.
const LIB = {
  children: [
    {
      type: "frame",
      id: "sec",
      metadata: { type: "ds-section", id: "button" },
      children: [
        {
          type: "frame",
          id: "B0",
          name: "Button/Default",
          reusable: true,
          context: "<Button />\nsrc/button.tsx\nStorybook: x\nVariant: (default)",
          metadata: { type: "ds", id: "button", variant: {}, base: true },
          fill: "$--color-primary",
          padding: [8, 16],
          children: [
            { type: "icon", id: "ic", name: "Leading Icon", icon: "plus", width: 16, height: 16 },
            { type: "text", id: "tx", name: "Label", content: "Button", fill: "$--color-primary-foreground" },
          ],
        },
        {
          type: "ref",
          id: "B1",
          ref: "B0",
          name: "Button/Ghost",
          reusable: true,
          context: "<Button variant=\"ghost\" />\nsrc/button.tsx\nStorybook: x\nVariant: variant=ghost",
          fill: "#00000000",
          descendants: { tx: { fill: "$--color-foreground" } },
        },
        {
          type: "frame",
          id: "C0",
          name: "Card/Default",
          reusable: true,
          context: "<Card />\nsrc/card.tsx\nStorybook: y\nVariant: (default)",
          metadata: { type: "ds", id: "card", variant: {}, base: true },
          layout: "vertical",
          stroke: "$--color-border",
          children: [
            { type: "frame", id: "slot", name: "Content", context: "card-content", slot: ["@button"], layout: "vertical", children: [] },
          ],
        },
      ],
    },
  ],
};

describe("libraryComponents", () => {
  const lib = libraryComponents(LIB, "ds");

  test("expands a variant to its base with the overrides applied", () => {
    const ghost = lib.button.find((c) => c.id === "B1");
    assert.equal(ghost.key, "variant=ghost");
    assert.equal(ghost.base, false);
    assert.equal(ghost.tree.fill, "#00000000");
    assert.equal(ghost.tree.children[1].fill, "$--color-foreground");
    // The base is untouched.
    assert.equal(lib.button.find((c) => c.id === "B0").tree.children[1].fill, "$--color-primary-foreground");
  });

  test("files components under their registry id", () => {
    assert.deepEqual(Object.keys(lib).sort(), ["button", "card"]);
  });

  test("applyOverrides replaces a layer an override gives a type", () => {
    const tree = applyOverrides(LIB.children[0].children[0], {
      descendants: { ic: { type: "text", content: "+" } },
    });
    assert.deepEqual(tree.children[0], { type: "text", content: "+", id: "ic" });
  });
});

describe("matchInstance", () => {
  const lib = libraryComponents(LIB, "ds");
  const drawnButton = (fill, text) => ({
    type: "frame",
    name: "button",
    fill,
    padding: [8, 16],
    x: 12,
    y: 4,
    children: [{ type: "text", name: "Label", content: text, fill: "$--color-foreground" }],
  });

  test("overrides what differs and hides a layer the element lacks", () => {
    const { node, cost } = matchInstance(lib.button[1], drawnButton("#00000000", "Save"), { alias: "u" });
    assert.equal(node.ref, "u:B1");
    assert.equal(node.name, "Button");
    assert.equal(node.x, 12);
    assert.deepEqual(node.descendants, {
      "u:ic": { enabled: false },
      "u:tx": { content: "Save" },
    });
    assert.equal(cost, 2);
  });

  test("the matcher picks the variant with the fewest overrides", () => {
    const report = {};
    const match = instanceMatcher(lib, { alias: "u", report });
    const node = match({ ds: "button" }, drawnButton("#00000000", "Save"), { slotChildren: () => [] });
    assert.equal(node.ref, "u:B1");
    assert.deepEqual(report.instances, { button: 1 });
  });

  test("a layer the component doesn't have means no match, drawn by hand", () => {
    const drawn = drawnButton("$--color-primary", "Save");
    drawn.children.push({ type: "frame", name: "Badge", children: [] });
    assert.equal(matchInstance(lib.button[0], drawn, { alias: "u" }), null);
    const report = {};
    assert.equal(instanceMatcher(lib, { alias: "u", report })({ ds: "button" }, drawn, { slotChildren: () => [] }), null);
    assert.deepEqual(report.drawn, { button: 1 });
    assert.equal(instanceMatcher(lib, { alias: "u", report })({ ds: "unknown" }, drawn, { slotChildren: () => [] }), null);
    assert.equal(report.drawn.unknown, 1);
  });

  test("a slot takes the element's content", () => {
    const content = [{ type: "ref", ref: "u:B0" }];
    const drawn = {
      type: "frame",
      name: "div",
      layout: "vertical",
      stroke: "$--color-border",
      children: [{ type: "frame", name: "Content", layout: "vertical", width: 320, children: [{ type: "text", name: "Label", content: "x" }] }],
    };
    const { node } = matchInstance(lib.card[0], drawn, { alias: "u", slotChildren: () => content });
    assert.deepEqual(node.descendants, { "u:slot": { width: 320, children: content } });
  });

  test("an element drawn as its text matches a component wrapping one text", () => {
    const label = {
      children: [
        {
          type: "frame",
          id: "L0",
          name: "Label/Default",
          reusable: true,
          context: "<Label />\nsrc/label.tsx\nStorybook: z\nVariant: (default)",
          metadata: { type: "ds", id: "label", variant: {}, base: true },
          children: [{ type: "text", id: "lt", name: "Label", content: "Label" }],
        },
      ],
    };
    const lib2 = libraryComponents(label, "ds");
    const { node } = matchInstance(lib2.label[0], { type: "text", name: "Label", content: "Email", x: 0, y: 0 }, { alias: "u" });
    assert.deepEqual(node.descendants, { "u:lt": { content: "Email" } });
  });
});
