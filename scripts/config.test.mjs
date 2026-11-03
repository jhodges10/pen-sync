import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DEFAULTS, findRepo, loadConfig } from "./config.mjs";

const file = (content) => {
  const path = join(mkdtempSync(join(tmpdir(), "pen-sync-")), "c.json");
  writeFileSync(path, JSON.stringify(content));
  return path;
};

test("a missing config file gives the defaults", () => {
  assert.deepEqual(
    loadConfig("/nonexistent/pen-sync.config.json"),
    DEFAULTS,
  );
});

test("a config file overrides the keys it sets and ignores $schema", () => {
  const config = loadConfig(
    file({ $schema: "x", storybook: "http://localhost:6007" }),
  );
  assert.equal(config.storybook, "http://localhost:6007");
  assert.equal(config.package, DEFAULTS.package);
});

test("an unknown key is an error, so a typo can't silently fall back", () => {
  assert.throws(
    () => loadConfig(file({ storyBook: "x" })),
    /unknown key\(s\) storyBook/,
  );
});

test("the repo is the nearest ancestor holding the config file", () => {
  const root = mkdtempSync(join(tmpdir(), "pen-sync-repo-"));
  writeFileSync(join(root, "pen-sync.config.json"), "{}");
  const nested = join(root, "a", "b");
  mkdirSync(nested, { recursive: true });
  assert.equal(findRepo(nested), root);
});
