import assert from "node:assert/strict";
import { test } from "node:test";

import { READ_SECTION, canonical, diffSection, resolve } from "./pen-diff.mjs";

const base = {
  id: "b1",
  type: "frame",
  name: "Button/Default",
  fill: "$--color-primary",
  cornerRadius: "$--radius-md",
  children: [{ id: "t1", type: "text", name: "Label", fill: "$--color-primary-foreground", content: "Go" }],
};

test("Pencil's stored forms read the same as the export's", () => {
  assert.deepEqual(
    canonical([{ type: "shadow", offset: { x: 0, y: 0 }, blur: 0, color: "#000" }]),
    { color: "#000", type: "shadow" },
  );
  assert.deepEqual(canonical({ top: 1, right: 0, bottom: 0, left: 0 }), { top: 1 });
});

test("an instance's overrides resolve through its base, by id in Pencil and by name in an export", () => {
  const pencilRef = { type: "ref", ref: "b1", fill: "$--color-secondary", descendants: { t1: { fill: "$--color-foreground" } } };
  const exportRef = { type: "ref", ref: "@primary", fill: "$--color-secondary", descendants: { Label: { fill: "$--color-foreground" } } };
  const expected = {
    "": { fill: "$--color-secondary", cornerRadius: "$--radius-md" },
    Label: { fill: "$--color-foreground" },
  };
  assert.deepEqual(resolve(pencilRef, { b1: base }), expected);
  assert.deepEqual(resolve(exportRef, {}, base), expected);
});

test("a section diff lists design changes per variant and layer, and variants one side lacks", () => {
  const recolored = structuredClone(base);
  recolored.children[0].fill = "$--color-accent";
  recolored.children[0].content = "Save"; // sample text is not a design change
  const pencil = {
    section: "s",
    components: { "": recolored, "size=lg": { ...base, id: "b2" } },
    bases: { b1: recolored },
  };
  const exported = {
    components: [
      { key: "", base: "primary", node: base },
      { key: "variant=ghost", node: { type: "ref", ref: "@primary", fill: "$--color-ghost" } },
    ],
  };
  assert.deepEqual(diffSection(pencil, exported), [
    { variant: "", layer: "Label", prop: "fill", code: "$--color-primary-foreground", pencil: "$--color-accent" },
    { variant: "variant=ghost", missing: "pencil" },
    { variant: "size=lg", missing: "code" },
  ]);
});

test("the section reader looks for the configured prefix", () => {
  assert.match(READ_SECTION("acme-ds", "card"), /"acme-ds-section"&&n\.metadata\.id==="card"/);
});
