import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "./config.mjs";
import { SCAFFOLD, initialConfig } from "./init.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("the written config loads and keeps what init detected", () => {
  const file = join(mkdtempSync(join(tmpdir(), "pen-sync-init-")), "pen-sync.config.json");
  writeFileSync(
    file,
    JSON.stringify(initialConfig({ pkg: "packages/ui", tokenSource: "src/app.css", playwright: "package.json", prefix: "acme" })),
  );
  const config = loadConfig(file);
  assert.equal(config.package, "packages/ui");
  assert.equal(config.tokenSource, "src/app.css");
  assert.equal(config.metadataPrefix, "acme");
  assert.deepEqual(config.themes.map((t) => t.key), ["light", "dark"]);
});

test("the scaffold makes one slot board per level under the prefix", () => {
  const snippet = SCAFFOLD("acme");
  for (const level of ["atom", "molecule", "organism", "template"])
    assert.match(snippet, new RegExp(`"type":"acme-slot","level":"${level}"`));
});
