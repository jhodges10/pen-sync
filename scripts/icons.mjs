/**
 * Lucide icon names Pencil knows. Lucide renames icons and keeps the old names
 * as aliases (an icon's classes list them all: `lucide-triangle-exclamation-point
 * lucide-alert-triangle lucide-triangle-alert`), while Pencil bundles one
 * Lucide release and draws an unknown name as its fallback glyph, silently.
 * So each name is tried in Pencil once: an icon of that name and one of a name
 * that can't exist are rendered, and a name whose render is the fallback's is
 * unknown. Answers are cached in `<polishDir>/../pen-sync-icons.json`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { config } from "./config.mjs";
import { call, parseResult } from "./pen-sync.mjs";

const CACHE = join(dirname(config.polishDir), "pen-sync-icons.json");
const NONE = "pen-sync-no-such-icon";

const readCache = () => {
  try {
    return JSON.parse(readFileSync(CACHE, "utf8"));
  } catch {
    return {};
  }
};

/** The first name of each alias list Pencil knows, or the list's first name. */
export function pickNames(lists, known) {
  return new Map(lists.map((names) => [names[0], names.find((n) => known[n]) ?? names[0]]));
}

/**
 * Which of `names` Pencil knows, asking the open `shell` about those the cache
 * doesn't answer: `{ name: boolean }`.
 */
export async function knownIcons(shell, names) {
  const cache = readCache();
  const ask = [...new Set(names)].filter((n) => !(n in cache));
  if (ask.length) {
    const dir = mkdtempSync(join(tmpdir(), "pen-sync-icons-"));
    const probe = [NONE, ...ask];
    const result = parseResult(
      await shell.send(
        call("execute", {
          description: "Check which icon names Pencil knows",
          input:
            `const N=${JSON.stringify(probe)};const f=Insert(document,{type:"frame",name:"pen-sync icon probe",layout:"none",x:-100000,y:-100000,width:40,height:40});` +
            `const ids=N.map((n)=>Insert(f,{type:"icon",icon:n,library:"lucide",width:24,height:24,x:0,y:0,fill:"#000000"}));` +
            `Export(ids,"png",${JSON.stringify(dir)},{scale:1});iconProbe=f;Print(JSON.stringify(ids));`,
        }),
      ),
    );
    await shell.send(call("execute", { description: "Remove the icon probe", input: "Delete(iconProbe)" }));
    if (!result.ok) throw new Error(`icon probe failed: ${result.text}`);
    const ids = JSON.parse(result.printed.split("\n").find((l) => l.startsWith("[")) ?? "[]");
    const png = (id) => {
      const file = join(dir, `${id}.png`);
      return existsSync(file) ? readFileSync(file).toString("base64") : null;
    };
    const fallback = png(ids[0]);
    ask.forEach((name, i) => {
      const own = png(ids[i + 1]);
      if (own && fallback) cache[name] = own !== fallback;
    });
    mkdirSync(dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, `${JSON.stringify(cache, null, 2)}\n`);
  }
  return Object.fromEntries(names.map((n) => [n, cache[n] ?? false]));
}

/** Every icon's alias list in a snapshot tree (`icons` on an svg node). */
export function iconLists(tree, out = []) {
  if (tree?.kind === "svg" && tree.icons?.length) out.push(tree.icons);
  for (const kid of tree?.children ?? []) iconLists(kid, out);
  return out;
}

/** `node` with every icon renamed by `names` (first alias → the name Pencil knows). */
export function renameIcons(node, names) {
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (n.type === "icon" && names.has(n.icon)) n.icon = names.get(n.icon);
    for (const v of Object.values(n)) if (v && typeof v === "object") walk(v);
  };
  walk(node);
  return node;
}
