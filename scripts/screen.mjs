/**
 * Screens: a rendered story turned into a Pencil frame whose design-system
 * components are instances of the library's.
 *
 * `libraryComponents` reads the library `.pen` file (pen-sync.config.json →
 * pen) into every component the sync wrote, each expanded to the full layer
 * tree it draws: a variant is an instance of its base with overrides, so its
 * tree is the base's with those overrides applied. `instanceMatcher` is
 * `convertInstance`'s `instanceOf` hook: for an element with `data-ds`, it
 * compares the element, drawn as the library would draw it, with every
 * variant of that component, and makes it an instance of the closest one,
 * overriding what differs. Layers line up by name (`nameLayers`), a layer the
 * element lacks is hidden, and a slot takes the element's content, converted
 * with its own components as instances.
 */
import { contextKey, nameLayers } from "./dom-to-pen.mjs";

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Every node in a `.pen` document by id. */
function nodesById(doc) {
  const byId = new Map();
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n.id === "string") byId.set(n.id, n);
    for (const v of Object.values(n)) if (v && typeof v === "object") walk(v);
  };
  walk(doc.children ?? []);
  return byId;
}

const OWN = new Set(["id", "type", "ref", "name", "descendants", "context", "reusable", "metadata", "children"]);

/** `ref`'s overrides applied to a copy of `tree`, the tree that ref draws. */
export function applyOverrides(tree, ref) {
  const out = clone(tree);
  for (const [key, value] of Object.entries(ref)) if (!OWN.has(key)) out[key] = value;
  const find = (n, id) => {
    if (n.id === id) return n;
    for (const kid of n.children ?? []) {
      const hit = find(kid, id);
      if (hit) return hit;
    }
    return null;
  };
  for (const [path, value] of Object.entries(ref.descendants ?? {})) {
    const id = path.split("/").pop();
    const target = find(out, id);
    if (!target) continue;
    if (value.type) {
      for (const k of Object.keys(target)) if (k !== "id") delete target[k];
      Object.assign(target, clone(value), { id });
    } else Object.assign(target, clone(value));
  }
  return out;
}

/**
 * The library's components by registry id: `{ [dsId]: [{ id, name, key,
 * base, tree }] }`. `prefix` is config `metadataPrefix`.
 */
export function libraryComponents(doc, prefix) {
  const byId = nodesById(doc);
  const expanded = new Map();
  const expand = (node, depth = 0) => {
    if (expanded.has(node.id)) return expanded.get(node.id);
    let tree = null;
    if (node.type !== "ref") tree = clone(node);
    else if (depth < 8 && byId.has(node.ref)) {
      const target = expand(byId.get(node.ref), depth + 1);
      if (target) tree = applyOverrides(target.tree, node);
    }
    const dsOf = (n, d = 0) =>
      n.metadata?.type === prefix
        ? n.metadata.id
        : n.type === "ref" && d < 8 && byId.has(n.ref)
          ? dsOf(byId.get(n.ref), d + 1)
          : null;
    const entry = tree && { tree, ds: dsOf(node) };
    expanded.set(node.id, entry);
    return entry;
  };
  const out = {};
  for (const node of byId.values()) {
    if (!node.reusable) continue;
    const entry = expand(node);
    if (!entry?.ds) continue;
    const key = contextKey(node.context) ?? "";
    (out[entry.ds] ??= []).push({
      id: node.id,
      name: node.name,
      key,
      base: Boolean(node.metadata?.base) || node.type !== "ref",
      tree: entry.tree,
    });
  }
  return out;
}

// Properties that place a layer rather than draw it, or name and link it.
const SKIP = new Set([
  "id", "type", "name", "children", "context", "reusable", "metadata", "slot",
  "x", "y", "layoutPosition", "descendants", "ref", "theme",
]);
// What a property falls back to when a layer leaves it unset.
const NEUTRAL = {
  fill: "#00000000",
  stroke: "#00000000",
  strokeWidth: 0,
  effect: [],
  opacity: 1,
  cornerRadius: 0,
  padding: 0,
  gap: 0,
  width: "fit_content",
  height: "fit_content",
  justifyContent: "start",
  alignItems: "start",
  clip: false,
  letterSpacing: 0,
  textGrowth: "auto",
  enabled: true,
  rotation: 0,
  layout: "horizontal",
};

/**
 * `drawn`'s properties that differ from `layer`'s, or null when one can't be
 * overridden. `same` names component-scoped variables with equal values by one
 * name (`$--ds-button-4` and `$--ds-dialog-1` are the same paint).
 */
function diffProps(layer, drawn, same = (v) => v) {
  const out = {};
  // One effect is stored bare or as a one-item list; both are the same.
  const json = (v) =>
    JSON.stringify(
      v && typeof v === "object" && !Array.isArray(v) && v.type === "shadow" ? [v] : v,
      (_k, x) => (typeof x === "string" ? same(x) : x),
    );
  for (const key of new Set([...Object.keys(layer), ...Object.keys(drawn)])) {
    if (SKIP.has(key)) continue;
    if (json(layer[key]) === json(drawn[key])) continue;
    // Unset is the default: `layout: "horizontal"` against no layout is no change.
    if (layer[key] === undefined && key in NEUTRAL && json(drawn[key]) === json(NEUTRAL[key])) continue;
    if (drawn[key] === undefined) {
      if (!(key in NEUTRAL)) return null;
      if (JSON.stringify(layer[key]) === JSON.stringify(NEUTRAL[key])) continue;
      out[key] = NEUTRAL[key];
    } else out[key] = drawn[key];
  }
  return out;
}

