import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DYNAMIC,
  axisValues,
  countUsage,
  cvaCalls,
  openingTags,
  unusedValues,
} from "./variant-usage.mjs";

test("opening tags end at the first > outside braces and quotes", () => {
  const source = `<Button onClick={() => a > b} variant="ghost">Go</Button><ButtonGroup />`;
  assert.deepEqual(openingTags(source, "Button"), [
    ` onClick={() => a > b} variant="ghost"`,
  ]);
});

test("reads string, braced-literal, flag and dynamic values", () => {
  assert.deepEqual(
    axisValues(` variant="ghost" size={"sm"} picker loading={false} tone={tone}`, [
      "variant",
      "size",
      "picker",
      "loading",
      "tone",
      "shape",
    ]),
    { variant: "ghost", size: "sm", picker: true, loading: false, tone: DYNAMIC },
  );
});

test("counts cva calls too", () => {
  assert.deepEqual(
    cvaCalls(`cn(buttonVariants({ variant: "outline", size }))`, "buttonVariants", [
      "variant",
      "size",
    ]),
    [{ variant: "outline", size: DYNAMIC }],
  );
});

test("an unused value is one no use sets; a dynamic axis lists none", () => {
  const variants = {
    button: { axes: { variant: ["default", "ghost", "link"], size: ["default", "sm"] } },
  };
  const usage = countUsage(
    [{ id: "button", name: "Button" }],
    variants,
    ["a.tsx", "b.tsx"],
    (f) =>
      f === "a.tsx"
        ? `<Button variant="ghost" size={s}>x</Button>`
        : `<Button>y</Button>`,
  );
  assert.equal(usage.button.uses, 2);
  assert.deepEqual(unusedValues(usage, variants), { button: { variant: ["link"] } });
});
