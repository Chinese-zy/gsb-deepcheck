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
  assert.equal(r.path, "$.a");
  assert.match(r.message, /类型不一致/);
});

test("freeze first read", () => {
  const obj = { a: 1 };
  const r1 = check("o3", obj, JSON.stringify({ a: 1 }));
  mutate("o3", { a: 9 });
  const r2 = check("o3", obj, JSON.stringify({ a: 1 }));
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
});

test("mutation halfway through comparing does not change the read", () => {
  const obj = { a: 1, nested: { b: 2 } };
  const r = check("o4", obj, JSON.stringify({ a: 1, nested: { b: 2 } }));
  obj.nested.b = 99;
  obj.c = 3;
  assert.equal(r.ok, true);
});

test("empty object matches empty object", () => {
  assert.equal(check("o5", {}, "{}").ok, true);
});

test("empty object differs from non-empty object with path", () => {
  const r = check("o6", {}, '{"a":1}');
  assert.equal(r.ok, false);
  assert.equal(r.path, "$.a");
  assert.match(r.message, /键缺失/);
});

test("duplicated key in expected text is rejected with path", () => {
  const r = check("o7", { a: 1, b: 2 }, '{"a":1,"a":2,"b":2}');
  assert.equal(r.ok, false);
  assert.match(r.message, /重复出现/);
  assert.match(r.message, /\$\.a/);
});

test("deeply nested mismatch reports the full path", () => {
  const actual = { level1: { level2: { level3: 5 } } };
  const r = check("o8", actual, JSON.stringify({ level1: { level2: { level3: "5" } } }));
  assert.equal(r.ok, false);
  assert.equal(r.path, "$.level1.level2.level3");
});

test("array hole differs from a present value", () => {
  const actual = [1, , 3];
  const r = check("o9", actual, "[1,2,3]");
  assert.equal(r.ok, false);
  assert.equal(r.path, "$[1]");
  assert.match(r.message, /键缺失/);
});

test("array hole matches a trailing-comma hole in JSON", () => {
  const actual = [1, , 3];
  assert.equal(check("o10", actual, "[1,,3]").ok, true);
});

test("null value differs from missing key", () => {
  const missing = {};
  const r1 = check("o11", missing, '{"a":null}');
  assert.equal(r1.ok, false);
  assert.equal(r1.path, "$.a");
  assert.match(r1.message, /键缺失/);

  const hasNull = { a: null };
  assert.equal(check("o12", hasNull, '{"a":null}').ok, true);
});

test("undefined value differs from missing key", () => {
  const r = check("o13", { a: undefined }, "{}");
  assert.equal(r.ok, false);
  assert.equal(r.path, "$.a");
  assert.match(r.message, /多出键/);
});

test("circular reference reports the looping path", () => {
  const actual = { a: { b: {} } };
  actual.a.b.back = actual;
  const r = check("o14", actual, '{"a":{"b":{"back":null}}}');
  assert.equal(r.ok, false);
  assert.equal(r.path, "$.a.b.back");
  assert.match(r.message, /循环引用/);
  assert.match(r.message, /\$/);
});

test("shared but non-circular structure does not fail", () => {
  const leaf = { x: 1 };
  const actual = { a: leaf, b: leaf };
  const r = check("o15", actual, JSON.stringify({ a: { x: 1 }, b: { x: 1 } }));
  assert.equal(r.ok, true);
});

test("inherited prototype keys are not counted as own keys", () => {
  const proto = { inherited: 1 };
  const actual = Object.create(proto);
  actual.own = 2;
  const r = check("o16", actual, JSON.stringify({ own: 2 }));
  assert.equal(r.ok, true);
});

test("extra array element reports the element path", () => {
  const r = check("o17", [1, 2, 3], "[1,2]");
  assert.equal(r.ok, false);
  assert.equal(r.path, "$[2]");
  assert.match(r.message, /多出键/);
});

test("hole-only arrays with different lengths report the array path", () => {
  const r = check("o17b", new Array(3), "[null,null]");
  assert.equal(r.ok, false);
  assert.equal(r.path, "$[0]");
  assert.match(r.message, /键缺失/);
});

test("mutate stores a snapshot for the next check record", () => {
  const next = { nested: { a: 1 } };
  check("o18", { a: 1 }, JSON.stringify({ a: 1 }));
  mutate("o18", next);
  next.nested.a = 9;
  const r = check("o18", { a: 1 }, JSON.stringify({ a: 1 }));
  assert.equal(r.ok, true);
});
