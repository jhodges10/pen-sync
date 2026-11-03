import type { ComponentType, ReactNode } from "react";
import { expect } from "storybook/test";

import {
  type ComponentMatrix,
  type MatrixProps,
  type MatrixRow,
  expandMatrix,
  matrixRows,
  matrixVariants,
} from "./matrix";
import registry from "./registry.json";

/**
 * The `VariantMatrix` story of a component's story file: every variant its
 * matrix picks (the default rows when it names none), which the Pencil sync
 * mirrors, so the
 * design-system file follows what the prop types allow rather than what other
 * stories happen to show. Each instance renders inside a `display: contents`
 * span carrying its variant key as `data-ds-variant`; each matrix row is a
 * `data-ds-row`, with `data-ds-surface` when it renders on a brand surface.
 * A wrapper may mark a larger element `data-ds-capture` (a picker's field
 * with its open list); Pencil then mirrors that element instead. The resolved
 * matrix rides along as `data-ds-matrix` JSON, which is where the exporter
 * reads rows and slots from.
 *
 * The story file spreads it under a literal `tags: ["ds-matrix"]`, which
 * Storybook's indexer reads statically, so the sync finds matrix stories in
 * `index.json`.
 */
export function variantMatrixStory<P>(
  component: ComponentType<P>,
  matrix: ComponentMatrix,
) {
  const Component = component as ComponentType<MatrixProps>;
  // A component whose DOM can't carry data-ds is found by its registry selector.
  const selector =
    (registry.components as { id: string; selector?: string }[]).find(
      (c) => c.id === matrix.id,
    )?.selector ?? `[data-ds="${matrix.id}"]`;
  const variants = matrixVariants(matrix);
  const rows = matrixRows(matrix, variants);
  const instances = expandMatrix(matrix, variants);
  return {
    name: "Variant matrix",
    parameters: { layout: "padded", ds: { id: matrix.id, matrix } },
    render: () => (
      <VariantMatrix
        component={Component}
        instances={instances}
        rows={rows}
        embedded={JSON.stringify({ id: matrix.id, rows, slots: matrix.slots })}
      />
    ),
    /** Every instance renders its data-ds element inside its variant key. */
    play: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const keys = [
        ...canvasElement.querySelectorAll("[data-ds-variant]"),
      ].flatMap((el) =>
        el.querySelector(selector) ? [el.getAttribute("data-ds-variant")] : [],
      );
      await expect(keys).toEqual(instances.map((i) => i.key));
    },
  };
}

/**
 * Stand-ins a matrix can use as children (`children: "$icon"`), since a
 * matrix is plain data. Map them to your icon set, e.g. `$icon: <PlusIcon />`.
 */
const TOKENS: Record<string, ReactNode> = {
  $icon: <svg aria-hidden className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M12 5v14M5 12h14" /></svg>,
};

function renderChildren(children: unknown): ReactNode {
  if (Array.isArray(children)) {
    return children.map((child, i) => (
      <span className="contents" key={i}>
        {renderChildren(child)}
      </span>
    ));
  }
  return typeof children === "string" && children in TOKENS
    ? TOKENS[children]
    : (children as ReactNode);
}

function VariantMatrix({
  component: Component,
  instances,
  rows: matrixRows,
  embedded,
}: {
  component: ComponentType<MatrixProps>;
  instances: ReturnType<typeof expandMatrix>;
  rows: MatrixRow[];
  embedded: string;
}) {
  const rows = new Map<number, typeof instances>();
  for (const instance of instances) {
    rows.set(instance.row, [...(rows.get(instance.row) ?? []), instance]);
  }
  return (
    <div className="flex flex-col gap-6" data-ds-matrix={embedded}>
      {[...rows].map(([row, rowInstances]) => (
        <div
          // A brand row sits on your brand color; change the class to match.
          className={
            matrixRows[row]?.surface === "brand"
              ? "flex flex-wrap items-center gap-4 self-start rounded-lg bg-primary p-4"
              : "flex flex-wrap items-center gap-4"
          }
          data-ds-row={row}
          data-ds-surface={matrixRows[row]?.surface}
          key={row}
        >
          {rowInstances.map(({ key, props: { children, ...props } }) => (
            // The key sits on a layout-less wrapper, so a component needn't
            // forward it to the element that carries its data-ds.
            <span className="contents" data-ds-variant={key} key={key}>
              <Component {...props}>{renderChildren(children)}</Component>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
