/**
 * The bundled docgen: reads a component's props through the repo's own
 * `typescript` (the classic compiler API, TypeScript 5 or 6), for repos whose
 * `pen-sync.config.json` sets no `docgen`. `variants.mjs` turns its output into
 * axes and states.
 *
 * `createDocgenSession({ cwd }).describe(requests, { inherited })` takes
 * `{ dir, specifier, exportName }` per component and returns, per request,
 * `{ props: [{ name, declarations, values }] }` or `{ error }`: every prop
 * declared outside node_modules plus the inherited ones asked for, with its
 * literal values (sorted, booleans first) or null when it isn't a union of
 * literals.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { repo } from "./config.mjs";

const EXTENSIONS = [".tsx", ".ts", "/index.tsx", "/index.ts"];

/** Sorted the way the TypeScript 7 docgen sorts: by type, then value. */
const sortValues = (values) =>
  values.sort((a, b) =>
    typeof a === typeof b
      ? a < b
        ? -1
        : a > b
          ? 1
          : 0
      : typeof a < typeof b
        ? -1
        : 1,
  );

export function createDocgenSession({ cwd }) {
  // `PEN_SYNC_TYPESCRIPT` points at another install (a repo on TypeScript 7,
  // whose package has no compiler API, can keep a 5 or 6 for this).
  const ts = createRequire(
    process.env.PEN_SYNC_TYPESCRIPT
      ? join(process.env.PEN_SYNC_TYPESCRIPT, "package.json")
      : join(repo, "package.json"),
  )(process.env.PEN_SYNC_TYPESCRIPT ? "./lib/typescript.js" : "typescript");
  if (!ts.createProgram)
    throw new Error(
      `typescript ${ts.version ?? ""} has no compiler API (TypeScript 7+): set pen-sync.config.json → docgen, or PEN_SYNC_TYPESCRIPT to a TypeScript 5 or 6 install`,
    );
  const configPath = ts.findConfigFile(cwd, ts.sys.fileExists, "tsconfig.json");
  const options = configPath
    ? ts.parseJsonConfigFileContent(
        ts.readConfigFile(configPath, ts.sys.readFile).config,
        ts.sys,
        dirname(configPath),
      ).options
    : { jsx: ts.JsxEmit.ReactJSX, strict: true };

  const literalValues = (checker, type) => {
    const members = (type.isUnion() ? type.types : [type]).filter(
      (t) => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null)),
    );
    if (!members.length) return null;
    const values = [];
    for (const member of members) {
      if (member.isStringLiteral() || member.isNumberLiteral()) values.push(member.value);
      else if (member.flags & ts.TypeFlags.BooleanLiteral)
        values.push(checker.typeToString(member) === "true");
      else return null;
    }
    return sortValues([...new Set(values)]);
  };

  return {
    describe(requests, { inherited = [] } = {}) {
      const files = requests.map(({ dir, specifier }) =>
        EXTENSIONS.map((ext) => join(dir, specifier) + ext).find(existsSync),
      );
      const program = ts.createProgram(
        files.filter(Boolean),
        { ...options, noEmit: true },
      );
      const checker = program.getTypeChecker();
      return requests.map(({ exportName }, i) => {
        const source = files[i] && program.getSourceFile(files[i]);
        if (!source) return { error: "source file not found" };
        const module = checker.getSymbolAtLocation(source);
        const symbol = module && checker.getExportsOfModule(module).find((s) => s.name === exportName);
        if (!symbol) return { error: `no export ${exportName}` };
        const resolved =
          symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        const type = checker.getTypeOfSymbolAtLocation(resolved, source);
        // A function component's first parameter, or the props of a
        // forwardRef/memo object, which are callable too.
        const [signature] = type.getCallSignatures();
        const parameter = signature?.getParameters()[0];
        if (!parameter) return { props: [] };
        const propsType = checker.getTypeOfSymbolAtLocation(parameter, source);
        // A union of prop shapes (a discriminated `multiple`) lists only the
        // props every member shares; take each member's, values merged.
        const shapes = propsType.isUnion() ? propsType.types : [propsType];
        const byName = new Map();
        for (const shape of shapes)
          for (const prop of checker.getPropertiesOfType(shape))
            byName.set(prop.name, [...(byName.get(prop.name) ?? []), prop]);
        const props = [];
        for (const [name, symbols] of byName) {
          const declarations = [
            ...new Set(
              symbols.flatMap((prop) =>
                (prop.getDeclarations() ?? []).map((d) => d.getSourceFile().fileName),
              ),
            ),
          ];
          const own = declarations.some((f) => !f.includes("/node_modules/"));
          if (!own && !inherited.includes(name)) continue;
          const each = symbols.map((prop) =>
            literalValues(
              checker,
              checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(prop, source)),
            ),
          );
          const values = each.includes(null)
            ? null
            : sortValues([...new Set(each.flat())]);
          props.push({ name, declarations, values });
        }
        return { props };
      });
    },
    close() {},
  };
}
