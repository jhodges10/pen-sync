/**
 * The source hash recorded on each Pencil component (`metadata.sourceHash`):
 * a short sha256 over the registry file and the package-local modules it
 * imports, one level deep (button.tsx + lib/button-variants.ts). When it no
 * longer matches, the component's code changed since its Pencil mirror was
 * synced; `pen-sync.mjs --check` recomputes it with this same function. A
 * matrix edit in the story doesn't change it: `pen-sync.mjs --changed` catches
 * those by comparing exports.
 *
 *   node $DS/source-hash.mjs button badge   # id → hash, as JSON
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { config, packageRoot, registryPath } from "./config.mjs";

/** Package-local files `file` imports (relative or `<packageName>/…`), sorted. */
export function localImports(file, root = packageRoot) {
  const source = readFileSync(join(root, file), "utf8");
  const found = new Set();
  for (const [, specifier] of source.matchAll(/from\s+"([^"]+)"/g)) {
    const base =
      config.packageName && specifier.startsWith(`${config.packageName}/`)
      ? join("src", specifier.slice(config.packageName.length + 1))
      : specifier.startsWith(".")
        ? join(dirname(file), specifier)
        : null;
    if (!base) continue;
    const hit = [".ts", ".tsx", "/index.ts"]
      .map((ext) => base + ext)
      .find((path) => existsSync(join(root, path)));
    if (hit && hit !== file) found.add(relative(root, join(root, hit)));
  }
  return [...found].sort();
}

export function sourceHash(file, root = packageRoot) {
  const hash = createHash("sha256");
  for (const path of [file, ...localImports(file, root)]) {
    hash.update(`${path}\n`).update(readFileSync(join(root, path)));
  }
  return hash.digest("hex").slice(0, 12);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const ids = process.argv.slice(2);
  const out = {};
  for (const component of registry.components) {
    if (ids.length === 0 || ids.includes(component.id))
      out[component.id] = sourceHash(component.file);
  }
  console.log(JSON.stringify(out));
}
