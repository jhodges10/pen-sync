import assert from "node:assert/strict";
import { test } from "node:test";

import { LIBRARY, libraryMarkdown } from "./pen-library.mjs";

test("lists synced components by level with their variants, slots and tokens", () => {
  const md = libraryMarkdown({
    registry: {
      components: [
        { id: "button", name: "Button", level: "atom", file: "src/ui/button.tsx" },
        { id: "card", name: "Card", level: "molecule", file: "src/ui/card.tsx" },
        { id: "chart", name: "Chart", level: "organism", file: "src/ui/chart.tsx" },
      ],
    },
    inventory: {
      button: [["", "Button/Default", "b1"], ["size=sm", "Button/Sm", "b2"]],
      card: [["", "Card/Default", "c1"]],
    },
    slots: { card: { Content: ["Text/Body", "Button/Default"] } },
    tokens: { color: { "--color-primary": {}, "--color-status-blue-soft": {} } },
    pen: "design/x.lib.pen",
    prefix: "ds",
  });
  assert.match(md, /## Atoms\n\n### Button — `button`/);
  assert.match(md, /\| Button\/Sm \| `size=sm` \| `b2` \|/);
  assert.match(md, /\| Button\/Default \| `\(default\)` \| `b1` \|/);
  assert.match(md, /- `Content`: Text\/Body, Button\/Default/);
  assert.match(md, /Not in the file yet: chart\./);
  assert.match(md, /`--color-status-blue-soft`/);
  assert.ok(!md.includes("## Organisms"), "a level with nothing synced is left out");
});

test("the library reader looks for the configured prefix", () => {
  assert.match(LIBRARY("acme-ds"), /m\.type==="acme-ds-section"/);
});
