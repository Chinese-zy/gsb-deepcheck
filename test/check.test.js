import test from "node:test";
import assert from "node:assert/strict";
import { check, mutate } from "../check.js";

test("key order change is not failure", () => {
  const r = check("o1", { a: 1, b: 2 }, JSON.stringify({ b: 2, a: 1 }));
  assert.equal(r.ok, true);
});

test("number vs numeric string differs", () => {
  const r = check("o2", { a: 1 }, JSON.stringify({ a: "1" }));
  assert.equal(r.ok, false);
  assert.match(r.message, /a/);
});

test("freeze first read", () => {
  const obj = { a: 1 };
  const r1 = check("o3", obj, JSON.stringify({ a: 1 }));
  mutate("o3", { a: 9 });
  const r2 = check("o3", obj, JSON.stringify({ a: 1 }));
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
});
