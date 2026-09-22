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

test("later mutation counts as a new check", () => {
  const obj = { a: 1 };
  const r1 = check("o4", obj, JSON.stringify({ a: 1 }));
  obj.a = 9;
  const r2 = check("o4", obj, JSON.stringify({ a: 9 }));
  const r3 = check("o4", obj, JSON.stringify({ a: 1 }));
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r3.ok, false);
});

test("empty object matches empty object", () => {
  const r = check("o5", {}, JSON.stringify({}));
  assert.equal(r.ok, true);
});

test("empty object vs missing key differ", () => {
  const r = check("o6", {}, JSON.stringify({ a: 1 }));
  assert.equal(r.ok, false);
  assert.match(r.message, /a/);
});

test("duplicate key in expected text is reported", () => {
  const r = check("o7", { a: 1 }, '{"a":1,"a":2}');
  assert.equal(r.ok, false);
  assert.match(r.message, /a/);
  assert.match(r.message, /两次/);
});

test("deep nesting compares by path", () => {
  const depth = 500;
  let actual = {};
  let expected = {};
  let pa = actual;
  let pe = expected;
  for (let i = 0; i < depth; i++) {
    pa.next = {};
    pe.next = {};
    pa = pa.next;
    pe = pe.next;
  }
  pa.leaf = 1;
  pe.leaf = 2;
  const ok = check("o8", actual, JSON.stringify(actual));
  assert.equal(ok.ok, true);
  const bad = check("o8", actual, JSON.stringify(expected));
  assert.equal(bad.ok, false);
  assert.match(bad.message, /leaf/);
});

test("array hole is not null", () => {
  const sparse = [1, , 3];
  const r = check("o9", sparse, JSON.stringify([1, null, 3]));
  assert.equal(r.ok, false);
  assert.match(r.message, /\[1\]/);
  assert.match(r.message, /空洞/);
});

test("null value is not missing key", () => {
  const missing = check("o10", {}, JSON.stringify({ a: null }));
  assert.equal(missing.ok, false);
  assert.match(missing.message, /键缺失/);
  const hasNull = check("o10", { a: null }, JSON.stringify({ a: null }));
  assert.equal(hasNull.ok, true);
  const extra = check("o10", { a: null }, JSON.stringify({}));
  assert.equal(extra.ok, false);
  assert.match(extra.message, /多出来的键/);
});

test("cycle reports the looping path", () => {
  const root = { a: { b: {} } };
  root.a.b.back = root.a;
  const r = check("o11", root, JSON.stringify({ a: { b: { back: null } } }));
  assert.equal(r.ok, false);
  assert.match(r.message, /循环引用/);
  assert.match(r.message, /\$\.a\.b\.back/);
  assert.match(r.message, /\$\.a/);
});

test("inherited keys are ignored", () => {
  const obj = Object.create({ inherited: 1 });
  obj.own = 2;
  const r = check("o12", obj, JSON.stringify({ own: 2 }));
  assert.equal(r.ok, true);
});

test("failure message carries the nested path", () => {
  const actual = { outer: { inner: { leaf: 1 } } };
  const expected = { outer: { inner: { leaf: 2 } } };
  const r = check("o13", actual, JSON.stringify(expected));
  assert.equal(r.ok, false);
  assert.match(r.message, /\$\.outer\.inner\.leaf/);
});
