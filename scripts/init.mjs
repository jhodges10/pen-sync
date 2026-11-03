/**
 * Set a repo up for pen-sync: write `pen-sync.config.json`, copy the React kit
 * (matrix types, the VariantMatrix story helper, an empty registry) into the
 * component package, and create the Pencil file with a board per level.
 * Nothing that exists is overwritten.
 *
 *   node <plugin>/scripts/init.mjs                         # package at the repo root
 *   node <plugin>/scripts/init.mjs --package packages/ui   # a package in a monorepo
 *   node <plugin>/scripts/init.mjs --no-pen                # skip creating the .pen file
 *
 * Run it from the repo root. It reads `components.json` (shadcn) when there is
 * one, for the token stylesheet.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const templates = join(here, "..", "templates");

/** The config `init` writes: what it could detect, defaults for the rest. */
export function initialConfig({ pkg, tokenSource, playwright, prefix }) {
  return {
    package: pkg,
    registry: "src/design-system/registry.json",
    variants: "src/design-system/variants.json",
    storybook: "http://localhost:6006",
    playwright,
    pen: "design/design-system.lib.pen",
    library: "design/design-system.library.md",
    tokens: "design/tokens.json",
    tokenSource,
    metadataPrefix: prefix,
    themes: [
      { key: "light", pencil: { mode: "light" }, storybook: { theme: "light" }, html: {} },
      { key: "dark", pencil: { mode: "dark" }, storybook: { theme: "dark" }, html: { class: "dark" } },
    ],
  };
}

/** Runs in Pencil: a board per level, each with the slot new sections land in. */
export const SCAFFOLD = (prefix) => {
  const levels = [
    ["atom", "Atoms"],
    ["molecule", "Molecules"],
    ["organism", "Organisms"],
    ["template", "Templates"],
  ];
  const boards = levels.map(([level, title], i) => ({
    type: "frame",
    name: `0${i + 1} · ${title}`,
    x: i * 1700,
    y: 0,
    width: 1600,
    layout: "vertical",
    gap: 32,
    padding: 64,
    fill: "#ffffff",
    children: [
      { type: "text", name: "Title", content: title, fontSize: 40, fontWeight: "700" },
      {
        type: "frame",
        name: "Components",
        width: "fill_container",
        layout: "vertical",
        gap: 48,
        padding: 24,
        metadata: { type: `${prefix}-slot`, level },
      },
    ],
  }));
  return `for(const b of ${JSON.stringify(boards)})Insert(document,b);Print("boards",${boards.length})`;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const repo = process.cwd();
  const pkg = flag("--package") ?? ".";
  const pkgRoot = join(repo, pkg);
  const done = [];

  // shadcn's components.json names the stylesheet that holds the tokens.
  let tokenSource = "src/styles/globals.css";
  const shadcn = join(pkgRoot, "components.json");
  if (existsSync(shadcn)) {
    const css = JSON.parse(readFileSync(shadcn, "utf8")).tailwind?.css;
    if (css) tokenSource = css;
  }
  // Playwright: the package that depends on it (the package, else the root).
  const hasPlaywright = (dir) => {
    const file = join(repo, dir, "package.json");
    if (!existsSync(file)) return false;
    const { dependencies = {}, devDependencies = {} } = JSON.parse(readFileSync(file, "utf8"));
    return "playwright" in dependencies || "playwright" in devDependencies || "@playwright/test" in devDependencies;
  };
  const playwright = hasPlaywright(pkg) ? join(pkg, "package.json") : "package.json";

  const configFile = join(repo, "pen-sync.config.json");
  const prefix = flag("--prefix") ?? "ds";
  if (!existsSync(configFile)) {
    writeFileSync(
      configFile,
      `${JSON.stringify(initialConfig({ pkg, tokenSource, playwright, prefix }), null, 2)}\n`,
    );
    done.push("wrote pen-sync.config.json");
  }

  // The React kit, unless the package already has one.
  const kit = join(pkgRoot, "src/design-system");
  mkdirSync(kit, { recursive: true });
  for (const file of readdirSync(join(templates, "design-system"))) {
    if (file.startsWith(".") || !statSync(join(templates, "design-system", file)).isFile())
      continue;
    const to = join(kit, file);
    if (existsSync(to)) continue;
    copyFileSync(join(templates, "design-system", file), to);
    done.push(`copied ${relative(repo, to)}`);
  }

  // The Pencil file, with a board per level for sections to land in.
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  const pen = join(repo, config.pen ?? "design/design-system.lib.pen");
  if (!args.includes("--no-pen") && !existsSync(pen)) {
    mkdirSync(dirname(pen), { recursive: true });
    const [command, ...prefixArgs] = (process.env.PEN_SYNC_PEN ?? "pen").split(" ");
    const run = spawnSync(command, [...prefixArgs, "interactive", "-o", pen], {
      input: `execute(${JSON.stringify({ input: SCAFFOLD(config.metadataPrefix ?? prefix) })})\nsave()\nexit()\n`,
      encoding: "utf8",
    });
    if (run.error || run.status !== 0 || !existsSync(pen))
      console.error(
        `Couldn't create ${config.pen} (is the pen.dev CLI installed and logged in?): ${run.error?.message ?? run.stderr}`,
      );
    else done.push(`created ${relative(repo, pen)} with a board per level`);
  }

  for (const line of done) console.log(`✓ ${line}`);
  console.log(`
Next:
  1. Check pen-sync.config.json: themes (the classes or attributes your token CSS switches
     on, and your Storybook theme globals), tokenSource, storybook.
  2. Register a component in ${relative(repo, join(kit, "registry.json"))}, stamp data-ds="<id>"
     on its root, and add a VariantMatrix story (see the pen-sync skill).
  3. node ${relative(repo, join(here, "variants.mjs"))}       # prop axes → variants.json
     node ${relative(repo, join(here, "export-tokens.mjs"))}  # tokens → ${config.tokens}
     node ${relative(repo, join(here, "pen-sync.mjs"))} --tokens --headless
     node ${relative(repo, join(here, "pen-sync.mjs"))} --all --headless`);
}
