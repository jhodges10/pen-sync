/**
 * Where the pen-sync scripts find things, read from `pen-sync.config.json` at
 * the repo root (`node <plugin>/scripts/init.mjs` writes one). Every key is
 * optional; the defaults fit a shadcn-style package with light and dark
 * themes. `pen-sync.config.schema.json` documents each key.
 *
 * The scripts live in the plugin, so the repo is found from the working
 * directory: the nearest ancestor holding the config file, else
 * `PEN_SYNC_ROOT`, else the working directory itself.
 */
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const CONFIG_FILE = "pen-sync.config.json";

/** The nearest directory at or above `from` holding the config file. */
export function findRepo(from = process.cwd()) {
  for (let dir = from; ; dir = dirname(dir)) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    if (dirname(dir) === dir) return process.env.PEN_SYNC_ROOT ?? from;
  }
}

export const repo = findRepo();

/**
 * A theme is one combination the tokens resolve under. `pencil` is its Pencil
 * theme (one value per axis, e.g. `{ mode: "dark" }`); `storybook` the
 * Storybook globals that render a story in it (null: tokens only, no story
 * render); `html` the attributes on `<html>` that switch the token CSS to it.
 */
export const DEFAULT_THEMES = [
  {
    key: "light",
    pencil: { mode: "light" },
    storybook: { theme: "light" },
    html: {},
  },
  {
    key: "dark",
    pencil: { mode: "dark" },
    storybook: { theme: "dark" },
    html: { class: "dark" },
  },
];

/** Token families tried, in order, when no class names a paint's token. */
export const DEFAULT_ALIAS_ORDER = [
  "^--color-(background|foreground|card|popover|primary|secondary|muted|accent|border|input|ring|destructive)(-|$)",
];

export const DEFAULTS = {
  package: ".",
  packageName: null,
  registry: "src/design-system/registry.json",
  variants: "src/design-system/variants.json",
  storybook: "http://localhost:6006",
  playwright: "package.json",
  pen: "design/design-system.lib.pen",
  library: "design/design-system.library.md",
  tokens: "design/tokens.json",
  tokenSource: "src/styles/tokens.css",
  docgen: null,
  polishDir: join(tmpdir(), "pen-sync-polish"),
  penCommand: "pen",
  usage: ["apps", "src"],
  themes: DEFAULT_THEMES,
  metadataPrefix: "ds",
  aliasOrder: DEFAULT_ALIAS_ORDER,
  chrome: {
    fill: "--color-card",
    stroke: "--color-border",
    heading: "--color-foreground",
    muted: "--color-muted-foreground",
    radius: "--radius-xl",
    fontSans: "--font-sans",
    fontMono: "--font-mono",
    brand: "--color-primary",
  },
};

/** The defaults overlaid with a config file's keys (unknown keys are an error). */
export function loadConfig(file = join(repo, CONFIG_FILE)) {
  if (!existsSync(file)) return { ...DEFAULTS };
  const { $schema: _schema, ...read } = JSON.parse(readFileSync(file, "utf8"));
  const unknown = Object.keys(read).filter((k) => !(k in DEFAULTS));
  if (unknown.length)
    throw new Error(`${file}: unknown key(s) ${unknown.join(", ")}`);
  const merged = { ...DEFAULTS, ...read, chrome: { ...DEFAULTS.chrome, ...read.chrome } };
  if (!merged.themes.length) throw new Error(`${file}: themes is empty`);
  return merged;
}

export const config = loadConfig();

/** Absolute paths for the package and its registry, as most scripts need them. */
export const packageRoot = join(repo, config.package);
export const registryPath = join(packageRoot, config.registry);

/** The themes stories render under (those with Storybook globals). */
export const storyThemes = config.themes.filter((t) => t.storybook);

/** `{ theme: "dark", brand: "b" }` → `theme:dark;brand:b` for `iframe.html?globals=`. */
export const globalsParam = (globals) =>
  Object.entries(globals)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

/** Metadata `type`s on the nodes the sync writes. */
export const metaType = {
  component: config.metadataPrefix,
  section: `${config.metadataPrefix}-section`,
  slot: `${config.metadataPrefix}-slot`,
};
