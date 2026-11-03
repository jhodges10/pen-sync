import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { repo } from "./config.mjs";

// A TypeScript with the compiler API: PEN_SYNC_TYPESCRIPT, or a 5.x/6.x in Bun's store.
const store = join(repo, "node_modules/.bun");
const found = existsSync(store)
  ? readdirSync(store)
      .filter((d) => /^typescript@[56]\./.test(d))
      .map((d) => join(store, d, "node_modules/typescript"))
      .find(existsSync)
  : undefined;
// The repo's own TypeScript serves when it has the compiler API (5 or 6).
let own = null;
try {
  own = createRequire(join(repo, "package.json"))("typescript");
} catch {}
if (!own?.createProgram && found) process.env.PEN_SYNC_TYPESCRIPT ??= found;
const available = Boolean(own?.createProgram || process.env.PEN_SYNC_TYPESCRIPT);

test(
  "reads literal unions, merges union prop shapes and keeps asked-for inherited props",
  { skip: !available && "no TypeScript 5 or 6 installed" },
  async () => {
    const { createDocgenSession } = await import("./docgen.mjs");
    const dir = mkdtempSync(join(tmpdir(), "pen-sync-docgen-"));
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, jsx: "react-jsx", noEmit: true } }),
    );
    writeFileSync(
      join(dir, "chip.ts"),
      `type Base = { tone?: "muted" | "loud"; size?: 1 | 2; label: string; hidden?: boolean };
       type Props = (Base & { multiple?: false }) | (Base & { multiple: true; max?: number });
       export function Chip(props: Props) { return null; }`,
    );
    const session = createDocgenSession({ cwd: dir });
    const [chip, missing] = session.describe(
      [
        { dir, specifier: "./chip", exportName: "Chip" },
        { dir, specifier: "./chip", exportName: "Nope" },
      ],
      { inherited: [] },
    );
    const values = Object.fromEntries(chip.props.map((p) => [p.name, p.values]));
    assert.deepEqual(values.tone, ["loud", "muted"]);
    assert.deepEqual(values.size, [1, 2]);
    assert.deepEqual(values.multiple, [false, true], "merged across the union");
    assert.deepEqual(values.hidden, [false, true]);
    assert.equal(values.label, null);
    assert.ok("max" in values, "a prop only one shape has");
    assert.match(missing.error, /no export Nope/);
  },
);
