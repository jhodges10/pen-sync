#!/usr/bin/env bash
#
# Runs a pen-sync script from the release the repo pins:
#
#   scripts/pen-sync <script> [args...]      e.g. scripts/pen-sync variants --check
#
# The release is the `ref` on the pen-sync marketplace in .claude/settings.json, so Claude
# Code, the Makefile and CI all run the same version. Claude Code's install is used when its
# version matches; otherwise (CI, other editors) the tag is cloned once into
# node_modules/.cache/pen-sync/<ref>. PEN_SYNC_DIR overrides both, e.g. a local checkout.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="${1:?usage: scripts/pen-sync <script> [args...]}"
shift

if [ -z "${PEN_SYNC_DIR:-}" ]; then
  PEN_SYNC_DIR="$(ROOT="$root" node --input-type=module -e '
    import { execFileSync } from "node:child_process";
    import { existsSync, readFileSync } from "node:fs";
    import { homedir } from "node:os";
    import { join } from "node:path";
    const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {});
    const root = process.env.ROOT;
    const source = read(join(root, ".claude/settings.json")).extraKnownMarketplaces?.["pen-sync"]?.source;
    const ref = source?.ref;
    if (!ref) throw new Error("pin pen-sync with a ref in .claude/settings.json → extraKnownMarketplaces");
    const installed = read(join(homedir(), ".claude/plugins/installed_plugins.json")).plugins?.["pen-sync@pen-sync"] ?? [];
    const match = installed.find((p) => p.version === ref.replace(/^v/, "") && existsSync(p.installPath));
    if (match) {
      console.log(match.installPath);
    } else {
      const dir = join(root, "node_modules/.cache/pen-sync", ref);
      if (!existsSync(join(dir, "scripts")))
        execFileSync("git", ["clone", "--quiet", "--depth", "1", "--branch", ref,
          `https://github.com/${source.repo}.git`, dir], { stdio: ["ignore", "ignore", "inherit"] });
      console.log(dir);
    }
  ')"
fi

exec node "$PEN_SYNC_DIR/scripts/$script.mjs" "$@"
