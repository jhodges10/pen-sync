/**
 * What a Pencil node is in code: the registry component and variant it
 * belongs to, its source file, story and JSX, and the token variables it uses.
 *
 *   node $DS/pen-inspect.mjs            # the nodes selected in the desktop app
 *   node $DS/pen-inspect.mjs aB3xY Qz9  # these node ids
 *   node $DS/pen-inspect.mjs --json
 *
 * A node inside a library component resolves to that component; an instance
 * of one (a designer's screen) resolves through its `ref` to the component it
 * uses. A node the sync didn't write and that uses no library component says
 * so: it is hand-drawn, with no code behind it yet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { config, registryPath, repo } from "./config.mjs";
import { call, openShell, parseResult } from "./pen-sync.mjs";
import { isMain } from "./main.mjs";

/** Node ids in `get_app_state`'s "Selected nodes" line. */
export function selectedIds(appState) {
  const line = /Selected nodes:([^\n]*)/.exec(appState)?.[1] ?? "";
  return [...line.matchAll(/`([A-Za-z0-9]+)`/g)].map((m) => m[1]);
}

/**
 * Runs in Pencil: for each id, the node, the library component it is part of
 * or an instance of (its context and metadata), and every `$--` variable used
 * at or below it.
 */
export const INSPECT = (prefix, ids) =>
  `const IDS=${JSON.stringify(ids)};const out={};` +
  `const byId={};Get((n,c)=>{byId[n.id]={n,c};return undefined});` +
  `const lib=(n)=>n.reusable&&/\\nVariant: /.test(n.context||"");` +
  `const vars=(n)=>[...new Set((JSON.stringify(n).match(/"\\$[a-zA-Z-][^"]*"/g)||[]).map((v)=>v.slice(2,-1)))].sort();` +
  `for(const id of IDS){const hit=byId[id];if(!hit){out[id]={error:"no such node"};continue}` +
  `let comp=null;for(let p={node:hit.n,parentCtx:hit.c.parentCtx};p&&!comp;p=p.parentCtx)if(lib(p.node))comp=p.node;` +
  `let via=null;if(!comp){for(let p={node:hit.n,parentCtx:hit.c.parentCtx};p&&!comp;p=p.parentCtx){const r=p.node.type==="ref"&&byId[p.node.ref];if(r&&lib(r.n)){comp=r.n;via=p.node.id}}}` +
  `let meta=comp&&comp.metadata;if(comp&&!meta&&comp.type==="ref"&&byId[comp.ref])meta=byId[comp.ref].n.metadata;` +
  `out[id]={name:hit.n.name,type:hit.n.type,component:comp?{id:comp.id,name:comp.name,context:comp.context,registry:meta&&meta.type===${JSON.stringify(prefix)}?meta.id:null}:null,instance:via,variables:vars(hit.n)}}` +
  `Print(JSON.stringify(out))`;

/** `<Button variant="outline" />\nsrc/ui/button.tsx\nStorybook: id\nVariant: key` → its parts. */
export function parseContext(context = "") {
  const [jsx, source, story, variant] = context.split("\n");
  return {
    jsx,
    source,
    story: story?.replace(/^(Storybook|Matrix): /, ""),
    variant: variant?.replace(/^Variant: /, "").replace("(default)", ""),
  };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const app = args.includes("--app")
    ? args[args.indexOf("--app") + 1]
    : "desktop";
  const shell = openShell(["-a", app, "-i", join(repo, config.pen)]);
  await shell.ready;
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  let report;
  try {
    let ids = args.filter(
      (a, i) => !a.startsWith("--") && args[i - 1] !== "--app",
    );
    if (!ids.length) {
      const state = parseResult(await shell.send(call("get_app_state", {})));
      ids = selectedIds(state.text);
      if (!ids.length) {
        console.error(
          "Nothing is selected in Pencil: select a node, or pass node ids.",
        );
        process.exitCode = 1;
      }
    }
    if (!ids.length) report = {};
    const result = !ids.length
      ? null
      : parseResult(
          await shell.send(
            call("execute", {
              description: "Inspect the selected nodes",
              input: INSPECT(config.metadataPrefix, ids),
            }),
          ),
        );
    if (result && !result.ok) throw new Error(result.text);
    if (result)
      report = JSON.parse(
        result.printed.split("\n").find((l) => l.startsWith("{")),
      );
  } finally {
    await shell.close();
  }
  for (const entry of Object.values(report)) {
    if (!entry.component) continue;
    const parts = parseContext(entry.component.context);
    const registered = registry.components.find(
      (c) =>
        c.id === entry.component.registry || parts.source?.endsWith(c.file),
    );
    Object.assign(entry.component, parts, {
      registry: registered?.id ?? entry.component.registry,
      level: registered?.level,
    });
    delete entry.component.context;
  }
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else
    for (const [id, e] of Object.entries(report)) {
      if (e.error) {
        console.log(`${id}: ${e.error}`);
        continue;
      }
      console.log(`${id} "${e.name}" (${e.type})`);
      if (e.component) {
        const c = e.component;
        console.log(
          `  ${e.instance ? `instance of` : `part of`} ${c.name} — ${c.registry ?? "unregistered"}${c.level ? ` (${c.level})` : ""}`,
        );
        console.log(`  ${c.jsx}`);
        console.log(
          `  ${c.source} · story ${c.story}${c.variant ? ` · variant ${c.variant}` : ""}`,
        );
      } else console.log("  hand-drawn: no library component behind it");
      if (e.variables.length)
        console.log(`  tokens: ${e.variables.join(", ")}`);
    }
}
