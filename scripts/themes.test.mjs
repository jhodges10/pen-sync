import assert from "node:assert/strict";
import { test } from "node:test";

import { themeReady } from "./themes.mjs";

/** Runs `themeReady` against a fake `<html>` with these classes and attributes. */
const ready = (rootClasses, rootAttrs, html, others) => {
  globalThis.document = {
    documentElement: {
      classList: { contains: (c) => rootClasses.includes(c) },
      getAttribute: (name) => rootAttrs[name] ?? null,
    },
  };
  try {
    return themeReady({ html, others });
  } finally {
    delete globalThis.document;
  }
};

const LIGHT_A = {};
const DARK_B = { class: "dark", "data-brand": "B" };
const OTHERS = [LIGHT_A, { class: "dark" }, { "data-brand": "B" }, DARK_B];

test("a theme is ready when its classes and attributes are on <html>", () => {
  assert.equal(ready(["dark"], { "data-brand": "B" }, DARK_B, OTHERS), true);
  assert.equal(ready([], { "data-brand": "B" }, DARK_B, OTHERS), false);
});

test("another theme's class or value means it isn't ready yet", () => {
  assert.equal(ready(["dark"], {}, LIGHT_A, OTHERS), false);
  assert.equal(ready([], { "data-brand": "B" }, LIGHT_A, OTHERS), false);
  // A default value no theme names still counts as the plain theme.
  assert.equal(ready([], { "data-brand": "A" }, LIGHT_A, OTHERS), true);
});
