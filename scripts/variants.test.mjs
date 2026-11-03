import assert from "node:assert/strict";
import { test } from "node:test";

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { config, repo } from "./config.mjs";
import { classifyProps, extractVariants } from "./variants.mjs";

test("keeps the package's own literal unions as axes and styled inherited states", () => {
  const { axes, states } = classifyProps(
    [
      { name: "variant", own: true, values: ["default", "outline"] },
      { name: "size", own: true, values: ["default", "sm"] },
      // Own but not a literal union, or with a single value: nothing to vary.
      { name: "children", own: true, values: null },
      { name: "tone", own: true, values: ["neutral"] },
      // Inherited: a state only when the source styles it.
      { name: "disabled", own: false, values: [false, true] },
      { name: "aria-invalid", own: false, values: [false, true] },
      { name: "hidden", own: false, values: [false, true] },
    ],
    'className="disabled:opacity-50 data-disabled:pointer-events-none"',
  );
  assert.deepEqual(axes, {
    size: ["default", "sm"],
    variant: ["default", "outline"],
  });
  assert.deepEqual(states, ["disabled"]);
});

// A TypeScript with the compiler API for the bundled docgen: the repo's own,
// PEN_SYNC_TYPESCRIPT, or none (the test then skips).
let typescript = null;
try {
  typescript = createRequire(join(repo, "package.json"))("typescript");
} catch {}
const canRead = Boolean(process.env.PEN_SYNC_TYPESCRIPT || typescript?.createProgram);

test(
  "reads a component's axes from its real prop types, and names one that doesn't resolve",
  { skip: (config.docgen || canRead) ? false : "no TypeScript 5 or 6 installed" },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "pen-sync-variants-"));
    writeFileSync(
      join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
    );
    mkdirSync(join(root, "src/ui"), { recursive: true });
    writeFileSync(
      join(root, "src/ui/chip.ts"),
      `export type ChipProps = { tone?: "loud" | "muted"; size?: "md" | "sm"; label?: string; pill?: boolean };
       export function Chip(props: ChipProps) { return null; }`,
    );
    const out = await extractVariants(
      [{ id: "chip", name: "Chip", file: "src/ui/chip.ts" }],
      root,
    );
    assert.deepEqual(out.chip.axes, {
      pill: [false, true],
      size: ["md", "sm"],
      tone: ["loud", "muted"],
    });
    await assert.rejects(
      () => extractVariants([{ id: "chip", name: "Nope", file: "src/ui/chip.ts" }], root),
      /chip: could not resolve/,
    );
  },
);
