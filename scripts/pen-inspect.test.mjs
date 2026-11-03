import assert from "node:assert/strict";
import { test } from "node:test";

import { INSPECT, parseContext, selectedIds } from "./pen-inspect.mjs";

test("reads the selected ids from the app state", () => {
  assert.deepEqual(
    selectedIds("## Canvas Editor\n- Selected nodes: `aB3xY` (frame), `Qz9k1` (text)\n- Top-level nodes: `zz`"),
    ["aB3xY", "Qz9k1"],
  );
  assert.deepEqual(selectedIds("- Selected nodes: No nodes are selected"), []);
});

test("splits a component's context into its code links", () => {
  assert.deepEqual(
    parseContext('<Button variant="outline" />\nsrc/ui/button.tsx\nStorybook: atoms-button--variant-matrix\nVariant: variant=outline'),
    {
      jsx: '<Button variant="outline" />',
      source: "src/ui/button.tsx",
      story: "atoms-button--variant-matrix",
      variant: "variant=outline",
    },
  );
  assert.equal(parseContext("<Avatar />\nsrc/ui/avatar.tsx\nStorybook: s\nVariant: (default)").variant, "");
});

test("the inspector carries the ids and the configured prefix", () => {
  const snippet = INSPECT("acme-ds", ["a1"]);
  assert.match(snippet, /const IDS=\["a1"\]/);
  assert.match(snippet, /meta\.type==="acme-ds"/);
});