/**
 * `drawn` (an element converted with every layer drawn, named by
 * `nameLayers`) as an instance of the library component `candidate`:
 * `{ node, cost }`, the cost being how many properties it overrides, or null
 * when its layers don't fit (a layer the component doesn't have).
 */
export function matchInstance(candidate, drawn, { alias, slotChildren = (l) => l.children ?? [], same }) {
  const key = (id) => (alias ? `${alias}:${id}` : id);
  const tree = candidate.tree;
  // An element that is only text (a wrapper drawn as its text) against a component that
  // wraps one text layer: compare it as that wrapper.
  if (drawn.type === "text" && tree.type !== "text") {
    const [only, ...rest] = tree.children ?? [];
    if (!only || rest.length || only.type !== "text") return null;
    const { x, y, layoutPosition, ...text } = drawn;
    // The wrapper takes the text's place and its width; the text fills it.
    const fills = text.width === "fill_container";
    drawn = {
      type: tree.type,
      ...(x !== undefined ? { x, y } : {}),
      ...(layoutPosition ? { layoutPosition } : {}),
      ...(fills ? { width: "fill_container" } : {}),
      children: [{ ...text, name: only.name }],
    };
  }
  if (tree.type !== drawn.type) return null;
  const root = diffProps(tree, drawn, same);
  if (!root) return null;
  // A paint that isn't a token (a literal, a component-scoped variable) is a
  // restyle, the costly kind of override; a size or a text is cheap.
  const costOf = (diff) =>
    Object.entries(diff).reduce(
      (sum, [k, v]) =>
        sum +
        (["fill", "stroke", "effect"].includes(k) &&
        !(typeof v === "string" && v.startsWith("$--") && !v.startsWith("$--ds-"))
          ? 5
          : 1),
      0,
    );
  let cost = costOf(root);
  const descendants = {};
  const align = (layer, mine) => {
    const kids = mine.children ?? [];
    const byName = new Map(kids.map((k) => [k.name, k]));
    const used = new Set();
    for (const child of layer.children ?? []) {
      const other = byName.get(child.name);
      if (!other) {
        if (child.enabled !== false) {
          descendants[key(child.id)] = { enabled: false };
          cost += 1;
        }
        continue;
      }
      used.add(other);
      if (child.slot) {
        const size = diffProps({ ...child, children: undefined }, { ...other, children: undefined }, same) ?? {};
        descendants[key(child.id)] = { ...size, children: slotChildren(other) };
        continue;
      }
      if (child.type === "ref") {
        if (other.type !== "ref" || other.ref !== child.ref) cost += 4;
        continue;
      }
      if (child.type !== other.type) return false;
      const diff = diffProps(child, other, same);
      if (!diff) return false;
      if (Object.keys(diff).length) {
        descendants[key(child.id)] = diff;
        cost += costOf(diff);
      }
      if (!align(child, other)) return false;
    }
    return kids.every((k) => used.has(k));
  };
  if (!align(tree, drawn)) return null;
  const place = Object.fromEntries(
    ["x", "y", "layoutPosition"].filter((k) => k in drawn).map((k) => [k, drawn[k]]),
  );
  return {
    cost,
    node: {
      type: "ref",
      ref: key(candidate.id),
      name: candidate.name.split("/")[0],
      ...place,
      ...root,
      ...(Object.keys(descendants).length ? { descendants } : {}),
    },
  };
}

/**
 * `convertInstance`'s `instanceOf` hook for a screen: the closest library
 * component for each `data-ds` element, or null to draw it by hand. `report`
 * counts instances per component and the elements drawn by hand.
 */
export function instanceMatcher(library, { alias, report, same }) {
  report.instances ??= {};
  report.drawn ??= {};
  return (node, drawn, { slotChildren }) => {
    const candidates = library[node.ds];
    if (!candidates?.length) {
      report.drawn[node.ds] = (report.drawn[node.ds] ?? 0) + 1;
      return null;
    }
    nameLayers(drawn);
    // A variant whose key contradicts the element's data attributes
    // (`data-variant="outline"` against `variant=ghost`) ranks last; one that
    // agrees ranks first. Within that, fewest overrides wins.
    const props = node.props ?? {};
    const rank = (candidate) => {
      let against = 0;
      let agree = 0;
      for (const [axis, value] of new URLSearchParams(candidate.key)) {
        if (!(axis in props)) continue;
        if (props[axis] === (value || "true")) agree += 1;
        else against += 1;
      }
      return { against, agree };
    };
    let best = null;
    for (const candidate of candidates) {
      // Slots convert their content on the winner only, so a trial run doesn't
      // convert it once per candidate.
      const trial = matchInstance(candidate, drawn, { alias, same, slotChildren: () => [] });
      if (!trial) continue;
      const r = rank(candidate);
      const better =
        !best ||
        r.against < best.r.against ||
        (r.against === best.r.against &&
          (trial.cost < best.trial.cost ||
            (trial.cost === best.trial.cost &&
              (r.agree > best.r.agree || (r.agree === best.r.agree && candidate.base && !best.candidate.base)))));
      if (better) best = { candidate, trial, r };
    }
    if (!best) {
      report.drawn[node.ds] = (report.drawn[node.ds] ?? 0) + 1;
      return null;
    }
    report.instances[node.ds] = (report.instances[node.ds] ?? 0) + 1;
    return matchInstance(best.candidate, drawn, { alias, same, slotChildren }).node;
  };
}
