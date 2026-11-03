/**
 * Turn a component's rendered VariantMatrix story into Pencil components bound
 * to the design-system variables, without Pencil's browser import.
 *
 *   1. `snapshotMatrix(id)` runs in the Storybook page (Playwright) once per
 *      theme and records each `[data-ds=id]` instance as a plain tree: boxes,
 *      flex layout, paints as hex, text, and SVG shapes.
 *   2. `buildExport` converts the first theme's tree into Pencil nodes and binds
 *      every paint to the variable whose value matches it in all six themes.
 *      Many tokens share a value in every theme, so the element's Tailwind
 *      classes break ties (`bg-primary` names `--color-primary`). A paint no
 *      token matches in every theme (`dark:bg-input/30`) becomes a
 *      component-scoped themed variable, `--ds-<id>-<n>`.
 *   3. `pencilSnippet` is the one `execute` call that defines those variables
 *      and inserts the components, each `reusable` with `<prefix>` metadata
 *      (config `metadataPrefix`, `ds` by default).
 *
 * Binding happens here, in Node, against the same variables Pencil holds
 * (`toPencilVariables`), so it is unit-tested and needs no stash round trip.
 */
import { colorClassTokens, hexDistance } from "./binding.mjs";

/**
 * Runs in the Storybook page: every `[data-ds=id]` instance of the matrix
 * story as `{ key, row, tree }`, plus the rows drawn on a brand surface.
 * Self-contained, so Playwright can serialize it.
 */
