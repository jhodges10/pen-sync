/**
 * Export components and push them into Pencil through the pen.dev CLI, with
 * no payload passing through an agent's tool calls.
 *
 *   node $DS/pen-sync.mjs button card          # into the open desktop app
 *   node $DS/pen-sync.mjs --all --headless     # rewrite the .pen file (CI)
 *   node $DS/pen-sync.mjs --level molecule --changed
 *   node $DS/pen-sync.mjs card --polish        # also export Pencil PNGs for polish-diff
 *   node $DS/pen-sync.mjs --all --polish-only  # only the PNGs, nothing pushed
 *   node $DS/pen-sync.mjs --tokens             # the token variables (tokens file → Pencil)
 *   node $DS/pen-sync.mjs --check              # CI: missing, stale and orphaned sections, read-only
 *
 * Each id is exported with `export-matrix.mjs --pencil-data` (Storybook must
 * be running), then sent to `pen interactive` as one `execute` call: in the
 * running app (`--app`, default `desktop`), where the user saves, or headless
 * on `pen-sync.config.json` → pen, which `save()`s it. `--changed` skips a
 * component whose export matches the last one pushed (kept in
 * `<polishDir>/../pen-sync-push/`). `--pen <file>` targets another file. Needs `pen` on PATH, logged in or `PEN_CLI_KEY`.
 */
