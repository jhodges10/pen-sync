import assert from "node:assert/strict";
import { test } from "node:test";

import { colorClassTokens, hexDistance } from "./binding.mjs";

test("reads color utilities through variant prefixes, skipping opacity and arbitrary values", () => {
  assert.deepEqual(
    colorClassTokens(
      "bg-primary hover:bg-primary/90 data-checked:text-primary-foreground border-[#fff] !border-input outline-ring text-sm",
    ),
    [
      { kind: "bg", token: "primary" },
      { kind: "text", token: "primary-foreground" },
      { kind: "border", token: "input" },
      { kind: "border", token: "ring" },
      { kind: "text", token: "sm" },
    ],
  );
});

test("measures the largest channel difference, alpha included", () => {
  assert.equal(hexDistance("#062372", "#062372ff"), 0);
  assert.equal(hexDistance("#062372", "#072372"), 1);
  assert.equal(hexDistance("#ffffff", "#ffffff1a"), 229);
});

// Two tokens that are equal in light/A: only the class can tell them apart.
const VALUES = {
  "--color-primary": "#062372",
  "--color-ring": "#062372",
  "--color-brand-gold-foreground": "#062372",
  "--color-chart-1": "#062372",
  "--color-border": "#dee1e8",
  "--color-input": "#dee1e8",
  "--color-foreground": "#06070b",
  "--color-card-foreground": "#06070b",
  "--color-status-blue": "#0099e6",
};
const resolve = (name) => VALUES[name];
const names = Object.keys(VALUES);

test("text-current and friends name no token", () => {
  assert.deepEqual(
    colorClassTokens("text-current bg-transparent text-inherit"),
    [],
  );
});
