import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const vendored = (file) => readFileSync(new URL(`../vendor/${file}`, import.meta.url), "utf8");

test("the vendored lz-string is the pinned devDependency's build", () => {
  assert.equal(
    vendored("lz-string.min.cjs"),
    readFileSync(require.resolve("lz-string/libs/lz-string.min.js"), "utf8"),
  );
});

test("the vendored pngjs round-trips an image without node_modules", async () => {
  const { PNG } = (await import("../vendor/pngjs.mjs")).default;
  const png = new PNG({ width: 2, height: 1 });
  png.data.set([255, 0, 0, 255, 0, 0, 255, 255]);
  const back = PNG.sync.read(PNG.sync.write(png));
  assert.deepEqual([...back.data], [255, 0, 0, 255, 0, 0, 255, 255]);
});
