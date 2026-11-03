/** A theme set with two axes and a token-only theme, for the scripts' tests. */
const both = [
  ["light", "A", {}],
  ["dark", "A", { class: "dark" }],
  ["light", "B", { "data-brand": "B" }],
  ["dark", "B", { class: "dark", "data-brand": "B" }],
];

export const THEMES = [
  ...both.map(([mode, brand, html]) => ({
    key: `${mode}/${brand}`,
    pencil: { mode, brand },
    storybook: { theme: mode, brand },
    html,
  })),
  {
    key: "dark/embed",
    pencil: { mode: "dark", brand: "A", host: "embed" },
    storybook: null,
    html: { "data-theme": "dark" },
  },
];
