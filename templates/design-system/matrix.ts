/**
 * Expands a component's matrix (declared in its story file's `VariantMatrix`
 * story) into the instances that story renders, and the Pencil sync mirrors
 * one component per instance.
 *
 * A matrix is a few rows, not the cross-product of every axis: Button alone
 * has 20 variants × 22 sizes. Each row varies some axes over their values
 * (from `variants.json`, the prop types) and holds every other axis at its
 * default by leaving the prop out. A matrix without `rows` gets the default:
 * one row per axis, then one per styled state, so most components need only
 * an `id`. `ignore` names the axes a matrix deliberately leaves out, with the
 * reason; `uncoveredAxes` lists the rest, so a new variant can't land without
 * a decision.
 */
import variants from "./variants.json";

export type MatrixValue = string | number | boolean;
export type MatrixProps = Record<string, unknown>;

export interface MatrixRow {
  /** Axes or states this row varies; several give their cross-product. */
  vary: string[];
  /** Restrict an axis to these values instead of every one in its type. */
  values?: Record<string, MatrixValue[]>;
  /** Leave these values out, so the row still picks up new ones. */
  exclude?: Record<string, MatrixValue[]>;
  /** Props every instance in this row gets. */
  props?: MatrixProps;
  /** Render the row on a brand surface, for variants made for one. */
  surface?: "brand";
}

export interface Matrix {
  /** Props every instance gets (`children: "$icon"` renders an icon). */
  props?: MatrixProps;
  /** The rows to render; leave out for the default (every axis, then every state). */
  rows?: MatrixRow[];
  /** Rows added after `rows` or the default, for the few instances a default misses. */
  extraRows?: MatrixRow[];
  /** Extra props for instances whose axes match, such as an icon for icon sizes. */
  overrides?: { when: Record<string, MatrixValue[]>; props: MatrixProps }[];
  /** Axis → why the matrix leaves it out. */
  ignore?: Record<string, string>;
  /**
   * Parts that take arbitrary children, by `data-slot` → registry ids of the
   * components that usually go there. Pencil draws each as an empty slot
   * frame that recommends those components' base variants.
   */
  slots?: Record<string, string[]>;
  /**
   * Props whose default isn't false (`showCloseButton: true`). Turning one
   * off is then a variant of its own (`showCloseButton=false`) instead of
   * reading as the default.
   */
  defaults?: Record<string, MatrixValue>;
  /**
   * Axes the prop types don't show: a prop of the root or of the story's
   * wrapper (Drawer's `swipeDirection`, a resizable group's `orientation`),
   * with the values to mirror. They key and vary like any other axis.
   */
  axes?: Record<string, MatrixValue[]>;
}

export interface ComponentVariants {
  axes: Record<string, MatrixValue[]>;
  states: string[];
}

export interface MatrixInstance {
  /** Sorted query string of the axes it sets, e.g. `disabled&variant=outline`. */
  key: string;
  /** Index of the row it came from. */
  row: number;
  props: MatrixProps;
}

function valuesOf(
  axis: string,
  row: MatrixRow,
  variants: ComponentVariants,
): MatrixValue[] {
  const values =
    row.values?.[axis] ??
    variants.axes[axis] ??
    (variants.states.includes(axis) ? [false, true] : undefined);
  if (!values) throw new Error(`Unknown axis "${axis}"`);
  const excluded = row.exclude?.[axis] ?? [];
  return values.filter((value) => !excluded.includes(value));
}

/** `{ variant: "outline", disabled: true }` → `disabled&variant=outline`. */
export function variantKey(
  props: MatrixProps,
  variants: ComponentVariants,
  defaults: Record<string, MatrixValue> = {},
): string {
  return Object.keys(props)
    .filter(
      (name) =>
        (name in variants.axes || variants.states.includes(name)) &&
        props[name] !== undefined &&
        (name in defaults
          ? props[name] !== defaults[name]
          : props[name] !== false),
    )
    .sort()
    .map((name) =>
      props[name] === true ? name : `${name}=${String(props[name])}`,
    )
    .join("&");
}

