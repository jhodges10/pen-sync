import assert from "node:assert/strict";
import { test } from "node:test";

import {
  matrixFile,
  storiesFile,
  storyExport,
  storyIdSuffix,
} from "./matrix-files.mjs";

test("a component named after its file uses the plain names", () => {
  const button = { id: "button", file: "src/ui/button.tsx" };
  assert.equal(matrixFile(button), "src/ui/button.matrix.ts");
  assert.equal(storiesFile(button), "src/ui/button.stories.tsx");
  assert.equal(storyExport(button), "VariantMatrix");
  assert.equal(storyIdSuffix(button), "variant-matrix");
});

test("another component in the same file gets its own matrix and story", () => {
  const body = { id: "sheet-body", file: "src/ui/sheet.tsx" };
  assert.equal(matrixFile(body), "src/ui/sheet-body.matrix.ts");
  assert.equal(storiesFile(body), "src/ui/sheet.stories.tsx");
  assert.equal(storyExport(body), "VariantMatrixSheetBody");
  assert.equal(storyIdSuffix(body), "variant-matrix-sheet-body");
});
