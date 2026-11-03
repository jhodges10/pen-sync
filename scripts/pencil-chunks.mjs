/**
 * Gets `--pencil-data` exports into Pencil without copying them through a
 * tool call: the payload is served as text on a page, Pencil's browser imports
 * that page onto the canvas, and `dsTake` reads it back, checks its hash and
 * decompresses it into `dsBody`, one line per component.
 *
 *   node $DS/pencil-chunks.mjs --setup > setup.txt      # once per Pencil session
 *   node $DS/pencil-chunks.mjs --page out.html a.js b.js  # prints the take snippet
 *
 * Send `setup.txt` once with `execute` (stores the LZ decompressor `dsLZ` and
 * `dsTake`; also send `export-matrix.mjs --pencil-apply` once for `dsApply`).
 * Then per batch: Pencil `browser` load-page `file://…/out.html`, then
 * import-to-canvas with querySelector `#pen-sync-payload`; it reports a frame id.
 * Send the printed snippet with that id; it deletes the imported frame. Apply
 * the components a few at a time (Pencil interrupts long calls):
 *
 *   for (const part of dsBody.split("\n").slice(0, 3)) eval(part);
 *
 * Without the browser, `pencil-chunks.mjs <out dir> <data.js…>` writes the
 * payload as hash-checked chunks to send one by one instead.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { repo } from "./config.mjs";
import { isMain } from "./main.mjs";

// lz-string comes from the repo's own dependencies; the plugin ships no node_modules.
const require = createRequire(join(repo, "package.json"));
const lz = require("lz-string");

/** The 32-bit string hash each chunk checks itself against. */
export const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
};
const HASH = `const H=(s)=>{let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return h};`;

/** Short enough to copy into an `execute` call without slips. */
export const CHUNK = 2500;

/** The export bodies, one block per line, compressed for transfer. */
const compressed = (bodies) =>
  lz.compressToBase64(
    bodies.map((b) => `{const TakeScreenshot=()=>{};${b.trim()}}`).join("\n"),
  );

/** Text one `<pre>` holds; Pencil's import times out on one huge text. */
export const PAGE_BLOCK = 4000;

/**
 * Reads the imported payload frame `FRAME` back, checks it against `whole`,
 * decompresses it into `dsBody` and deletes the frame. Stored by --setup.
 */
export const TAKE = `{const t=[];Get(FRAME,(n)=>{if(n.type==="text")t.push(n.content);return undefined});const s=t.join("").replace(/\\s+/g,"");let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;Delete(FRAME);if(h!==whole)throw new Error("payload garbled: "+s.length+" chars");dsBuf=s;eval(dsLZ);dsBody=LZString.decompressFromBase64(s);Print(dsBody.split("\\n").length,"components stored")}`;

/** A page serving the payload as text, and the snippet that takes it. */
export function payloadPage(bodies) {
  const z = compressed(bodies);
  const blocks = Array.from(
    { length: Math.ceil(z.length / PAGE_BLOCK) },
    (_, i) => z.slice(i * PAGE_BLOCK, (i + 1) * PAGE_BLOCK),
  );
  const html = `<!doctype html><meta charset="utf-8"><div id="pen-sync-payload">${blocks
    .map(
      (b) =>
        `<pre style="white-space:pre-wrap;word-break:break-all;width:600px;margin:0">${b}</pre>`,
    )
    .join("")}</div>`;
  return {
    html,
    snippet: `const FRAME="<imported frame id>",whole=${hash(z)};eval(dsTake)`,
  };
}

/** The chunk snippets and the store snippet for these export bodies. */
export function chunks(bodies, size = CHUNK) {
  const z = compressed(bodies);
  const n = Math.ceil(z.length / size);
  const parts = Array.from({ length: n }, (_, i) => {
    const part = z.slice(i * size, (i + 1) * size);
    return `${HASH}const p="${part}";if(H(p)!==${hash(part)})throw new Error("chunk ${i + 1} garbled");dsBuf=${i === 0 ? "p" : "dsBuf+p"};Print("chunk ${i + 1}/${n}",dsBuf.length);`;
  });
  const store = `${HASH}if(H(dsBuf)!==${hash(z)})throw new Error("buffer incomplete: resend the chunks");eval(dsLZ);dsBody=LZString.decompressFromBase64(dsBuf);Print(dsBody.split("\\n").length,"components stored");`;
  return { parts, store };
}

if (isMain(import.meta.url)) {
  const [out, ...files] = process.argv.slice(2);
  if (out === "--setup") {
    const min = readFileSync(
      require.resolve("lz-string/libs/lz-string.min.js"),
      "utf8",
    );
    console.log(
      `dsLZ=${JSON.stringify(min)};dsTake=${JSON.stringify(TAKE)};Print("stored",dsLZ.length);`,
    );
  } else if (out === "--page") {
    const [page, ...bodies] = files;
    if (!page || !bodies.length)
      throw new Error("usage: pencil-chunks.mjs --page <out.html> <data.js…>");
    const { html, snippet } = payloadPage(
      bodies.map((f) => readFileSync(f, "utf8")),
    );
    mkdirSync(dirname(page), { recursive: true });
    writeFileSync(page, html);
    console.error(`payload page → ${page}`);
    console.log(snippet);
  } else {
    if (!out || !files.length)
      throw new Error(
        "usage: pencil-chunks.mjs <out dir> <data.js…> | --setup",
      );
    mkdirSync(out, { recursive: true });
    const { parts, store } = chunks(files.map((f) => readFileSync(f, "utf8")));
    parts.forEach((p, i) =>
      writeFileSync(join(out, `${String(i).padStart(2, "0")}.txt`), p),
    );
    writeFileSync(join(out, "store.txt"), store);
    console.error(`${parts.length} chunks + store.txt → ${out}`);
  }
}
