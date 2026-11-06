/**
 * Copy nodes from a design file into the library, for what no code renders yet.
 * A sync never touches these: they're tagged `<prefix>-design`, and a re-import
 * replaces them, so the source file stays the place to edit them.
 *
 *   node $DS/pen-import.mjs --from design/app.pen --list import.json [--headless]
 *
 * `import.json` is `[{ id, level, group }]`: a source node, the board it lands on
 * (the slot for that `level`, as a sync's sections use), and the heading it sits
 * under. Whatever those nodes reference comes too: other components, in
 * dependency order, and the variables they read. Node ids change on the way in,
 * so instances and their overrides are rewritten to the new ids. A node that fills
 * its parent gets a frame of the size it was drawn at, so a wide board can't stretch it.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { call, openShell, parseResult } from "./pen-sync.mjs";
import { config, repo } from "./config.mjs";
import { isMain } from "./main.mjs";

/**
 * The component ids a node's subtree instantiates, overrides included: an
 * override can replace a child with a whole node, an instance of something else.
 */
export function refsOf(node, found = new Set()) {
  if (node.ref) found.add(node.ref);
  for (const child of node.children ?? []) refsOf(child, found);
  for (const value of Object.values(node.descendants ?? {})) refsOf(value, found);
  return found;
}

/** Every id in a subtree, so a component nested in another isn't copied twice. */
export function idsOf(node, found = new Set()) {
  found.add(node.id);
  for (const child of node.children ?? []) idsOf(child, found);
  return found;
}

