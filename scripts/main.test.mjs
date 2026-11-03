import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { isMain } from "./main.mjs";

test("a script run through a symlinked package still counts as the main module", () => {
  const dir = mkdtempSync(join(tmpdir(), "pen-sync-main-"));
  const real = join(dir, "real.mjs");
  writeFileSync(real, "");
  const link = join(dir, "link.mjs");
  symlinkSync(real, link);
  assert.equal(isMain(pathToFileURL(real).href, link), true);
  assert.equal(isMain(pathToFileURL(real).href, join(dir, "other.mjs")), false);
  assert.equal(isMain(pathToFileURL(real).href, undefined), false);
});
