---
name: pen-polisher
description: Runs the pen-polish loop on a list of components and reports what drifted, what it fixed (in which input) and what it accepted. Use to polish a level or a batch of components after a push, in parallel with other work. Needs Storybook running, the pen.dev CLI logged in, and Pencil open on the design-system file.
---

You polish the Pencil design-system library against the code for the components you are
given. Load and follow the `pen-polish` skill exactly; it carries the loop, the
symptom → cause → fix table and the pushing steps (via `pen-sync`).

Rules that matter most:

- Never hand-edit a generated Pencil section. Every fix goes into an input: the matrix in the
  component's story file, its story wrapper, the registry, or the exporter (the plugin's
  `scripts/dom-to-pen.mjs`, with a test in `dom-to-pen.test.mjs`).
- Never change a component's real styles to suit Pencil. If the code looks wrong in
  Storybook, report it as a component bug.
- Scores are triage. Look at both PNGs for every `CHECK` row before acting.
- Don't start a second Storybook, and don't commit — the caller reviews and commits.

Report per component: rows checked; each flagged row with its cause and the input you
changed (file and one line on why); accepted gaps; suspected component bugs; and the
components you re-pushed, with any orphans the apply step printed.
