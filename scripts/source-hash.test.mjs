import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { localImports, sourceHash } from "./source-hash.mjs";

test("hashes a component with the package modules it imports, and changes when either does", () => {
  const root = mkdtempSync(join(tmpdir(), "source-hash-"));
  try {
    mkdirSync(join(root, "src/ui"), { recursive: true });
    mkdirSync(join(root, "src/lib"), { recursive: true });
    writeFileSync(
      join(root, "src/ui/button.tsx"),
      'import { cn } from "react-thing";\nimport { buttonVariants } from "../lib/button-variants";\nimport { Slot } from "./slot";\n',
    );
    writeFileSync(
      join(root, "src/lib/button-variants.ts"),
      "export const buttonVariants = 1;\n",
    );
    writeFileSync(join(root, "src/ui/slot.tsx"), "export const Slot = 1;\n");
    assert.deepEqual(localImports("src/ui/button.tsx", root), [
      "src/lib/button-variants.ts",
      "src/ui/slot.tsx",
    ]);
    const before = sourceHash("src/ui/button.tsx", root);
    assert.match(before, /^[0-9a-f]{12}$/);
    writeFileSync(
      join(root, "src/lib/button-variants.ts"),
      "export const buttonVariants = 2;\n",
    );
    assert.notEqual(sourceHash("src/ui/button.tsx", root), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Zig file's relative @imports count, and a package's don't", () => {
  const root = mkdtempSync(join(tmpdir(), "pen-sync-zig-"));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/widgets.zig"), 'const a = @import("nanoui");\nconst th = @import("theme.zig");\nconst m = @import("missing.zig");\n');
  writeFileSync(join(root, "src/theme.zig"), "pub const x = 1;\n");
  assert.deepEqual(localImports("src/widgets.zig", root), ["src/theme.zig"]);
  const before = sourceHash("src/widgets.zig", root);
  writeFileSync(join(root, "src/theme.zig"), "pub const x = 2;\n");
  assert.notEqual(sourceHash("src/widgets.zig", root), before);
});
