import assert from "node:assert/strict";
import { test } from "node:test";

import { INVENTORY, call, checkInventory, parseResult } from "./pen-sync.mjs";

test("a tool call is one shell line, whatever the snippet holds", () => {
  const args = { input: 'const D={"a":"x\ny"};Print(D.a)' };
  const line = call("execute", args);
  assert.ok(!line.includes("\n"));
  assert.match(line, /^execute\(\{.*\}\)$/);
  assert.deepEqual(JSON.parse(line.slice("execute(".length, -1)), args);
});

test("a headless reply: ok, the printed summary, and the collapsed-size notes", () => {
  const reply = parseResult(
    "\u001b[36mOK\u001b[39m\n\n## Print output\n{\"section\":\"Eiqne\"}\n\nScreenshots taken of nodes: Eiqne\n\n## issues detected:\n- Collapsed size: node 'a'\n- Collapsed size: node 'b'\n",
  );
  assert.equal(reply.ok, true);
  assert.equal(reply.printed.split("\n")[0], '{"section":"Eiqne"}');
  assert.equal(reply.collapsed, 2);
});

test("a reply from the app comes wrapped as JSON", () => {
  const reply = parseResult(
    JSON.stringify({ message: "OK\n\n## Print output\nstored 4497\n" }),
  );
  assert.equal(reply.ok, true);
  assert.equal(reply.printed, "stored 4497");
});

test("a failed call is not ok", () => {
  assert.equal(parseResult("Error: payload garbled").ok, false);
});

test("a check sorts components into missing, stale, orphaned and in sync", () => {
  const inventory = {
    button: { sections: 1, variants: ["", "size=sm"], hashes: ["h1"] },
    card: { sections: 1, variants: [""], hashes: ["old"] },
    gone: { sections: 1, variants: [""], hashes: ["x"] },
    badge: { sections: 2, variants: [""], hashes: ["h3"] },
  };
  const components = [
    { id: "button", file: "b" },
    { id: "card", file: "c" },
    { id: "badge", file: "d" },
    { id: "avatar", file: "a" },
  ];
  const hashes = { b: "h1", c: "h2", d: "h3", a: "h4" };
  const report = checkInventory(inventory, components, (c) => hashes[c.file]);
  assert.deepEqual(report.missing, ["avatar"]);
  assert.deepEqual(report.stale, ["card"]);
  assert.deepEqual(report.orphans, ["gone"]);
  assert.deepEqual(report.duplicated, ["badge"]);
  assert.deepEqual(report.ok, ["button", "badge"]);
});

test("the inventory snippet looks for the configured prefix", () => {
  const snippet = INVENTORY("acme-ds");
  assert.match(snippet, /m\.type==="acme-ds-section"/);
  assert.match(snippet, /m\.type==="acme-ds"\?/);
});
