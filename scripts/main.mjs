/**
 * Whether the module at `url` is the script node was started with. Compared by
 * real path: a package manager may install the scripts behind a symlink
 * (`node_modules/pen-sync` → a store), where `process.argv[1]` is the link and
 * `import.meta.url` the target.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isMain(url, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(url));
  } catch {
    return false;
  }
}