export function snapshotMatrix({ id, selector = `[data-ds="${id}"]` }) {
  const probe = document.createElement("span");
  document.body.appendChild(probe);
  const hex = (css) => {
    if (!css || css === "none") return null;
    probe.style.color = "";
    probe.style.color = `color(from ${css} srgb r g b / alpha)`;
    const m = getComputedStyle(probe).color.match(
      /color\(srgb\s+(\S+)\s+(\S+)\s+(\S+)(?:\s*\/\s*(\S+))?\)/,
    );
    if (!m) return null;
    const alpha = m[4] === undefined ? 1 : Number(m[4]);
    if (alpha === 0) return null;
    const byte = (v) =>
      Math.round(Math.min(1, Math.max(0, Number(v))) * 255)
        .toString(16)
        .padStart(2, "0");
    return `#${byte(m[1])}${byte(m[2])}${byte(m[3])}${alpha < 1 ? byte(alpha) : ""}`;
  };
  const px = (v) => Number.parseFloat(v) || 0;
  const round = (n) => Math.round(n * 100) / 100;
  const box = (r, origin) => ({
    x: round(r.left - origin.left),
    y: round(r.top - origin.top),
    w: round(r.width),
    h: round(r.height),
  });
  const hidden = (el, style) =>
    style.display === "none" ||
    style.visibility === "hidden" ||
    (el.tagName === "INPUT" &&
      /^(checkbox|radio|hidden|range)$/.test(el.getAttribute("type") || "")) ||
    // Visually hidden (sr-only, Base UI's hidden inputs): clipped away.
    (/^(absolute|fixed)$/.test(style.position) &&
      (style.clip !== "auto" || /inset\(50%\)/.test(style.clipPath)));
  const shadows = (computed) => {
    if (!computed || computed === "none") return [];
    const layers = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i <= computed.length; i += 1) {
      const c = computed[i];
      if (c === "(") depth += 1;
      else if (c === ")") depth -= 1;
      else if ((c === "," && depth === 0) || i === computed.length) {
        layers.push(computed.slice(start, i).trim());
        start = i + 1;
      }
    }
    return layers.flatMap((layer) => {
      const color = layer.match(/[a-z-]+\([^()]*\)|#[0-9a-f]+/i)?.[0];
      const lengths = [
        ...layer.replace(color ?? "", "").matchAll(/-?\d*\.?\d+px/g),
      ].map((m) => px(m[0]));
      const value = hex(color);
      return value
        ? [
            {
              color: value,
              x: lengths[0] ?? 0,
              y: lengths[1] ?? 0,
              blur: lengths[2] ?? 0,
              spread: lengths[3] ?? 0,
              inset: /\binset\b/.test(layer),
            },
          ]
        : [];
    });
  };
  const splitTop = (text) => {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i <= text.length; i += 1) {
      const c = text[i];
      if (c === "(") depth += 1;
      else if (c === ")") depth -= 1;
      else if ((c === "," && depth === 0) || i === text.length) {
        parts.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
    return parts;
  };
  // The first linear-gradient layer of a background-image, angle in CSS degrees.
  const gradient = (image) => {
    const layer = splitTop(image).find((l) => l.startsWith("linear-gradient("));
    if (!layer) return null;
    const parts = splitTop(layer.slice("linear-gradient(".length, -1));
    const SIDES = { top: 0, right: 90, bottom: 180, left: 270 };
    let angle = 180;
    if (/^-?\d*\.?\d+(deg|turn|rad)$|^to /.test(parts[0])) {
      const first = parts.shift();
      if (first.startsWith("to ")) {
        const sides = first
          .slice(3)
          .split(/\s+/)
          .map((w) => SIDES[w]);
        angle =
          sides.length === 2
            ? sides.includes(0) && sides.includes(270)
              ? 315
              : (sides[0] + sides[1]) / 2
            : sides[0];
      } else if (first.endsWith("turn")) angle = px(first) * 360;
      else if (first.endsWith("rad")) angle = (px(first) * 180) / Math.PI;
      else angle = px(first);
    }
    const stops = parts.map((part, i) => {
      const position = part.match(/\s(-?\d*\.?\d+)%$/);
      const color = position ? part.slice(0, position.index).trim() : part;
      return {
        color: hex(color),
        position: position
          ? Number(position[1]) / 100
          : i / Math.max(1, parts.length - 1),
      };
    });
    return { angle, stops };
  };
  const shapeD = (shape) => {
    const a = (name) => Number(shape.getAttribute(name) || 0);
    switch (shape.tagName.toLowerCase()) {
      case "path":
        return shape.getAttribute("d");
      case "line":
        return `M${a("x1")} ${a("y1")}L${a("x2")} ${a("y2")}`;
      case "polyline":
      case "polygon": {
        const n =
          (shape.getAttribute("points") || "").match(/-?\d*\.?\d+/g) ?? [];
        const pairs = [];
        for (let i = 0; i + 1 < n.length; i += 2)
          pairs.push(`${n[i]} ${n[i + 1]}`);
        return `M${pairs.join("L")}${shape.tagName.toLowerCase() === "polygon" ? "Z" : ""}`;
      }
      case "circle": {
        const [cx, cy, r] = [a("cx"), a("cy"), a("r")];
        return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
      }
      case "rect":
        return `M${a("x")} ${a("y")}h${a("width")}v${a("height")}h${-a("width")}Z`;
      default:
        return null;
    }
  };
  const svgNode = (svg, origin) => {
    const r = svg.getBoundingClientRect();
    const style = getComputedStyle(svg);
    const base = {
      kind: "svg",
      cls: svg.getAttribute("class") || "",
      ...box(r, origin),
      opacity: Number(style.opacity),
    };
    const lucide = [...svg.classList]
      .find((c) => c.startsWith("lucide-"))
      ?.slice(7);
    if (lucide) {
      return {
        ...base,
        icon: lucide,
        color: hex(style.stroke) ?? hex(style.color),
      };
    }
    const vb = svg.viewBox.baseVal;
    const viewBox =
      vb && vb.width
        ? [vb.x, vb.y, vb.width, vb.height]
        : [0, 0, r.width, r.height];
    const scale = r.width / viewBox[2];
    const shapes = [
      ...svg.querySelectorAll("path,line,polyline,polygon,circle,rect"),
    ].flatMap((shape) => {
      const s = getComputedStyle(shape);
      const d = shapeD(shape);
      if (!d || s.display === "none") return [];
      return [
        {
          d,
          stroke: hex(s.stroke),
          strokeWidth: round(px(s.strokeWidth) * scale),
          fill: hex(s.fill),
          cap: s.strokeLinecap,
          join: s.strokeLinejoin,
        },
      ];
    });
    return { ...base, viewBox, shapes };
  };
  const elementNode = (el, origin) => {
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const children = [];
    // `display: contents` boxes draw nothing; their children belong to `el`.
    const collect = (host, style) => {
      for (const child of host.childNodes) {
        if (child.nodeType === 3) {
          const content = child.textContent.replace(/\s+/g, " ").trim();
          if (!content) continue;
          const range = document.createRange();
          range.selectNodeContents(child);
          children.push({
            kind: "text",
            content,
            ...box(range.getBoundingClientRect(), origin),
            color: hex(style.color),
            font: style.fontFamily,
            size: px(style.fontSize),
            weight: style.fontWeight,
            lineHeight:
              style.lineHeight === "normal" ? null : px(style.lineHeight),
            letterSpacing:
              style.letterSpacing === "normal" ? 0 : px(style.letterSpacing),
            transform: style.textTransform,
          });
        } else if (child.nodeType === 1) {
          const childStyle = getComputedStyle(child);
          if (hidden(child, childStyle)) continue;
          if (childStyle.display === "contents") {
            collect(child, childStyle);
            continue;
          }
          children.push(
            child instanceof SVGSVGElement
              ? svgNode(child, origin)
              : elementNode(child, origin),
          );
        }
      }
    };
    collect(el, style);
    // A field's value (or, empty, its placeholder) is text the DOM keeps out of
    // its child nodes; it sits in the content box, vertically centred.
    // (A 1px input is a form's hidden mirror of a custom control; skip it.)
    if (
      (el.tagName === "INPUT" || el.tagName === "TEXTAREA") &&
      (el.value || el.placeholder) &&
      r.width > 2 &&
      r.height > 2
    ) {
      const pad = (s) =>
        px(style[`padding${s}`]) + px(style[`border${s}Width`]);
      const lineHeight =
        style.lineHeight === "normal"
          ? px(style.fontSize) * 1.2
          : px(style.lineHeight);
      const inner = r.height - pad("Top") - pad("Bottom");
      const top =
        el.tagName === "INPUT"
          ? r.top + pad("Top") + Math.max(0, (inner - lineHeight) / 2)
          : r.top + pad("Top");
      children.push({
        kind: "text",
        content: el.value || el.placeholder,
        x: round(r.left + pad("Left") - origin.left),
        y: round(top - origin.top),
        w: round(r.width - pad("Left") - pad("Right")),
        h: round(Math.min(inner, lineHeight)),
        color: hex(
          el.value ? style.color : getComputedStyle(el, "::placeholder").color,
        ),
        font: style.fontFamily,
        size: px(style.fontSize),
        weight: style.fontWeight,
        lineHeight: style.lineHeight === "normal" ? null : px(style.lineHeight),
        letterSpacing:
          style.letterSpacing === "normal" ? 0 : px(style.letterSpacing),
        transform: style.textTransform,
      });
    }
    const sides = ["Top", "Right", "Bottom", "Left"];
    const moved = (style) => {
      const shift = (style.translate || "none")
        .split(/\s+/)
        .some((v) => v !== "none" && Math.abs(parseFloat(v)) > 0.5);
      const m = style.transform.match(/^matrix\(([^)]+)\)/)?.[1].split(",").map(Number);
      return shift || Boolean(m && (Math.abs(m[4]) > 0.5 || Math.abs(m[5]) > 0.5));
    };
    const autoMargins = (el) => {
      const map = el.computedStyleMap?.();
      const auto = map
        ? sides.filter(
            (s) => String(map.get(`margin-${s.toLowerCase()}`)) === "auto",
          )
        : [];
      return auto.length ? { autoMargin: auto } : {};
    };
    // Pencil frames don't wrap: a wrapping flex row the browser broke into
    // several lines becomes a column of those lines, each a row of its own.
    const wraps =
      /flex/.test(style.display) &&
      style.flexWrap !== "nowrap" &&
      !style.flexDirection.startsWith("column");
    const flowing = children.filter((c) => c.position !== "absolute");
    const lines = [];
    if (wraps)
      for (const child of flowing) {
        const line = lines.find(
          (l) => child.y < l.bottom - 1 && child.y + child.h > l.top + 1,
        );
        if (line) {
          line.kids.push(child);
          line.top = Math.min(line.top, child.y);
          line.bottom = Math.max(line.bottom, child.y + child.h);
        } else
          lines.push({
            kids: [child],
            top: child.y,
            bottom: child.y + child.h,
          });
      }
    if (lines.length > 1) {
      const columnGap = px(style.columnGap);
      const rows = lines.map((l) => {
        const left = Math.min(...l.kids.map((k) => k.x));
        const right = Math.max(...l.kids.map((k) => k.x + k.w));
        return {
          kind: "element",
          tag: "div",
          slot: null,
          cls: "",
          x: left,
          y: l.top,
          w: round(right - left),
          h: round(l.bottom - l.top),
          display: "flex",
          position: "static",
          direction: "row",
          gap: [columnGap, columnGap],
          padding: [0, 0, 0, 0],
          justify: style.justifyContent,
          align: style.alignItems,
          textAlign: "start",
          bg: null,
          gradient: null,
          border: { widths: [0, 0, 0, 0], colors: [null, null, null, null] },
          radius: [0, 0, 0, 0],
          opacity: 1,
          clip: false,
          shadows: [],
          children: l.kids,
        };
      });
      children.splice(
        0,
        children.length,
        ...rows,
        ...children.filter((c) => c.position === "absolute"),
      );
    }
    const wrapped = lines.length > 1;
    // A rotated box (a tooltip's arrow is a square turned 45°): its angle,
    // clockwise as CSS has it, and its size before turning.
    const turn = style.transform.match(/^matrix\(([^,]+),\s*([^,]+)/);
    const angle = turn
      ? round((Math.atan2(Number(turn[2]), Number(turn[1])) * 180) / Math.PI)
      : 0;
    return {
      kind: "element",
      tag: el.tagName.toLowerCase(),
      slot: el.getAttribute("data-slot"),
      cls: el.getAttribute("class") || "",
      ...box(r, origin),
      display: style.display,
      position: style.position,
      direction: wrapped ? "column" : style.flexDirection,
      gap: wrapped
        ? [px(style.rowGap), px(style.rowGap)]
        : [px(style.rowGap), px(style.columnGap)],
      padding: sides.map((s) => px(style[`padding${s}`])),
      justify: wrapped ? "flex-start" : style.justifyContent,
      align: wrapped ? "flex-start" : style.alignItems,
      textAlign: style.textAlign,
      bg: hex(style.backgroundColor),
      gradient: gradient(style.backgroundImage),
      border: {
        widths: sides.map((s) => px(style[`border${s}Width`])),
        colors: sides.map((s) => hex(style[`border${s}Color`])),
      },
      radius: ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map((c) =>
        px(style[`border${c}Radius`]),
      ),
      ...(angle
        ? { rotation: angle, natural: [el.offsetWidth, el.offsetHeight] }
        : {}),
      ...(Number(style.order) ? { order: Number(style.order) } : {}),
      // A switch's thumb is moved by `translate-x-*` (the `translate`
      // property in Tailwind 4, or a transform): its box is where the
      // browser drew it, not where the flex row puts it.
      ...(moved(style) ? { translated: true } : {}),
      // `ml-auto`/`mt-auto`: computed margins are used lengths, so read the
      // computed-value map, where an auto margin is still "auto".
      ...autoMargins(el),
      opacity: Number(style.opacity),
      // A scroll box clips too: the story renders it at rest, scrolled to the top.
      clip: [style.overflowX, style.overflowY].some((o) => o !== "visible"),
      shadows: shadows(style.boxShadow),
      children,
    };
  };
  // A component that is an icon (Spinner is Lucide's loader) is a frame
  // holding that icon, so it is a reusable frame like every other component.
  const rootNode = (el) => {
    const origin = el.getBoundingClientRect();
    const node = elementNode(el, origin);
    return el instanceof SVGSVGElement
      ? { ...node, padding: [0, 0, 0, 0], children: [svgNode(el, origin)] }
      : node;
  };
  // Each instance is the data-ds element inside a matrix's variant wrapper.
  const instances = [...document.querySelectorAll("[data-ds-variant]")].flatMap(
    (wrapper) => {
      // A wrapper can widen the capture to more than the component
      // (`data-ds-capture`): a picker's field together with its open list.
      const el =
        wrapper.querySelector("[data-ds-capture]") ??
        (wrapper.matches(selector) ? wrapper : wrapper.querySelector(selector));
      if (!el) return [];
      return [
        {
          key: wrapper.getAttribute("data-ds-variant") ?? "",
          row: Number(
            wrapper.closest("[data-ds-row]")?.getAttribute("data-ds-row") ?? 0,
          ),
          tree: rootNode(el),
        },
      ];
    },
  );

  const surfaces = Object.fromEntries(
    [...document.querySelectorAll("[data-ds-row][data-ds-surface]")].map(
      (el) => [el.dataset.dsRow, el.dataset.dsSurface],
    ),
  );
  probe.remove();
  // The resolved matrix the story rendered (rows, slots), when it embeds one.
  const embedded = document.querySelector("[data-ds-matrix]");
  const matrix = embedded
    ? JSON.parse(embedded.getAttribute("data-ds-matrix"))
    : undefined;
  return { instances, surfaces, matrix };
}

const TRANSPARENT = "#00000000";

/** A shadow that is only a spread: Tailwind's `ring-*`, drawn as a stroke. */
export const isRing = (s) =>
  s.spread > 0 && s.blur === 0 && s.x === 0 && s.y === 0;

// For aliases with no class hint: semantic surfaces first, special-purpose
// families last (config `aliasOrder`, regex sources, first match wins).
const DEFAULT_ALIAS_ORDER = [
  "^--color-(background|foreground|card|popover|primary|secondary|muted|accent|border|input|ring|destructive)(-|$)",
];
const aliasRanker = (order) => {
  const res = order.map((source) => new RegExp(source));
  return (name) => {
    const i = res.findIndex((re) => re.test(name));
    return i === -1 ? res.length : i;
  };
};

/**
 * The Pencil variables (`toPencilVariables(doc).variables`) as lookup tables
 * for the given theme keys: each color's value per theme, the radius and
 * spacing numbers, and the font families.
 */
export function variableIndex(
  variables,
  themes,
  aliasOrder = DEFAULT_ALIAS_ORDER,
) {
  const same = (a, b) =>
    Object.keys({ ...a, ...b }).every((axis) => a[axis] === b[axis]);
  const perTheme = (value) =>
    Object.fromEntries(
      themes.map(({ key, pencil }) => {
        if (!Array.isArray(value)) return [key, value];
        const hit = value.find((v) => same(v.theme, pencil));
        return [key, (hit ?? value[0]).value];
      }),
    );
  const colors = [];
  const radii = [];
  const spacing = [];
  const fonts = {};
  for (const [name, def] of Object.entries(variables)) {
    if (def.type === "color")
      colors.push({ name, values: perTheme(def.value) });
    else if (def.type === "number" && name.startsWith("--radius-"))
      radii.push([name, perTheme(def.value)[themes[0].key]]);
    else if (def.type === "number" && name.startsWith("--spacing-"))
      spacing.push([name, def.value]);
    else if (def.type === "string" && name.startsWith("--font-"))
      fonts[def.value] = name;
  }
  return {
    colors,
    radii,
    spacing,
    fonts,
    themes: themes.map((t) => t.key),
    aliasRank: aliasRanker(aliasOrder),
  };
}

/**
 * Bind one paint, observed per theme, to a color variable: the first class
 * hint whose variable matches in every theme (`class`), else the only match
 * (`value`), else the best-ranked of several (`alias`). `null` when nothing
 * matches in every theme.
 */
export function bindColor(values, hints, index) {
  const close = (a, b) => hexDistance(a, b) <= 1;
  const matches = index.colors.filter(({ values: v }) =>
    index.themes.every((t) => close(v[t], values[t] ?? TRANSPARENT)),
  );
  if (matches.length === 0) return null;
  for (const token of hints) {
    const hit = matches.find(
      ({ name }) => name === `--color-${token}` || name === `--${token}`,
    );
    if (hit) return { variable: hit.name, how: "class" };
  }
  if (matches.length === 1) return { variable: matches[0].name, how: "value" };
  const rank = index.aliasRank ?? aliasRanker(DEFAULT_ALIAS_ORDER);
  const best = [...matches].sort(
    (a, b) =>
      rank(a.name) - rank(b.name) ||
      a.name.localeCompare(b.name),
  )[0];
  return { variable: best.name, how: "alias" };
}

/**
 * `checked=indeterminate&size=lg` → `Indeterminate / Lg`; no key → `Default`.
 * `qualified` names each non-variant axis (`Tone Muted`), for keys whose short
 * names collide.
 */
// `showCloseButton=false` reads "no close button".
const turnedOff = (axis) =>
  axis
    .replace(/^show(?=[A-Z])/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();

export function variantName(key, { qualified = false } = {}) {
  if (!key) return "Default";
  const title = (s) =>
    s
      .split(/[-\s]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  return [...new URLSearchParams(key)]
    .map(([axis, value]) =>
      // `size=default` beside `variant=default` would both read "Default".
      value === ""
        ? title(axis)
        : value === "false"
          ? `No ${title(turnedOff(axis))}`
          : (qualified || value === "default") && axis !== "variant"
            ? `${title(axis)} ${title(value)}`
            : title(value),
    )
    .join(" / ");
}

const JUSTIFY = {
  center: "center",
  "flex-end": "end",
  end: "end",
  "space-between": "space_between",
  "space-around": "space_around",
};
const ALIGN = { center: "center", "flex-end": "end", end: "end" };
const isFlex = (node) => /flex/.test(node.display);
const uniform = (list) => list.every((v) => v === list[0]);
const round = (n) => Math.round(n * 100) / 100;

/**
 * Convert one instance, observed under every theme (`trees[theme]`, same
 * shape), into a Pencil node. Geometry comes from the first theme; each paint
 * is bound across all of them. `scoped` collects the component-scoped
 * variables for paints no token matches; `report` counts how each bound.
 */
export function convertInstance(trees, ctx) {
  const { index, id, scoped, report, slots = {} } = ctx;
  // A flex item's `order` (`order-last`) moves it in the row; Pencil has only
  // the child order, so put the children where the browser draws them.
  const ordered = (node) =>
    node.kind === "element"
      ? {
          ...node,
          children: node.children
            .map(ordered)
            .map((child, i) => [child, i])
            .sort(([a, i], [b, j]) => (a.order ?? 0) - (b.order ?? 0) || i - j)
            .map(([child]) => child),
        }
      : node;
  trees = Object.fromEntries(
    Object.entries(trees).map(([theme, tree]) => [theme, ordered(tree)]),
  );
  const [first] = index.themes;
  const paint = (pick, hints) => {
    const values = Object.fromEntries(
      index.themes.map((t) => [t, pick(trees[t]) ?? TRANSPARENT]),
    );
    if (Object.values(values).every((v) => v === TRANSPARENT)) return undefined;
    const bound = bindColor(values, hints, index);
    if (bound) {
      report[bound.how] += 1;
      return `$${bound.variable}`;
    }
    if (uniform(Object.values(values))) {
      report.literal += 1;
      return values[first];
    }
    const signature = JSON.stringify(values);
    let name = scoped.byValues.get(signature);
    if (!name) {
      name = `--ds-${id}-${scoped.byValues.size + 1}`;
      scoped.byValues.set(signature, name);
      scoped.variables[name] = values;
    }
    report.scoped += 1;
    return `$${name}`;
  };
  const number = (value, family) =>
    family.find(([, v]) => v === value)?.[0]
      ? `$${family.find(([, v]) => v === value)[0]}`
      : value;
  const font = (family) => {
    const primary = family
      .split(",")[0]
      .trim()
      .replace(/^["']|["']$/g, "");
    return index.fonts[primary] ? `$${index.fonts[primary]}` : primary;
  };
  const textHints = (ancestors) => {
    for (let i = ancestors.length - 1; i >= 0; i -= 1) {
      const own = colorClassTokens(ancestors[i])
        .filter((t) => t.kind === "text")
        .map((t) => t.token);
      if (own.length > 0) return own;
    }
    return [];
  };
  const hintsOf = (cls, kind) =>
    colorClassTokens(cls)
      .filter((t) => t.kind === kind)
      .map((t) => t.token);
  const at = (tree, path) => path.reduce((n, i) => n?.children?.[i], tree);
  // `checkbox-indicator` → "Indicator": the layer name a designer overrides.
  const role = (slot) =>
    slot && slot !== id
      ? slot
          .replace(new RegExp(`^${id}-`), "")
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ")
      : null;

  // A block box whose in-flow children stack top to bottom, evenly spaced, is
  // a vertical layout, so Pencil sizes them instead of pinning each at a
  // measured spot. Anything else (inline runs, overlaps) keeps `layout: none`.
  const flows = new WeakMap();
  const flowOf = (node) => {
    if (flows.has(node)) return flows.get(node);
    let flow = null;
    if (isFlex(node)) {
      flow = {
        layout: node.direction.startsWith("column") ? "vertical" : "horizontal",
      };
    } else {
      const kids = node.children.filter(
        (c) => c.position !== "absolute" && c.position !== "fixed",
      );
      const gaps = kids
        .slice(1)
        .map((c, i) => round(c.y - (kids[i].y + kids[i].h)));
      if (
        kids.length > 0 &&
        gaps.every((g) => g >= -0.5 && Math.abs(g - gaps[0]) <= 1)
      ) {
        const [bt, , bb, bl] = node.border.widths;
        const last = kids.at(-1);
        const inset = (v) => Math.max(0, round(v));
        flow = {
          layout: "vertical",
          gap: inset(gaps[0] ?? 0),
          padding: [
            inset(kids[0].y - node.y - bt),
            node.padding[1],
            inset(node.y + node.h - bb - last.y - last.h),
            // Centred text sits wherever centring puts it; the box's own
            // padding is the inset then.
            node.textAlign === "center"
              ? node.padding[3]
              : inset(Math.min(...kids.map((c) => c.x)) - node.x - bl),
          ],
        };
      }
    }
    flows.set(node, flow);
    return flow;
  };

  // A flex box whose classes set no width hugs its content, so a designer can
  // change a label and the box follows, as it does in code. The instance itself
  // hugs only when inline (a button, a badge); a block root takes its
  // container's width, which is the width it was captured at.
  const hugsWidth = (node, parent) =>
    isFlex(node) &&
    (Boolean(parent) || node.display === "inline-flex") &&
    node.children.length > 0 &&
    !String(node.cls)
      .split(/\s+/)
      .filter((c) => c && !c.includes("["))
      .some((c) =>
        // w-fit and friends still hug; max-w only caps the hug.
        /^(w-(?!fit$|auto$|max$|min$)|size-|min-w-(?!0$)|basis-|flex-1$|grow$)/.test(
          c.split(":").pop(),
        ),
      );
  const parents = new Map();
  // convert() sizes a copy of each node; its parent's children are the originals.
  const originals = new WeakMap();
  // A child as wide as its column's content box was stretched there (block
  // flow, align-items: stretch): it fills the column in Pencil too, so its
  // border or divider spans what it does in the browser.
  const stretches = (node, parent) =>
    Boolean(parent) &&
    flowOf(parent)?.layout === "vertical" &&
    // A centred or start-aligned column doesn't stretch; its widest child
    // only looks stretched. Nor can a child fill a column that hugs it.
    (!isFlex(parent) || ["normal", "stretch"].includes(parent.align)) &&
    !hugsIn(parent, parents.get(parent)) &&
    node.position !== "absolute" &&
    node.position !== "fixed" &&
    Math.abs(
      node.w -
        (parent.w -
          parent.padding[1] -
          parent.padding[3] -
          parent.border.widths[1] -
          parent.border.widths[3]),
    ) <= 1;
  // An auto margin on a flex item's main-axis start (`ml-auto` on a toast's
  // action) takes the free space before it. Pencil has no margins, so the
  // sibling before it takes that space instead, when it has no paint of its
  // own to give the trick away.
  const pushedOn = (node, parent) => {
    const kids = parent.children.filter(
      (c) => c.position !== "absolute" && c.position !== "fixed",
    );
    const next = kids[kids.indexOf(originals.get(node) ?? node) + 1];
    const side = parent.direction.startsWith("column") ? "Top" : "Left";
    return (
      Boolean(next?.autoMargin?.includes(side)) &&
      node.kind === "element" &&
      !node.bg &&
      !node.border.widths.some(Boolean)
    );
  };
  // When the sibling before an auto-margined item can't grow without showing
  // it (a bordered button), an empty frame takes the free space instead.
  const spacerBefore = (node, parent) => {
    if (!isFlex(parent) || hugsIn(parent, parents.get(parent))) return false;
    const side = parent.direction.startsWith("column") ? "Top" : "Left";
    if (!node.autoMargin?.includes(side)) return false;
    const kids = parent.children.filter(
      (c) => c.position !== "absolute" && c.position !== "fixed",
    );
    const before = kids[kids.indexOf(node) - 1];
    return !before || !pushedOn(before, parent);
  };
  const spacer = (parent) =>
    parent.direction.startsWith("column")
      ? { type: "frame", name: "Spacer", width: 1, height: "fill_container" }
      : { type: "frame", name: "Spacer", width: "fill_container", height: 1 };
  // `flex-1`/`grow` takes the free space along a flex parent's main axis, as
  // `fill_container` does along a Pencil frame's: the axis it fills, or null.
  const grows = (node, parent) =>
    parent &&
    isFlex(parent) &&
    // A growing child in a box that hugs it has nothing to grow into.
    !(
      !parent.direction.startsWith("column") &&
      hugsIn(parent, parents.get(parent))
    ) &&
    (String(node.cls)
      .split(/\s+/)
      .some((c) => /^(flex-1|flex-auto|grow)$/.test(c)) ||
      pushedOn(node, parent))
      ? parent.direction.startsWith("column")
        ? "height"
        : "width"
      : null;

  // A box hugs in Pencil only when nothing sizes it from outside: one its
  // column stretches, or that grows, has a width its children can fill.
  const hugsIn = (node, parent) =>
    hugsWidth(node, parent) &&
    !stretches(node, parent) &&
    grows(node, parent) !== "width";

  // Pencil turns a box counter-clockwise about its top-left corner; CSS turns
  // it clockwise about its centre. Same size and angle, then shift the corner
  // so the turned box covers the measured one.
  const turned = (node) => {
    if (!node.rotation || !node.natural) return {};
    const [w, h] = node.natural;
    const t = (-node.rotation * Math.PI) / 180;
    const corners = [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ].map(([px, py]) => [
      px * Math.cos(t) + py * Math.sin(t),
      -px * Math.sin(t) + py * Math.cos(t),
    ]);
    return {
      width: w,
      height: h,
      rotation: round((360 - node.rotation) % 360),
      at: [
        node.x - Math.min(...corners.map((c) => c[0])),
        node.y - Math.min(...corners.map((c) => c[1])),
      ],
    };
  };

  const place = (node, parent, { at, ...out }) =>
    parent &&
    (!flowOf(parent) || node.position === "absolute" || node.translated)
      ? {
          ...out,
          ...(flowOf(parent) ? { layoutPosition: "absolute" } : {}),
          x: round((at?.[0] ?? node.x) - parent.x),
          y: round((at?.[1] ?? node.y) - parent.y),
        }
      : out;

  const convert = (node, path, parent, ancestors) => {
    const pick = (fn) => (tree) => {
      const n = at(tree, path);
      return n ? fn(n) : null;
    };
    if (node.kind === "text") {
      const lineHeight =
        node.lineHeight && node.size
          ? round(node.lineHeight / node.size)
          : null;
      // Taller than a line and a half: the code wraps it at its width.
      const wraps = node.h > (node.lineHeight || node.size * 1.4) * 1.5;
      return place(node, parent, {
        type: "text",
        name: "Label",
        ...(wraps ? { textGrowth: "fixed-width", width: node.w } : {}),
        content:
          node.transform === "uppercase"
            ? node.content.toUpperCase()
            : node.content,
        fill: paint(
          pick((n) => n.color),
          textHints(ancestors),
        ),
        fontFamily: font(node.font),
        fontSize: node.size,
        fontWeight: String(node.weight),
        ...(lineHeight ? { lineHeight } : {}),
        ...(node.letterSpacing ? { letterSpacing: node.letterSpacing } : {}),
      });
    }
    if (node.kind === "svg") {
      const svgHints = [...textHints(ancestors), ...hintsOf(node.cls, "text")];
      if (node.icon) {
        return place(node, parent, {
          type: "icon",
          name: "Icon",
          icon: node.icon,
          library: "lucide",
          width: node.w,
          height: node.h,
          fill: paint(
            pick((n) => n.color),
            svgHints,
          ),
          ...(node.opacity < 1 ? { opacity: node.opacity } : {}),
        });
      }
      return place(node, parent, {
        type: "frame",
        name: "svg",
        layout: "none",
        width: node.w,
        height: node.h,
        ...(node.opacity < 1 ? { opacity: node.opacity } : {}),
        children: node.shapes.map((shape, i) => {
          const stroke = paint(
            pick((n) => n.shapes?.[i]?.stroke),
            svgHints,
          );
          const fill = paint(
            pick((n) => n.shapes?.[i]?.fill),
            hintsOf(node.cls, "fill"),
          );
          return {
            type: "path",
            name: "Path",
            x: 0,
            y: 0,
            width: node.w,
            height: node.h,
            viewBox: node.viewBox,
            geometry: shape.d,
            ...(fill ? { fill } : {}),
            ...(stroke
              ? {
                  stroke,
                  strokeWidth: shape.strokeWidth,
                  ...(shape.cap !== "butt" ? { strokeLinecap: shape.cap } : {}),
                  ...(shape.join !== "miter"
                    ? { strokeLinejoin: shape.join }
                    : {}),
                }
              : {}),
          };
        }),
      });
    }

    if (node.slot && slots[node.slot]) {
      const column = node.direction.startsWith("column");
      return place(node, parent, {
        type: "frame",
        name: role(node.slot) ?? "Content",
        context: node.slot,
        layout: isFlex(node) && !column ? "horizontal" : "vertical",
        width:
          stretches(node, parent) || grows(node, parent) === "width"
            ? "fill_container"
            : node.w,
        height:
          grows(node, parent) === "height"
            ? "fill_container"
            : `fit_content(${node.h})`,
        slot: slots[node.slot].map((registryId) => `@${registryId}`),
        children: [],
      });
    }
    const { widths, colors } = node.border;
    const borderSide = widths.findIndex((w) => w > 0);
    if (borderSide !== -1 && !uniform(colors.filter((_, i) => widths[i] > 0)))
      report.warnings.push(`${id}: per-side border colors; drew the first`);
    const stroke =
      borderSide === -1
        ? undefined
        : paint(
            pick((n) => n.border.colors[borderSide]),
            hintsOf(node.cls, "border"),
          );
    const solid = paint(
      pick((n) => n.bg),
      hintsOf(node.cls, "bg"),
    );
    // CSS degrees run clockwise from "to top"; Pencil's rotation runs counter-clockwise from up.
    const gradient = node.gradient && {
      type: "gradient",
      gradientType: "linear",
      rotation: (360 - node.gradient.angle) % 360,
      colors: node.gradient.stops.map((stop, i) => ({
        color:
          paint(
            pick((n) => n.gradient?.stops[i]?.color),
            [],
          ) ?? TRANSPARENT,
        position: round(stop.position),
      })),
    };
    const fill = gradient ? (solid ? [solid, gradient] : gradient) : solid;
    // rounded-full computes to an enormous radius; anything past half the box is a pill.
    const captured = node;
    node = { ...node, radius: node.radius.map((r) => Math.min(r, 9999)) };
    originals.set(node, captured);
    const radius = uniform(node.radius)
      ? node.radius[0]
        ? number(node.radius[0], index.radii)
        : undefined
      : node.radius;
    parents.set(node, parent);
    const children = node.children.flatMap((child, i) => {
      const converted = convert(child, [...path, i], node, [
        ...ancestors,
        node.cls,
      ]);
      return spacerBefore(child, node)
        ? [spacer(node), converted]
        : [converted];
    });
    // A ring (`ring-1`, focus rings) is a shadow with spread and nothing else:
    // a border that takes no space. Pencil draws it as a stroke, inside for an
    // inset ring and outside otherwise, when the box has no border of its own.
    const ringAt = stroke ? -1 : node.shadows.findIndex(isRing);
    const ring = ringAt === -1 ? null : node.shadows[ringAt];
    const ringStroke =
      ring &&
      paint(
        pick((n) => n.shadows[ringAt]?.color),
        hintsOf(node.cls, "ring"),
      );
    const effects = node.shadows
      .filter((_, i) => i !== ringAt)
      .map((s) => ({
        type: "shadow",
        shadowType: s.inset ? "inner" : "outer",
        offset: { x: s.x, y: s.y },
        blur: s.blur,
        color: s.color,
      }));
    if (node.shadows.some((s, i) => i !== ringAt && s.spread !== 0))
      report.warnings.push(`${id}: a shadow spread has no Pencil form`);
    // A flex box whose classes set no width hugs its content, so a designer can
    // change a label and the box follows, as it does in code.
    // The instance itself hugs only when inline (a button, a badge); a block
    // root takes its container's width, which is the width it was captured at.
    const hugs = hugsWidth(node, parent);
    const common = {
      name: role(node.slot) ?? (parent ? "Container" : node.tag),
      ...(node.slot ? { context: node.slot } : {}),
      ...(stretches(node, parent) || grows(node, parent) === "width"
        ? { width: "fill_container" }
        : hugs
          ? {}
          : { width: node.w }),
      height: grows(node, parent) === "height" ? "fill_container" : node.h,
      ...(fill ? { fill } : {}),
      ...(radius !== undefined ? { cornerRadius: radius } : {}),
      ...(stroke
        ? {
            stroke,
            strokeWidth: uniform(widths)
              ? widths[0]
              : {
                  top: widths[0],
                  right: widths[1],
                  bottom: widths[2],
                  left: widths[3],
                },
            strokeAlignment: "inner",
          }
        : ringStroke
          ? {
              stroke: ringStroke,
              strokeWidth: ring.spread,
              strokeAlignment: ring.inset ? "inner" : "outer",
            }
          : {}),
      ...(node.opacity < 1 ? { opacity: node.opacity } : {}),
      ...(effects.length ? { effect: effects } : {}),
    };
    if (children.length === 0) {
      return place(node, parent, {
        type: "rectangle",
        ...common,
        ...turned(node),
      });
    }
    // A wrapper that paints nothing around one text is just that text, unless
    // it is a fixed box that centres the text (a calendar day, an icon-sized
    // badge): the text alone would lose the box's size and the centring.
    const [only] = children;
    const [rawOnly] = node.children;
    const centred = isFlex(node)
      ? node.justify === "center" || node.align === "center"
      : node.textAlign === "center";
    const centres =
      centred && rawOnly && (node.w - rawOnly.w > 1 || node.h - rawOnly.h > 1);
    if (
      parent &&
      children.length === 1 &&
      only.type === "text" &&
      !fill &&
      !stroke &&
      !ringStroke &&
      !effects.length &&
      !centres &&
      // A field keeps its box: its width is what the value sits in.
      node.tag !== "input" &&
      node.tag !== "textarea" &&
      node.padding.every((p) => p === 0)
    ) {
      const { x: _x, y: _y, layoutPosition: _lp, ...text } = only;
      return place(node, parent, {
        ...text,
        name: role(node.slot) ?? "Label",
        ...(node.slot ? { context: node.slot } : {}),
        // A wrapper that grew (`flex-1`, or before an `ms-auto` item) passes
        // its width on, or the text would hug and the row would close up.
        ...(common.width === "fill_container"
          ? { width: "fill_container", textGrowth: "fixed-width" }
          : {}),
      });
    }
    const flow = flowOf(node);
    const [top, right, bottom, left] = flow?.padding ?? node.padding;
    const gap =
      flow?.gap ??
      (node.direction.startsWith("column") ? node.gap[0] : node.gap[1]);
    return place(node, parent, {
      type: "frame",
      ...common,
      ...(flow
        ? {
            layout: flow.layout,
            ...(gap ? { gap: number(gap, index.spacing) } : {}),
            ...(top || right || bottom || left
              ? {
                  padding:
                    top === bottom && left === right
                      ? top === left
                        ? number(top, index.spacing)
                        : [
                            number(top, index.spacing),
                            number(left, index.spacing),
                          ]
                      : [top, right, bottom, left],
                }
              : {}),
            ...(JUSTIFY[node.justify]
              ? { justifyContent: JUSTIFY[node.justify] }
              : {}),
            ...(ALIGN[node.align]
              ? { alignItems: ALIGN[node.align] }
              : !isFlex(node) && node.textAlign === "center"
                ? { alignItems: "center" }
                : {}),
          }
        : { layout: "none" }),
      ...(node.clip ? { clip: true } : {}),
      children,
    });
  };
  return nameLayers(convert(trees[first], [], null, []));
}

/**
 * Give every layer below the root a unique name, so an instance can override
 * it by name (`descendants: { Label: { content } }`): an icon beside text is
 * the Leading or Trailing Icon, and repeats get a number.
 */
export function nameLayers(root) {
  const walk = (node) => {
    const kids = node.children ?? [];
    const textAt = kids.findIndex((k) => k.type === "text");
    kids.forEach((kid, i) => {
      if (kid.type === "icon" && textAt !== -1)
        kid.name = i < textAt ? "Leading Icon" : "Trailing Icon";
      else if (kid.type === "icon" && /Icon/.test(node.name))
        kid.name = "Glyph";
      walk(kid);
    });
  };
  walk(root);
  const seen = new Map();
  const unique = (node) => {
    for (const kid of node.children ?? []) {
      const count = (seen.get(kid.name) ?? 0) + 1;
      seen.set(kid.name, count);
      if (count > 1) kid.name = `${kid.name} ${count}`;
      unique(kid);
    }
  };
  unique(root);
  return root;
}

/**
 * `<Button variant="outline" disabled />`, the source file and the story: the
 * link back to code. The last line is the variant key, which identifies the
 * component across re-exports (Pencil keeps `context` on instances but not
 * `metadata`).
 */
export function codeLink(
  name,
  key,
  source,
  story,
  root = ".",
) {
  const props = [...new URLSearchParams(key)]
    .map(([prop, value]) => (value === "" ? ` ${prop}` : ` ${prop}="${value}"`))
    .join("");
  const path = root === "." || !root ? source : `${root}/${source}`;
  return `<${name}${props} />\n${path}\nStorybook: ${story}\nVariant: ${key || "(default)"}`;
}

/** The variant key a component's `context` records, or null for one exported before it did. */
export function contextKey(context) {
  const match = /\nVariant: (.*)$/.exec(context ?? "");
  if (!match) return null;
  return match[1] === "(default)" ? "" : match[1];
}

// What a property falls back to when a variant leaves it unset but the base sets it.
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
  strokeLinecap: "butt",
  strokeLinejoin: "miter",
  layoutPosition: "auto",
};
const OWN = new Set([
  "type",
  "name",
  "children",
  "context",
  "reusable",
  "metadata",
]);

function diffNode(base, node) {
  if (base.type !== node.type) return null;
  const out = {};
  for (const key of new Set([...Object.keys(base), ...Object.keys(node)])) {
    if (OWN.has(key)) continue;
    if (JSON.stringify(base[key]) === JSON.stringify(node[key])) continue;
    if (node[key] === undefined) {
      if (!(key in NEUTRAL)) return null;
      out[key] = NEUTRAL[key];
    } else out[key] = node[key];
  }
  return out;
}

/**
 * `node` as an instance of `base` (`ref: "@base"`) with root and named-layer
 * overrides, or null when its layers differ (an icon where the base has text).
 */
export function asVariant(base, node) {
  const root = diffNode(base, node);
  if (!root) return null;
  const descendants = {};
  const walk = (a, b) => {
    const ak = a.children ?? [];
    const bk = b.children ?? [];
    if (ak.length !== bk.length) return false;
    return ak.every((kid, i) => {
      if (kid.name !== bk[i].name) return false;
      const diff = diffNode(kid, bk[i]);
      if (!diff) return false;
      if (Object.keys(diff).length) descendants[kid.name] = diff;
      return walk(kid, bk[i]);
    });
  };
  if (!walk(base, node)) return null;
  return {
    type: "ref",
    ref: "@base",
    ...root,
    ...(Object.keys(descendants).length ? { descendants } : {}),
  };
}

/**
 * The export for one component: `snapshots[theme]` is `snapshotMatrix`'s
 * result under that theme. Returns the Pencil components in matrix order,
 * the component-scoped variables, and a binding report.
 */
export function buildExport({
  id,
  name,
  story,
  source,
  sourceHash,
  snapshots,
  index,
  slots = {},
  rows = [],
  packagePath = ".",
  metadataPrefix = "ds",
}) {
  const [first] = index.themes;
  const scoped = { byValues: new Map(), variables: {} };
  const report = {
    class: 0,
    value: 0,
    alias: 0,
    literal: 0,
    scoped: 0,
    warnings: [],
  };
  const shapeOf = (n) =>
    n.kind === "element"
      ? `${n.tag}(${n.children.map(shapeOf).join(",")})`
      : n.kind === "svg"
        ? `svg${n.icon ?? n.shapes.length}`
        : "t";
  const components = snapshots[first].instances.map((instance, i) => {
    const trees = Object.fromEntries(
      index.themes.map((t) => [t, snapshots[t].instances[i]?.tree]),
    );
    for (const t of index.themes) {
      if (!trees[t] || shapeOf(trees[t]) !== shapeOf(instance.tree)) {
        report.warnings.push(
          `${instance.key || "default"}: renders differently under ${t}; drew ${first}`,
        );
        trees[t] = instance.tree;
      }
    }
    const node = convertInstance(trees, { index, id, scoped, report, slots });
    const variant = Object.fromEntries(
      [...new URLSearchParams(instance.key)].map(([k, v]) => [k, v || "true"]),
    );
    return {
      key: instance.key,
      row: instance.row,
      width: instance.tree.w,
      node: {
        ...node,
        name: `${name}/${variantName(instance.key)}`,
        context: codeLink(name, instance.key, source, story, packagePath),
        reusable: true,
        metadata: { type: metadataPrefix, id, variant, story, source, sourceHash },
      },
    };
  });
  // `variant=muted` and `tone=muted` would both be "Muted": name the axis too.
  const counts = new Map();
  for (const c of components)
    counts.set(c.node.name, (counts.get(c.node.name) ?? 0) + 1);
  for (const c of components) {
    if (counts.get(c.node.name) > 1)
      c.node.name = `${name}/${variantName(c.key, { qualified: true })}`;
  }
  // Components with the same layers share a base: each other one is an
  // instance of it that overrides what differs, so editing the base's layers
  // reaches them all. The group holding the default variant is the primary
  // base, which slots elsewhere recommend.
  const layers = (n) =>
    `${n.type}:${n.name}(${(n.children ?? []).map(layers).join(",")})`;
  const groups = new Map();
  for (const c of components) {
    // The root's own name is the variant's; only its type and layers count.
    const sig = layers({ ...c.node, name: "" });
    groups.set(sig, [...(groups.get(sig) ?? []), c]);
  }
  const preferred = (list) =>
    list.find((c) => c.key === "") ??
    list.find((c) => c.key === "variant=default") ??
    list[0];
  const primary = preferred(components);
  let group = 0;
  for (const list of groups.values()) {
    const base = preferred(list);
    if (list.length > 1 || base === primary) {
      group += 1;
      base.base = base === primary ? "primary" : `g${group}`;
    }
    for (const c of list) {
      if (c === base) continue;
      const variant = asVariant(base.node, c.node);
      if (variant) {
        const { name: n, context, reusable, metadata } = c.node;
        c.node = {
          ...variant,
          ref: `@${base.base}`,
          name: n,
          context,
          reusable,
          metadata,
        };
      } else report.standalone = (report.standalone ?? 0) + 1;
    }
  }
  // Bases go first in their rows, so they exist before their instances.
  const bases = components.filter((c) => c.base);
  for (const b of bases) {
    components.splice(components.indexOf(b), 1);
    const at = components.findIndex((c) => c.row >= b.row);
    components.splice(at === -1 ? components.length : at, 0, b);
  }
  return {
    id,
    name,
    story,
    surfaces: snapshots[first].surfaces,
    axes: rows.map((r) => r.vary),
    variables: scoped.variables,
    components,
    report,
  };
}

const words = (axis) =>
  axis
    .replace(/^aria-/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();

/** A matrix row's heading: the axes it varies, `Variant × Disabled`. */
export function rowLabel(axes = []) {
  if (!axes.length) return "Example";
  return axes
    .map((a) => words(a).replace(/^./, (c) => c.toUpperCase()))
    .join(" × ");
}

/**
 * The caption under an instance: its values on the row's axes (`outline ·
 * disabled`), so the canvas reads without opening each component.
 */
export function caption(key, axes = []) {
  const props = new URLSearchParams(key);
  const shown = (axes.length ? axes : [...props.keys()]).flatMap((axis) => {
    if (!props.has(axis)) return [];
    const value = props.get(axis);
    if (value === "false") return [`no ${turnedOff(axis)}`];
    return [value === "" || value === "true" ? words(axis) : value];
  });
  return shown.join(" · ") || "default";
}

/** The variables a component's section card is drawn with (config `chrome`). */
export const SECTION_CHROME = {
  fill: "--color-card",
  stroke: "--color-border",
  heading: "--color-foreground",
  muted: "--color-muted-foreground",
  radius: "--radius-xl",
  fontSans: "--font-sans",
  fontMono: "--font-mono",
  brand: "--color-primary",
};

// Pencil frames don't wrap, so the snippet breaks each row into lines this wide.
const LINE_WIDTH = 1400;
const CELL_GAP = 24;
const CAPTION_CHAR = 6.7;

/**
 * What runs in Pencil after `const D = …`. Pencil keeps string globals between
 * `execute` calls, so `--pencil-apply` stores it once as `dsApply` and each
 * export after that sends only `const D=…;eval(dsApply)` (`--pencil-data`).
 * `D.ns` is the metadata prefix, `D.chrome` the variables the section card is
 * drawn with and `D.theme` the Pencil theme a new section takes.
 */
export const PENCIL_APPLY = `const vk=(v)=>JSON.stringify(Object.entries(v||{}).sort());
const ck=(n)=>{const x=/\\nVariant: (.*)$/.exec(n.context||"");return x?(x[1]==="(default)"?"":x[1]):null};
const all=GetVariables().variables;const stale=Object.keys(all).filter((k)=>k.startsWith("--ds-"+D.id+"-")&&!(k in D.variables));
if(stale.length){for(const k of stale)delete all[k];SetVariables({...all,...D.variables},true)}else if(Object.keys(D.variables).length)SetVariables(D.variables);
let anchor=null,parent=document,index,heading=null;const old=[],oldIds={};
Get((n,c)=>{const m=n.metadata;if(m&&(m.type===D.ns+"-section"||m.type===D.ns+"-export")&&m.id===D.id){old.push(n.id);if(!anchor&&m.type===D.ns+"-section"){anchor=n;parent=c.parentCtx?c.parentCtx.node.id:document;index=c.index}}
let inOld=false;for(let p=c.parentCtx;p;p=p.parentCtx)if(old.includes(p.node.id))inOld=true;
if(n.reusable&&((m&&m.type===D.ns&&m.id===D.id)||inOld)){const k=ck(n);oldIds[n.id]=k!==null?"k:"+k:m&&m.variant?"v:"+vk(m.variant):"n:"+n.name}if(!heading&&n.reusable&&n.name==="Text/Section")heading=n.id;return undefined});
if(!anchor){Get((n)=>{if(parent===document&&n.metadata&&n.metadata.type===D.ns+"-slot"&&n.metadata.level===D.level)parent=n.id;return undefined})}
const sec=Insert(parent,{type:"frame",name:D.name,layout:"vertical",gap:32,padding:32,fill:"$"+D.chrome.fill,stroke:"$"+D.chrome.stroke,strokeWidth:1,strokeAlignment:"inner",cornerRadius:"$"+D.chrome.radius,theme:anchor?anchor.theme:D.theme,width:anchor?anchor.width:"fill_container",metadata:{type:D.ns+"-section",id:D.id},children:[{type:"frame",name:"Header",layout:"vertical",gap:6,width:"fill_container",children:[heading?{type:"ref",ref:heading,name:"Heading",content:D.name}:{type:"text",name:"Heading",content:D.name,fontFamily:"$"+D.chrome.fontSans,fontSize:16,fontWeight:"600",fill:"$"+D.chrome.heading},{type:"text",name:"Source",content:D.source+' · data-ds="'+D.id+'" · '+D.count+(D.count===1?" variant":" variants"),fontFamily:"$"+D.chrome.fontMono,fontSize:11,fill:"$"+D.chrome.muted}]}]});
if(index!==undefined)Move(sec,parent,index);
const bases={};const baseOf=(rid)=>{if(rid in bases)return bases[rid];let f=null;Get((n)=>{if(!f&&n.reusable&&n.metadata&&n.metadata.type===D.ns&&n.metadata.id===rid&&n.metadata.base&&!(n.id in oldIds))f=n.id;return undefined});return bases[rid]=f};
const fix=(n)=>{if(n.slot)n.slot=n.slot.map((s)=>s[0]==="@"?baseOf(s.slice(1)):s).filter(Boolean);(n.children||[]).forEach(fix);return n};
const cap=(brand,t)=>({type:"text",name:"Caption",content:t,fontFamily:"$"+D.chrome.fontMono,fontSize:11,fill:brand?"#FFFFFFB3":"$"+D.chrome.muted});
const cells=D.rows.map((r)=>{const g=Insert(sec,{type:"frame",name:r.label,layout:"vertical",gap:12,width:"fill_container",children:[{type:"text",name:"Row Label",content:r.label.toUpperCase(),fontFamily:"$"+D.chrome.fontSans,fontSize:11,fontWeight:"600",letterSpacing:0.6,fill:"$"+D.chrome.muted}]});const st=Insert(g,{type:"frame",name:"Stage",layout:"vertical",gap:20,...(r.surface==="brand"?{fill:"$"+D.chrome.brand,padding:20,cornerRadius:"$"+D.chrome.radius}:{})});return r.lines.map((l)=>{const ln=Insert(st,{type:"frame",name:"Line",gap:24,alignItems:"end"});return l.map((n)=>Insert(ln,{type:"frame",name:n.t,layout:"vertical",gap:8}))})});
const byKey={};let count=0;const baseIds={};const ins=(cell,brand,{v,c,b,t,k,...n})=>{const id=Insert(cell,fix({...n,...(n.ref&&n.ref[0]==="@"?{ref:baseIds[n.ref.slice(1)]}:{}),context:c,metadata:{...D.meta,variant:v,...(b==="primary"?{base:true}:{})}}));Insert(cell,cap(brand,t));if(b)baseIds[b]=id;byKey["k:"+k]=id;byKey["v:"+vk(v)]=id;byKey["n:"+n.name]=id;count+=1;return id};
for(const pass of [true,false])D.rows.forEach((r,i)=>r.lines.forEach((l,j)=>l.forEach((n,k)=>{if(!!n.b===pass)ins(cells[i][j][k],r.surface==="brand",n)})));
const refs=Get((n)=>n.type==="ref"&&n.ref in oldIds?n:undefined);const orphans=[];let repointed=0;
for(const n of refs){const to=byKey[oldIds[n.ref]];if(!to){orphans.push(n.id);continue}const {id,ref,descendants,children,...keep}=n;Replace(n.id,{...keep,type:"ref",ref:to});repointed+=1}
if(!orphans.length){for(const id of old)Delete(id);for(const id of Get((n)=>n.id in oldIds?n.id:undefined))Delete(id)}else for(const id of old)Update(id,{name:D.name+" (old: instances still use it)"});
Print(JSON.stringify({section:sec,components:count,replaced:Object.keys(oldIds).length,repointed,orphans,staleVariables:stale.length}));TakeScreenshot([sec]);`;

/**
 * The Pencil `execute` snippet that makes the export the component's section.
 * The new section takes the place of the existing `<prefix>-section` for the
 * id, one row frame per matrix row. Every instance (`ref`) of an old
 * component is re-pointed to the new component with the same variant, then
 * the old section and components are deleted, as are `--ds-<id>-*` variables
 * the export no longer uses. `themeTuples` maps theme keys to Pencil themes.
 */
export function pencilSnippet(
  exported,
  themeTuples,
  { prefix = "ds", chrome = SECTION_CHROME, theme = Object.values(themeTuples)[0] } = {},
) {
  const variables = Object.fromEntries(
    Object.entries(exported.variables).map(([name, values]) => [
      name,
      {
        type: "color",
        value: Object.entries(values).map(([key, value]) => ({
          value,
          theme: themeTuples[key],
        })),
      },
    ]),
  );
  const rows = [];
  for (const component of exported.components) {
    let row = rows.find((r) => r.row === component.row);
    const axes = exported.axes?.[component.row] ?? [];
    if (!row) {
      row = {
        row: component.row,
        label: rowLabel(axes),
        surface: exported.surfaces[component.row],
        lines: [[]],
        used: 0,
      };
      rows.push(row);
    }
    // Every component shares its context and all metadata but the variant.
    const { context, metadata, ...node } = component.node;
    const cap = caption(component.key, axes);
    const width = Math.max(component.width ?? 0, cap.length * CAPTION_CHAR);
    if (row.used > 0 && row.used + width > LINE_WIDTH) {
      row.lines.push([]);
      row.used = 0;
    }
    row.used += width + CELL_GAP;
    row.lines.at(-1).push({
      ...node,
      v: metadata.variant,
      c: context,
      t: cap,
      k: component.key,
      ...(component.base ? { b: component.base } : {}),
    });
  }
  for (const row of rows) delete row.used;
  const { variant, ...meta } = exported.components[0]?.node.metadata ?? {};
  const data = {
    id: exported.id,
    name: exported.name,
    level: exported.level,
    source: meta.source,
    count: exported.components.length,
    meta,
    variables,
    rows,
    ns: prefix,
    chrome,
    theme,
  };
  return `const D=${JSON.stringify(data)};\n${PENCIL_APPLY}`;
}