/**
 * The default rows: each axis varied on its own, then each styled state turned
 * on (off, for one whose default is on), skipping ignored axes and axes the
 * matrix's `props` set. A component with neither gets one default instance.
 * Keys repeat across rows only when they really are the same instance.
 */
export function defaultRows(
  matrix: Matrix,
  variants: ComponentVariants,
): MatrixRow[] {
  const skip = new Set([
    ...Object.keys(matrix.ignore ?? {}),
    ...Object.keys(matrix.props ?? {}),
  ]);
  // Only the first row shows an axis at "default": after it, that instance
  // would repeat the base the first row already drew.
  const axisRows: MatrixRow[] = Object.keys(variants.axes)
    .filter((axis) => !skip.has(axis))
    .map((axis, i) =>
      i > 0 && variants.axes[axis]?.includes("default")
        ? { vary: [axis], exclude: { [axis]: ["default"] } }
        : { vary: [axis] },
    );
  // With no axis row to draw the base, the first state row draws it too.
  const stateRows: MatrixRow[] = variants.states
    .filter((state) => !skip.has(state) && !(state in variants.axes))
    .map((state, i) =>
      axisRows.length === 0 && i === 0
        ? { vary: [state] }
        : {
            vary: [state],
            values: { [state]: [matrix.defaults?.[state] !== true] },
          },
    );
  const rows = [...axisRows, ...stateRows];
  return rows.length ? rows : [{ vary: [] }];
}

/** The rows a matrix renders: its own or the default, then its extra rows. */
export function matrixRows(
  matrix: Matrix,
  variants: ComponentVariants,
): MatrixRow[] {
  return [
    ...(matrix.rows ?? defaultRows(matrix, variants)),
    ...(matrix.extraRows ?? []),
  ];
}

/** Every instance, in row order, each distinct key once. */
export function expandMatrix(
  matrix: Matrix,
  variants: ComponentVariants,
): MatrixInstance[] {
  const seen = new Set<string>();
  const instances: MatrixInstance[] = [];
  matrixRows(matrix, variants).forEach((row, index) => {
    let combos: MatrixProps[] = [{}];
    for (const axis of row.vary) {
      combos = combos.flatMap((combo) =>
        valuesOf(axis, row, variants).map((value) => ({
          ...combo,
          [axis]: value,
        })),
      );
    }
    for (const combo of combos) {
      let props: MatrixProps = { ...matrix.props, ...row.props, ...combo };
      for (const { when, props: extra } of matrix.overrides ?? []) {
        if (
          Object.entries(when).every(([axis, values]) =>
            values.includes(props[axis] as MatrixValue),
          )
        ) {
          props = { ...props, ...extra };
        }
      }
      const key = variantKey(props, variants, matrix.defaults);
      if (seen.has(key)) continue;
      seen.add(key);
      instances.push({ key, row: index, props });
    }
  });
  return instances;
}

/** Axes and states neither varied, set by a row, nor ignored. */
export function uncoveredAxes(
  matrix: Matrix,
  variants: ComponentVariants,
): string[] {
  const covered = new Set([
    ...Object.keys(matrix.ignore ?? {}),
    ...Object.keys(matrix.props ?? {}),
    ...matrixRows(matrix, variants).flatMap((row) => [
      ...row.vary,
      ...Object.keys(row.props ?? {}),
    ]),
  ]);
  return [...Object.keys(variants.axes), ...variants.states].filter(
    (axis) => !covered.has(axis),
  );
}

/**
 * A component's matrix, declared where its story file's `VariantMatrix` story
 * renders it. `id` is its registry id.
 */
export interface ComponentMatrix extends Matrix {
  id: string;
}

/** The axes and states `variants.json` extracted for a registry id. */
/** The component's axes and states, plus the ones its matrix declares. */
export function matrixVariants(matrix: ComponentMatrix): ComponentVariants {
  const component = variantsOf(matrix.id);
  return {
    axes: { ...component.axes, ...matrix.axes },
    states: component.states,
  };
}

export function variantsOf(id: string): ComponentVariants {
  const component = (variants.components as Record<string, ComponentVariants>)[
    id
  ];
  if (!component) throw new Error(`variants.json has no "${id}"`);
  return component;
}
