// 结构化核对：按路径、类型、值逐个对比，键顺序无关。
const live = new Map();

export function check(id, actual, expectedText) {
  const snap = snapshot(actual, "$", new Map());
  if (!snap.ok) {
    return { ok: false, message: snap.message };
  }
  live.set(id, snap.value);

  const parsed = parseExpected(expectedText);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  return compare(snap.value, parsed.value, "$");
}

export function mutate(id, next) {
  live.set(id, next);
}

// 深拷贝当前值，之后原对象被改也不影响这次读到的结果。
// 只取对象自己的可枚举键，原型上继承来的不算。
function snapshot(value, path, ancestors) {
  if (value === null || typeof value !== "object") {
    return { ok: true, value };
  }
  const seenAt = ancestors.get(value);
  if (seenAt !== undefined) {
    return { ok: false, message: `循环引用: 路径 ${path} 绕回 ${seenAt}` };
  }
  ancestors.set(value, path);
  let copy;
  if (Array.isArray(value)) {
    copy = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) continue; // 保留数组空洞
      const r = snapshot(value[i], `${path}[${i}]`, ancestors);
      if (!r.ok) return r;
      copy[i] = r.value;
    }
  } else {
    copy = {};
    for (const key of Object.keys(value)) {
      const r = snapshot(value[key], `${path}.${key}`, ancestors);
      if (!r.ok) return r;
      copy[key] = r.value;
    }
  }
  ancestors.delete(value);
  return { ok: true, value: copy };
}

// 解析期望文本，同一个键写两次要单独报出来。
function parseExpected(text) {
  const s = String(text);
  let pos = 0;

  const skipWs = () => {
    while (pos < s.length && (s[pos] === " " || s[pos] === "\t" || s[pos] === "\n" || s[pos] === "\r")) pos++;
  };
  const fail = (msg) => {
    throw new Error(`${msg}（位置 ${pos}）`);
  };
  const expectWord = (word) => {
    if (!s.startsWith(word, pos)) fail(`期望文本不是合法 JSON`);
    pos += word.length;
  };

  function parseString() {
    if (s[pos] !== '"') fail("期望文本不是合法 JSON");
    pos++;
    let out = "";
    while (pos < s.length && s[pos] !== '"') {
      if (s[pos] === "\\") {
        const esc = s[pos + 1];
        if (esc === "u") {
          out += String.fromCharCode(parseInt(s.slice(pos + 2, pos + 6), 16));
          pos += 6;
        } else {
          const map = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
          if (!(esc in map)) fail("非法转义");
          out += map[esc];
          pos += 2;
        }
      } else {
        out += s[pos];
        pos++;
      }
    }
    if (pos >= s.length) fail("字符串没收尾");
    pos++;
    return out;
  }

  function parseNumber() {
    const m = /-?\d+(\.\d+)?([eE][+-]?\d+)?/y;
    m.lastIndex = pos;
    const hit = m.exec(s);
    if (!hit) fail("期望文本不是合法 JSON");
    pos = m.lastIndex;
    return Number(hit[0]);
  }

  function parseArray(path) {
    pos++;
    const arr = [];
    skipWs();
    if (s[pos] === "]") {
      pos++;
      return arr;
    }
    for (;;) {
      arr.push(parseValue(`${path}[${arr.length}]`));
      skipWs();
      if (s[pos] === ",") {
        pos++;
        continue;
      }
      if (s[pos] === "]") {
        pos++;
        return arr;
      }
      fail("数组没收尾");
    }
  }

  function parseObject(path) {
    pos++;
    const obj = {};
    skipWs();
    if (s[pos] === "}") {
      pos++;
      return obj;
    }
    for (;;) {
      skipWs();
      const key = parseString();
      skipWs();
      if (s[pos] !== ":") fail("键后面缺冒号");
      pos++;
      const value = parseValue(`${path}.${key}`);
      if (Object.hasOwn(obj, key)) {
        throw new Error(`键 ${path}.${key} 同名写了两次`);
      }
      obj[key] = value;
      skipWs();
      if (s[pos] === ",") {
        pos++;
        continue;
      }
      if (s[pos] === "}") {
        pos++;
        return obj;
      }
      fail("对象没收尾");
    }
  }

  function parseValue(path) {
    skipWs();
    const ch = s[pos];
    if (ch === "{") return parseObject(path);
    if (ch === "[") return parseArray(path);
    if (ch === '"') return parseString();
    if (ch === "t") {
      expectWord("true");
      return true;
    }
    if (ch === "f") {
      expectWord("false");
      return false;
    }
    if (ch === "n") {
      expectWord("null");
      return null;
    }
    return parseNumber();
  }

  try {
    const value = parseValue("$");
    skipWs();
    if (pos !== s.length) fail("末尾有多余内容");
    return { ok: true, value };
  } catch (e) {
    return { ok: false, message: `期望文本有问题: ${e.message}` };
  }
}

function typeName(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "数组";
  return typeof v;
}

function compare(actual, expected, path) {
  const ta = typeName(actual);
  const te = typeName(expected);
  if (ta !== te) {
    return { ok: false, message: `路径 ${path}: 类型对不上，实际 ${ta}，期望 ${te}` };
  }
  if (ta === "数组") {
    if (actual.length !== expected.length) {
      return { ok: false, message: `路径 ${path}: 数组长度不一样，实际 ${actual.length}，期望 ${expected.length}` };
    }
    for (let i = 0; i < expected.length; i++) {
      if (!(i in actual)) {
        return { ok: false, message: `路径 ${path}[${i}]: 数组有空洞，期望 ${JSON.stringify(expected[i])}` };
      }
      const r = compare(actual[i], expected[i], `${path}[${i}]`);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (ta === "object") {
    for (const key of Object.keys(expected)) {
      if (!Object.hasOwn(actual, key)) {
        return { ok: false, message: `路径 ${path}.${key}: 键缺失（期望里这个键有值，不是空）` };
      }
    }
    for (const key of Object.keys(actual)) {
      if (!Object.hasOwn(expected, key)) {
        return { ok: false, message: `路径 ${path}.${key}: 多出来的键，期望里没有` };
      }
    }
    for (const key of Object.keys(expected)) {
      const r = compare(actual[key], expected[key], `${path}.${key}`);
      if (!r.ok) return r;
    }
    return { ok: true };
  }
  if (!Object.is(actual, expected)) {
    return { ok: false, message: `路径 ${path}: 值不一样，实际 ${JSON.stringify(actual)}，期望 ${JSON.stringify(expected)}` };
  }
  return { ok: true };
}
