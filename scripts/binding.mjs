/**
 * Color helpers the exporter binds paints with.
 *
 * Many tokens share a value in every theme (`--color-primary` =
 * `--color-ring`), so a value alone can't say which token the code meant. The
 * element's Tailwind classes can: `bg-primary` names `--color-primary`.
 * `colorClassTokens` reads those hints from a class list; `hexDistance`
 * compares a measured color with a token's value.
 */

/** Color utilities in a class list, variant prefixes and opacity removed, in order. */
export function colorClassTokens(className) {
  const kinds = {
    bg: "bg",
    text: "text",
    border: "border",
    fill: "fill",
    stroke: "stroke",
    outline: "border",
    ring: "ring",
  };
  const out = [];
  for (const raw of String(className).split(/\s+/)) {
    if (!raw || raw.includes("[")) continue;
    const base = raw.split(":").pop().replace(/^!/, "");
    if (base.includes("/")) continue; // opacity modifiers paint a derived color, not the token
    const match =
      /^(bg|text|border|fill|stroke|outline|ring)-([a-z][a-z0-9-]*)$/.exec(
        base,
      );
    // text-current / bg-transparent name no token; the color comes from elsewhere.
    if (match && !["current", "inherit", "transparent"].includes(match[2]))
      out.push({ kind: kinds[match[1]], token: match[2] });
  }
  return out;
}

/** Largest per-channel difference between two #rrggbb[aa] colors (alpha defaults to ff). */
export function hexDistance(a, b) {
  const channels = (hex) => {
    const h = String(hex).replace("#", "").toLowerCase();
    const full = h.length === 6 ? `${h}ff` : h;
    return [0, 2, 4, 6].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
  };
  const [x, y] = [channels(a), channels(b)];
  return Math.max(...x.map((v, i) => Math.abs(v - y[i])));
}