import { spawn, execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { config, registryPath, repo } from "./config.mjs";
import { PENCIL_APPLY } from "./dom-to-pen.mjs";
import { toPencilVariables, toSnippets } from "./pencil-variables.mjs";
import { pencilExport } from "./polish-diff.mjs";
import { sourceHash } from "./source-hash.mjs";
import { isMain } from "./main.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** Sections exported per `execute` call in a polish export. */
export const POLISH_BATCH = 4;

/** Strips terminal colors so the shell's output can be parsed. */
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

/** One shell line calling a tool; JSON is valid JS, so the shell parses it. */
export const call = (tool, args) => `${tool}(${JSON.stringify(args)})`;

/**
 * A call's result: whether it ran, what it printed, and how many of Pencil's
 * "Collapsed size" notes it carried (every empty slot frame raises one).
 */
export function parseResult(text) {
  let out = plain(text).trim();
  // Connected to the app, the shell prints the tool's reply as JSON.
  if (out.startsWith("{"))
    try {
      out = JSON.parse(out).message?.trim() ?? out;
    } catch {}
  const printed = out.match(/## Print output\n([\s\S]*?)(?:\n## |\s*$)/)?.[1];
  return {
    ok: out.startsWith("OK"),
    printed: printed?.trim() ?? "",
    collapsed: (out.match(/Collapsed size:/g) ?? []).length,
    text: out,
  };
}

/**
 * A `pen interactive` session: `send` writes one line and resolves with the
 * output up to the next prompt.
 */
export function openShell(args) {
  // `PEN_SYNC_PEN` (or config `penCommand`) runs another CLI, e.g. CI's
  // `bunx @pen.dev/cli@0.3.14`.
  const [command, ...prefix] = (process.env.PEN_SYNC_PEN ?? config.penCommand).split(" ");
  const child = spawn(command, [...prefix, "interactive", ...args], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let waiting = null;
  const PROMPT = /(?:^|\n)pen > ?$/;
  const settle = () => {
    const clean = plain(buffer);
    if (waiting && PROMPT.test(clean)) {
      const output = clean.replace(PROMPT, "");
      buffer = "";
      const resolve = waiting;
      waiting = null;
      resolve(output);
    }
  };
  child.stdout.on("data", (d) => {
    buffer += d;
    settle();
  });
  let errors = "";
  child.stderr.on("data", (d) => {
    errors += d;
  });
  // A call still waiting when the shell exits (Pencil interrupts a call that
  // runs past about 55 s) fails instead of leaving Node to exit silently.
  let fail = null;
  let exited = false;
  child.on("exit", (code) => {
    exited = true;
    fail?.(new Error(`pen exited (${code}): ${plain(errors || buffer).slice(-2000)}`));
  });
  const wait = () =>
    new Promise((resolve, reject) => {
      if (exited) return reject(new Error("pen has exited"));
      waiting = resolve;
      fail = reject;
    });
  const ready = wait();
  return {
    ready,
    /** What the CLI wrote to stderr since the last call: a failed `execute` reports there. */
    takeErrors() {
      const taken = plain(errors).trim();
      errors = "";
      return taken;
    },
    send(line) {
      const reply = wait();
      child.stdin.write(`${line}\n`);
      return reply;
    },
    async close() {
      child.stdin.end("exit()\n");
      await new Promise((r) => child.on("close", r));
    },
  };
}

/**
 * Runs in Pencil: every section and component the sync wrote, by registry id,
 * with the source hashes their metadata records and the variant keys their
 * context does.
 */
export const INVENTORY = (prefix) =>
  `const out={};const ck=(n)=>{const x=/\\nVariant: (.*)$/.exec(n.context||"");return x?(x[1]==="(default)"?"":x[1]):null};` +
  `const sec=(id)=>out[id]??=({sections:0,variants:[],hashes:[]});` +
  `Get((n,c)=>{const m=n.metadata;if(m&&m.type===${JSON.stringify(`${prefix}-section`)})sec(m.id).sections+=1;` +
  `if(n.reusable){let id=m&&m.type===${JSON.stringify(prefix)}?m.id:null;for(let p=c.parentCtx;!id&&p;p=p.parentCtx){const pm=p.node.metadata;if(pm&&pm.type===${JSON.stringify(`${prefix}-section`)})id=pm.id}` +
  `if(id){const e=sec(id);const k=ck(n);if(k!==null)e.variants.push(k);if(m&&m.sourceHash&&!e.hashes.includes(m.sourceHash))e.hashes.push(m.sourceHash)}}return undefined});` +
  `Print(JSON.stringify(out))`;

/**
 * What a check reports: registry components with no section (`missing`),
 * sections for no registry component (`orphans`), sections built from older
 * source (`stale`), and ids with more than one section (`duplicated`).
 */
export function checkInventory(inventory, components, hashOf) {
  const ids = new Set(components.map((c) => c.id));
  const report = { missing: [], orphans: [], stale: [], duplicated: [], ok: [] };
  for (const c of components) {
    const found = inventory[c.id];
    if (!found?.sections) report.missing.push(c.id);
    else if (found.hashes.length && !found.hashes.includes(hashOf(c)))
      report.stale.push(c.id);
    else report.ok.push(c.id);
    if (found?.sections > 1) report.duplicated.push(c.id);
  }
  for (const id of Object.keys(inventory))
    if (!ids.has(id) && inventory[id].sections) report.orphans.push(id);
  return report;
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const VALUED = ["--level", "--app", "--pen", "--chunks"];
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const mirrored = registry.components;
  const level = flag("--level");
  const named = args.filter(
    (a, i) => !a.startsWith("--") && !VALUED.includes(args[i - 1]),
  );
  const check = args.includes("--check");
  const tokens = args.includes("--tokens");
  const ids =
    args.includes("--all") || check
      ? mirrored.map((c) => c.id)
      : level
        ? mirrored.filter((c) => c.level === level).map((c) => c.id)
        : named;
  if (!ids.length && !tokens && !check)
    throw new Error(
      "usage: pen-sync.mjs <id…> | --all | --level <level> | --tokens | --check [--headless] [--app desktop] [--pen file] [--changed] [--polish | --polish-only] [--save] [--json]",
    );
  const unknown = ids.filter((id) => !mirrored.some((c) => c.id === id));
  if (unknown.length) throw new Error(`not in the registry: ${unknown.join(", ")}`);

  // A check reads the file headless and writes nothing; it never needs the app.
  const headless = args.includes("--headless") || check;
  const pen = flag("--pen") ?? join(repo, config.pen);
  const pushed = join(dirname(config.polishDir), "pen-sync-push");
  mkdirSync(pushed, { recursive: true });

  // Export first: a Storybook failure shouldn't leave a half-pushed file.
  const payloads = [];
  const polishOnly = args.includes("--polish-only");
  for (const id of polishOnly || check ? [] : ids) {
    const data = execFileSync(
      process.execPath,
      [join(here, "export-matrix.mjs"), id, "--pencil-data"],
      { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "inherit"] },
    );
    const last = join(pushed, `${id}.js`);
    if (args.includes("--changed") && existsSync(last) && readFileSync(last, "utf8") === data) {
      console.error(`${id}: unchanged`);
      continue;
    }
    payloads.push({ id, data, last });
  }

  const polish = polishOnly || args.includes("--polish");
  if (payloads.length || polish || tokens || check) {
    // A headless check works on a copy, so it can never write the real file.
    let input = pen;
    if (check) {
      input = join(mkdtempSync(join(tmpdir(), "pen-sync-check-")), "check.pen");
      copyFileSync(pen, input);
    }
    const shell = openShell(
      headless
        ? ["-i", input, "-o", input]
        : ["-a", flag("--app") ?? "desktop", "-i", pen],
    );
    await shell.ready;
    const run = async (snippet, description) =>
      parseResult(await shell.send(call("execute", { description, input: snippet })));
    let failed = 0;
    try {
      if (check) {
        const result = await run(INVENTORY(config.metadataPrefix), "List the synced components");
        if (!result.ok) throw new Error(result.text);
        const inventory = JSON.parse(
          result.printed.split("\n").find((l) => l.startsWith("{")) ?? "{}",
        );
        const report = checkInventory(inventory, mirrored, (c) => sourceHash(c.file));
        if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
        else {
          for (const kind of ["missing", "stale", "orphans", "duplicated"])
            if (report[kind].length)
              console.log(`${kind.padEnd(10)} ${report[kind].join(", ")}`);
          console.log(
            `${report.ok.length} of ${mirrored.length} in sync` +
              (report.stale.length ? ` — re-sync: pen-sync.mjs ${report.stale.join(" ")}` : ""),
          );
        }
        if (report.missing.length || report.stale.length || report.orphans.length)
          failed += 1;
      }
      if (tokens) {
        const doc = JSON.parse(readFileSync(join(repo, config.tokens), "utf8"));
        const snippets = toSnippets(doc, Number(flag("--chunks")) || 4);
        for (const [i, snippet] of snippets.entries()) {
          const result = await run(snippet, `Set token variables (${i + 1}/${snippets.length})`);
          if (!result.ok) {
            failed += 1;
            console.error(result.text);
          }
        }
        console.log(`✓ tokens: ${Object.keys(toPencilVariables(doc).variables).length} variables`);
      }
      if (payloads.length || polish) {
        const stored = await run(
          `dsApply=${JSON.stringify(PENCIL_APPLY)};Print("stored",dsApply.length)`,
          "Store the design-system apply step",
        );
        if (!stored.ok) throw new Error(stored.text);
      }
      for (const { id, data, last } of payloads) {
        // A block, so each payload's `const D` is its own.
        const result = await run(`{${data.trim()}}`, `Sync ${id} from code`);
        if (!result.ok) {
          failed += 1;
          console.error(`✗ ${id}\n${result.text}${shell.takeErrors()}`);
          continue;
        }
        const summary = JSON.parse(
          result.printed.split("\n").find((l) => l.startsWith("{")) ?? "{}",
        );
        writeFileSync(last, data);
        const orphans = summary.orphans?.length ? `  ORPHANS ${summary.orphans.join(", ")}` : "";
        console.log(
          `✓ ${id}: ${summary.components} components, ${summary.replaced} replaced, ${summary.repointed} repointed${orphans}`,
        );
      }
      // A few sections per call keeps each export call well inside the limit.
      for (let i = 0; polish && i < ids.length; i += POLISH_BATCH) {
        const batch = ids.slice(i, i + POLISH_BATCH);
        const result = await run(pencilExport(batch), "Export components for polish");
        if (!result.ok) failed += 1;
        console.log(result.ok ? `polish export: ${result.printed}` : result.text);
      }
      if (!check && (headless || args.includes("--save"))) {
        const saved = plain(await shell.send("save()"));
        console.error(saved.trim() || "saved");
      }
    } finally {
      await shell.close();
    }
    if (failed) process.exit(1);
  }
}