/** The `$variables` a subtree reads. */
export function variablesOf(node) {
  return [...new Set((JSON.stringify(node).match(/"\$[a-zA-Z-][^"]*"/g) ?? []).map((v) => v.slice(2, -1)))];
}

/**
 * Sources in the order they can be inserted: each after what it references.
 * `sources` maps id → tree. A reference inside another source's subtree counts
 * as that source. Throws on a reference nothing provides or on a cycle.
 */
export function insertionOrder(sources) {
  const owner = new Map();
  for (const [id, tree] of sources) for (const inner of idsOf(tree)) if (!owner.has(inner)) owner.set(inner, id);
  const order = [];
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") throw new Error(`reference cycle through ${id}`);
    state.set(id, "visiting");
    for (const ref of refsOf(sources.get(id))) {
      const dep = owner.get(ref);
      if (!dep) throw new Error(`${id} references ${ref}, which wasn't read`);
      if (dep !== id) visit(dep);
    }
    state.set(id, "done");
    order.push(id);
  };
  for (const id of sources.keys()) visit(id);
  return order;
}

/**
 * A source tree ready to insert: ids dropped, instances pointed at their copies,
 * override keys (child ids, `a/b` through nested instances) rewritten. A `$map`
 * miss is an error, not a silently unstyled instance.
 */
export function rewrite(node, map, root = true) {
  const { id: _id, x, y, ...rest } = node;
  const out = { ...rest, ...(root ? {} : { ...(x === undefined ? {} : { x }), ...(y === undefined ? {} : { y }) }) };
  if (out.ref) {
    if (!map[out.ref]) throw new Error(`no copy of component ${out.ref}`);
    out.ref = map[out.ref];
  }
  if (out.descendants) {
    out.descendants = Object.fromEntries(
      Object.entries(out.descendants).map(([key, value]) => [
        key
          .split("/")
          .map((part) => {
            if (!map[part]) throw new Error(`no copy of override target ${part}`);
            return map[part];
          })
          .join("/"),
        rewrite(value, map, false),
      ]),
    );
  }
  if (out.children) out.children = out.children.map((c) => rewrite(c, map, false));
  return out;
}

/** Runs in Pencil: pairs a source tree's ids with its copy's, by position. */
const INSERT = (parent, tree, source, meta) =>
  `{const pairs={};const walk=(a,b)=>{pairs[a.id]=b.id;(a.children||[]).forEach((k,i)=>{const o=(b.children||[])[i];if(o)walk(k,o)})};` +
  `const id=Insert(${JSON.stringify(parent)},${JSON.stringify({ ...tree, metadata: { ...tree.metadata, ...meta } })});` +
  `walk(${JSON.stringify(source)},Get(id));Print(JSON.stringify({id,pairs}))}`;

/** Whether a node's size comes from its parent, which the copy won't have. */
export const fillsParent = (tree) => tree.width === "fill_container" || tree.height === "fill_container";

/** The frame that gives such a node the room it had, at the size it was drawn. */
export const cell = (tree, size) => ({
  type: "frame",
  name: "Cell",
  ...(tree.width === "fill_container" ? { width: size.width } : {}),
  ...(tree.height === "fill_container" ? { height: size.height } : {}),
});

const skeleton = (n) => ({ id: n.id, ...(n.children ? { children: n.children.map(skeleton) } : {}) });

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const from = flag("--from");
  const listFile = flag("--list");
  if (!from || !listFile) throw new Error("usage: pen-import.mjs --from <file.pen> --list <import.json> [--headless]");
  const list = JSON.parse(readFileSync(join(repo, listFile), "utf8"));
  const type = `${config.metadataPrefix}-design`;
  const lib = join(repo, config.pen);

  // Read: from a scratch output, so nothing is ever written to the source.
  const source = openShell(["-i", join(repo, from), "-o", join(mkdtempSync(join(tmpdir(), "pen-import-")), "source.pen")]);
  await source.ready;
  const read = async (snippet) => {
    const r = parseResult(await source.send(call("execute", { description: "Read", input: snippet })));
    if (!r.ok) throw new Error(r.text);
    return JSON.parse(r.printed);
  };
  const sources = new Map();
  const wanted = new Map(list.map((e) => [e.id, e]));
  const pending = [...wanted.keys()];
  const known = new Set();
  while (pending.length) {
    const id = pending.pop();
    if (sources.has(id) || known.has(id)) continue;
    const tree = await read(`Print(JSON.stringify(Get(${JSON.stringify(id)},{includePathGeometry:true})))`);
    sources.set(id, tree);
    for (const inner of idsOf(tree)) known.add(inner);
    for (const ref of refsOf(tree)) if (!known.has(ref)) pending.push(ref);
  }
  // What each parent-filling node measured in place: its export, at 2×.
  const { PNG } = (await import(join(dirname(fileURLToPath(import.meta.url)), "../vendor/pngjs.mjs"))).default;
  const sizes = new Map();
  const shots = mkdtempSync(join(tmpdir(), "pen-import-sizes-"));
  for (const [id, tree] of sources) {
    if (!fillsParent(tree)) continue;
    const dir = join(shots, id);
    mkdirSync(dir);
    const r = parseResult(
      await source.send(call("execute", { description: "Measure", input: `Export([${JSON.stringify(id)}],"png",${JSON.stringify(dir)});Print("ok")` })),
    );
    if (!r.ok) throw new Error(`measure ${tree.name}: ${r.text}${source.takeErrors()}`);
    const png = PNG.sync.read(readFileSync(join(dir, readdirSync(dir)[0])));
    sizes.set(id, { width: png.width / 2, height: png.height / 2 });
  }
  const { variables } = await read("Print(JSON.stringify(GetVariables()))");
  await source.close();

  // A component listed on its own and also nested in a copied one is copied once.
  for (const [id, tree] of sources)
    for (const inner of idsOf(tree))
      if (inner !== id && sources.has(inner)) sources.delete(inner);
  const order = insertionOrder(sources);

  const headless = args.includes("--headless");
  const shell = openShell(headless ? ["-i", lib, "-o", lib] : ["-a", flag("--app") ?? "desktop", "-i", lib]);
  await shell.ready;
  const run = async (snippet, description) => {
    const r = parseResult(await shell.send(call("execute", { description, input: snippet })));
    if (!r.ok) throw new Error(`${description}: ${r.text}${shell.takeErrors()}`);
    return r.printed;
  };
  try {
    // Replace the last import. Instances of it elsewhere would break, so say so.
    const removed = await run(
      `const old=[];Get((n,c)=>{if(n.metadata&&n.metadata.type===${JSON.stringify(`${type}-group`)}){old.push(n.id);c.skipChildren()}});for(const id of old)Delete(id);Print(old.length)`,
      "Remove the previous import",
    );
    const needed = [...new Set([...sources.values()].flatMap(variablesOf))].filter((v) => variables[v]);
    const present = JSON.parse(await run("Print(JSON.stringify(Object.keys(GetVariables().variables)))", "List variables"));
    const missing = Object.fromEntries(needed.filter((v) => !present.includes(v)).map((v) => [v, variables[v]]));
    if (Object.keys(missing).length) await run(`SetVariables(${JSON.stringify(missing)});Print("ok")`, "Add variables");

    const slots = JSON.parse(
      await run(
        `const s={};Get((n)=>{if(n.metadata&&n.metadata.type===${JSON.stringify(`${config.metadataPrefix}-slot`)})s[n.metadata.level]=n.id;return undefined});Print(JSON.stringify(s))`,
        "Find the boards",
      ),
    );
    const groups = new Map();
    const groupOf = async (level, name) => {
      const key = `${level}/${name}`;
      if (groups.has(key)) return groups.get(key);
      if (!slots[level]) throw new Error(`no board for level "${level}"`);
      const id = (
        await run(
          `Print(Insert(${JSON.stringify(slots[level])},${JSON.stringify({
            type: "frame",
            name,
            layout: "vertical",
            gap: 24,
            padding: 24,
            width: "fill_container",
            metadata: { type: `${type}-group` },
            children: [{ type: "text", name: "Group Label", content: name, fontSize: 14, fontWeight: "600", fill: config.chrome.heading ? `$${config.chrome.heading}` : "#000000" }],
          })}))`,
          `Add group ${name}`,
        )
      ).trim();
      groups.set(key, id);
      return id;
    };
    const map = {};
    const fallback = { level: list[0].level, group: "Referenced components" };
    const placed = [];
    for (const id of order) {
      const tree = sources.get(id);
      const { level, group } = wanted.get(id) ?? fallback;
      let parent = await groupOf(level, group);
      if (sizes.has(id))
        parent = (await run(`Print(Insert(${JSON.stringify(parent)},${JSON.stringify(cell(tree, sizes.get(id)))}))`, `Add a cell for ${tree.name}`)).trim();
      const printed = await run(
        INSERT(parent, rewrite(tree, map), skeleton(tree), { type, sourceId: id, sourceName: tree.name }),
        `Copy ${tree.name}`,
      );
      const { id: copy, pairs } = JSON.parse(printed);
      Object.assign(map, pairs);
      placed.push({ source: id, name: tree.name, copy, group, referencedOnly: !wanted.has(id) });
    }
    if (headless || args.includes("--save")) await shell.send("save()");
    console.log(JSON.stringify({ removed: Number(removed), copied: placed.length, variablesAdded: Object.keys(missing), placed }, null, 2));
  } finally {
    await shell.close();
  }
}
