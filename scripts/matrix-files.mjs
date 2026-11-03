/**
 * Where a registry component's matrix and VariantMatrix story live. The matrix
 * is `<id>.matrix.ts` beside the component's file, so several components in
 * one file (Sheet, SheetBody) each get their own. The story is in the file's
 * `.stories.tsx`: `VariantMatrix` for the component the file is named after,
 * `VariantMatrix<Id>` (`VariantMatrixSheetBody`) for the others.
 */
const base = (file) =>
  file
    .split("/")
    .pop()
    .replace(/\.tsx$/, "");
const pascal = (id) =>
  id.replace(/(^|-)([a-z0-9])/g, (_, _dash, c) => c.toUpperCase());

/** `src/ui/sheet.tsx`, `sheet-body` → `src/ui/sheet-body.matrix.ts`. */
export const matrixFile = ({ id, file }) =>
  file.replace(/[^/]+\.tsx$/, `${id}.matrix.ts`);

export const storiesFile = ({ file }) => file.replace(/\.tsx$/, ".stories.tsx");

/** The story's export name. */
export const storyExport = ({ id, file }) =>
  id === base(file) ? "VariantMatrix" : `VariantMatrix${pascal(id)}`;

/** Storybook's id suffix for that export: `variant-matrix-sheet-body`. */
export const storyIdSuffix = (component) =>
  storyExport(component)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
