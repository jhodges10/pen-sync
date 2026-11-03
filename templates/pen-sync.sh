#!/usr/bin/env bash
#
# Runs a pen-sync script from the release the repo pins:
#
#   scripts/pen-sync <script> [args...]      e.g. scripts/pen-sync variants --check
#
# The release is the `ref` on the pen-sync marketplace in .claude/settings.json, so Claude
# Code, the Makefile and CI all run the same version. Claude Code's install is used when its
# version matches; otherwise (CI, other editors) the tag is downloaded once into
# node_modules/.cache/pen-sync/<ref>. PEN_SYNC_DIR overrides both, e.g. a local checkout.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
script="${1:?usage: scripts/pen-sync <script> [args...]}"
shift

if [ -z "${PEN_SYNC_DIR:-}" ]; then
  PEN_SYNC_DIR="$(ROOT="$root" node --input-type=module -e '
    import { execFileSync } from "node:child_process";
    import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
    import { homedir } from "node:os";
    import { join } from "node:path";
    const fail = (message) => {
      console.error(`scripts/pen-sync: ${message}`);
      process.exit(1);
    };
    const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {});
    const root = process.env.ROOT;
    const source = read(join(root, ".claude/settings.json")).extraKnownMarketplaces?.["pen-sync"]?.source;
    const ref = source?.ref;
    if (!ref) fail("pin pen-sync with a ref in .claude/settings.json → extraKnownMarketplaces");
    const installed = read(join(homedir(), ".claude/plugins/installed_plugins.json")).plugins?.["pen-sync@pen-sync"] ?? [];
    const match = installed.find((p) => p.version === ref.replace(/^v/, "") && existsSync(p.installPath));
    if (match) {
      console.log(match.installPath);
    } else {
      const dir = join(root, "node_modules/.cache/pen-sync", ref);
      if (!existsSync(join(dir, "scripts"))) {
        // The tag tarball, into a temporary folder first so a failed download leaves
        // nothing half made.
        const tmp = `${dir}.${process.pid}`;
        try {
          mkdirSync(tmp, { recursive: true });
          execFileSync("sh", ["-c", `curl -fsSL "$0" | tar -xz --strip-components=1 -C "$1"`,
            `https://codeload.github.com/${source.repo}/tar.gz/refs/tags/${ref}`, tmp],
            { stdio: ["ignore", "ignore", "inherit"] });
          rmSync(dir, { recursive: true, force: true });
          renameSync(tmp, dir);
        } catch {
          rmSync(tmp, { recursive: true, force: true });
          fail(`could not download ${source.repo} at ${ref}`);
        }
      }
      console.log(dir);
    }
  ')"
fi

if [ ! -f "$PEN_SYNC_DIR/scripts/$script.mjs" ]; then
  echo "scripts/pen-sync: no script \"$script\" in $PEN_SYNC_DIR/scripts" >&2
  exit 1
fi
exec node "$PEN_SYNC_DIR/scripts/$script.mjs" "$@"
