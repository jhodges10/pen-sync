import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

import { chunks, hash, payloadPage, TAKE } from "./pencil-chunks.mjs";
import {
  compare,
  meanDifference,
  missingInk,
  pencilExport,
  polishName,
} from "./polish-diff.mjs";

const lz = createRequire(import.meta.url)("lz-string");

test("chunks reassemble into one block per export, and a garbled chunk fails alone", () => {
  const bodies = [
    `const D={"id":"a"};eval(dsApply);`,
    `const D={"id":"b"};eval(dsApply);`,
  ];
  const { parts, store } = chunks(bodies, 40);
  assert.ok(parts.length > 1);
  let dsBuf = "";
  const run = (snippet) =>
    new Function("dsBuf", "Print", `${snippet};return dsBuf;`)(
      dsBuf,
      () => {},
    );
  for (const part of parts) dsBuf = run(part);
  const body = lz.decompressFromBase64(dsBuf).split("\n");
  assert.deepEqual(
    body,
    bodies.map((b) => `{const TakeScreenshot=()=>{};${b}}`),
  );
  assert.match(store, new RegExp(String(hash(dsBuf))));
  const garbled = parts[0].replace(/const p="./, 'const p="!');
  assert.throws(() => run(garbled), /chunk 1 garbled/);
});

test("variant keys become file names", () => {
  assert.equal(polishName(""), "default");
  assert.equal(
    polishName("disabled&variant=outline"),
    "disabled__variant-outline",
  );
});

test("the difference is 0 for equal images and counts transparency as white", () => {
  const png = (pixels) => ({
    width: 2,
    height: 1,
    data: Uint8Array.from(pixels),
  });
  const white = png([255, 255, 255, 255, 0, 0, 0, 0]);
  assert.equal(meanDifference(white, white), 0);
  const black = png([0, 0, 0, 255, 0, 0, 0, 255]);
  assert.equal(meanDifference(white, black), 255);
  // A translucent black at half alpha matches its flattened grey.
  const translucent = png(
    [0, 0, 0, 255, 0, 0, 0, 255].map((v, i) => (i % 4 === 3 ? 128 : v)),
  );
  const grey = png([127, 127, 127, 255, 127, 127, 127, 255]);
  assert.ok(meanDifference(translucent, grey) < 1);
});

test("on a brand surface, translucent paint is composited over that surface", () => {
  const png = (pixels) => ({ width: 1, height: 1, data: Uint8Array.from(pixels) });
  const navy = [30, 45, 125];
  // Pencil keeps a half-alpha white; the browser flattened it onto the navy.
  const pencil = png([255, 255, 255, 128]);
  const shot = png([143, 150, 190, 255]);
  assert.ok(meanDifference(shot, pencil, 0, 0, 1, navy) < 1);
  assert.ok(meanDifference(shot, pencil) > 50);
  // The bare surface is not ink, so an empty Pencil export loses nothing.
  assert.equal(missingInk(png([...navy, 255]), png([0, 0, 0, 0]), 0, 0, navy), 0);
});

test("compare crops a shadow's bleed and forgives a pixel of misalignment", () => {
  // A w×h white image with one black pixel at (px, py).
  const image = (width, height, px, py) => {
    const data = new Uint8Array(width * height * 4).fill(255);
    data.fill(0, (py * width + px) * 4, (py * width + px) * 4 + 3);
    return { width, height, data };
  };
  const shot = image(10, 10, 4, 4);
  const bled = compare(shot, image(18, 18, 8, 8));
  assert.deepEqual([bled.dw, bled.dh, bled.bleed, bled.diff], [0, 0, 8, 0]);
  const nudged = compare(shot, image(10, 10, 6, 4));
  assert.equal(nudged.diff, 0);
  const wider = compare(shot, image(14, 10, 4, 4));
  assert.deepEqual([wider.dw, wider.dh, wider.bleed], [4, 0, 0]);
  // Wider by a faint shadow alone (a popup's, left and right) is bleed too.
  const shadowed = image(14, 10, 6, 4);
  for (let y = 0; y < 10; y += 1)
    for (const x of [0, 1, 12, 13]) shadowed.data[(y * 14 + x) * 4 + 3] = 20;
  const sided = compare(shot, shadowed);
  assert.deepEqual([sided.dw, sided.dh, sided.bleed, sided.diff], [0, 0, 4, 0]);
});

test("the Pencil export snippet targets the sections and names folders by variant", () => {
  const snippet = pencilExport(["card", "alert"], "/tmp/ds-polish");
  assert.match(snippet, /const IDS=\["card","alert"\]/);
  assert.match(snippet, /DIR="\/tmp\/ds-polish"/);
  // The folder-naming function travels into Pencil and still runs there.
  const pn = new Function(
    `${snippet.match(/const pn=[\s\S]*?;const ck/)[0].slice(0, -";const ck".length)};return pn`,
  )();
  assert.equal(
    pn("disabled&variant=outline"),
    polishName("disabled&variant=outline"),
  );
});

test("missing ink is the share of drawn pixels Pencil leaves blank, give or take a pixel or two", () => {
  const blank = (w, h) => ({
    width: w,
    height: h,
    data: new Uint8Array(w * h * 4).fill(255),
  });
  const dot = (img, x) => img.data.fill(0, x * 4, x * 4 + 3);
  const shot = blank(12, 1);
  dot(shot, 1);
  dot(shot, 10);
  const pen = blank(12, 1);
  dot(pen, 2); // one pixel off the first: still drawn
  assert.equal(missingInk(shot, pen), 0.5);
  assert.equal(missingInk(blank(12, 1), pen), 0);
});

test("a payload page reads back through dsTake, and a garbled one fails", () => {
  const bodies = [
    `const D={"id":"a"};eval(dsApply);`,
    `const D={"id":"b"};eval(dsApply);`,
  ];
  const { html, snippet } = payloadPage(bodies);
  const texts = [...html.matchAll(/<pre[^>]*>([^<]*)<\/pre>/g)].map(
    (m) => m[1],
  );
  const take = (contents) => {
    const scope = {
      Get: (_id, visit) =>
        contents.forEach((content) => visit({ type: "text", content })),
      Delete: () => {},
      Print: () => {},
      dsLZ: "",
      LZString: lz,
      dsBuf: "",
      dsBody: "",
    };
    const whole = Number(snippet.match(/whole=(-?\d+)/)[1]);
    // dsLZ is the minified lz-string; LZString is in scope here instead.
    const body = `${TAKE.replace("eval(dsLZ);", "")}return dsBody;`;
    return new Function(...Object.keys(scope), "FRAME", "whole", body)(
      ...Object.values(scope),
      "frame",
      whole,
    );
  };
  // Pencil wraps long text: whitespace inside the blocks is ignored.
  const wrapped = texts.map((t) => t.replace(/(.{40})/g, "$1\n"));
  assert.equal(take(wrapped).split("\n").length, 2);
  assert.throws(() => take([texts.join("").slice(1)]), /garbled/);
});
