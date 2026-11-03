/// <reference types="vite/client" />
/**
 * The design-system contract, checked on every matrix story: each registry
 * component has one, every prop axis is mirrored or ignored with a reason, and
 * rows only name values the prop types allow. (From the pen-sync plugin's
 * templates; adjust the glob to where your stories live.)
 */
import { describe, expect, it } from "vitest";

import {
  type ComponentMatrix,
  expandMatrix,
  matrixRows,
  matrixVariants,
  uncoveredAxes,
} from "./matrix";
import registry from "./registry.json";

const storyModules = import.meta.glob<Record<string, unknown>>("../**/*.stories.tsx", {
  eager: true,
});
const matrices = Object.entries(storyModules).flatMap(([path, module]) =>
  Object.entries(module as Record<string, unknown>).flatMap(([name, story]) => {
    const matrix = (story as { parameters?: { ds?: { matrix?: ComponentMatrix } } })
      ?.parameters?.ds?.matrix;
    return matrix ? [{ file: `${path}#${name}`, matrix }] : [];
  }),
);
const ids = (registry.components as { id: string }[]).map((c) => c.id);

describe("design-system matrices", () => {
  it("every registry component has exactly one matrix story", () => {
    expect(matrices.map((m) => m.matrix.id).sort()).toEqual([...ids].sort());
  });

  it.each(matrices)("$file: every axis is mirrored or ignored", ({ matrix }) => {
    expect(uncoveredAxes(matrix, matrixVariants(matrix))).toEqual([]);
  });

  it.each(matrices)("$file: rows only name values its props allow", ({ matrix }) => {
    const variants = matrixVariants(matrix);
    for (const row of matrixRows(matrix, variants))
      for (const [axis, values] of Object.entries(row.values ?? {}))
        expect(variants.axes[axis] ?? [false, true]).toEqual(expect.arrayContaining(values));
    expect(expandMatrix(matrix, variants).length).toBeGreaterThan(0);
  });
});
