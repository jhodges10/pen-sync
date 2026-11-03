/**
 * Runs in the Storybook page: whether `<html>` shows the theme yet. Its own
 * classes and attributes must be set; a class another theme uses must be
 * absent, and an attribute another theme sets mustn't hold that theme's
 * value (a default left in place, `data-brand="A"`, still counts).
 * Self-contained, so Playwright can serialize it.
 */
export function themeReady({ html, others }) {
  const root = document.documentElement;
  const classes = (h) => String(h.class ?? "").split(/\s+/).filter(Boolean);
  const mine = classes(html);
  if (!mine.every((c) => root.classList.contains(c))) return false;
  const foreign = others.flatMap(classes).filter((c) => !mine.includes(c));
  if (foreign.some((c) => root.classList.contains(c))) return false;
  for (const [name, value] of Object.entries(html))
    if (name !== "class" && root.getAttribute(name) !== value) return false;
  for (const other of others)
    for (const [name, value] of Object.entries(other))
      if (name !== "class" && !(name in html) && root.getAttribute(name) === value)
        return false;
  return true;
}
