const live = new Map();

function fail(path, message) {
  return { ok: false, path, message: `${path}: ${message}` };
}

function tag(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  if (type === "number") return Number.isNaN(value) ? "NaN" : "number";
  return type;
}

function isContainer(value) {
  return value !== null && typeof value === "object";
}

function ownKeys(value) {
  if (Array.isArray(value)) {
    return Object.keys(value).map((key) =>
      /^(0|[1-9]\d*)$/.test(key) ? Number(key) : key,
    );
  }
  return Object.keys(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function joinPath(path, key) {
  if (typeof key === "number") return `${path}[${key}]`;
  return `${path}.${key}`;
}

function describe(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return "[Function]";
  if (typeof value === "symbol") return String(value);
  return String(value);
}

// Deep snapshot of the first read so later mutations cannot change a check.
// Holes stay holes and undefined values stay undefined; cycles are reported.
function snapshot(value, path, seen) {
  if (!isContainer(value)) return value;
  const back = seen.get(value);
  if (back !== undefined) {
    throw fail(path, `循环引用，绕回 ${back}`);
  }
  seen.set(value, path);
  let copy;
  if (Array.isArray(value)) {
    copy = new Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      if (hasOwn(value, index)) {
        copy[index] = snapshot(value[index], joinPath(path, index), seen);
      }
    }
  } else {
    copy = {};
    for (const key of ownKeys(value)) {
      copy[key] = snapshot(value[key], joinPath(path, key), seen);
    }
  }
  seen.delete(value);
  return copy;
}

function compare(actual, expected, path, seenActual, seenExpected) {
  const actualTag = tag(actual);
  const expectedTag = tag(expected);
  if (actualTag !== expectedTag) {
    return fail(path, `类型不一致（${actualTag} 对 ${expectedTag}）`);
  }
  if (!isContainer(actual)) {
    return Object.is(actual, expected)
      ? null
      : fail(path, `值不一致（${describe(actual)} 对 ${describe(expected)}）`);
  }

  const actualBack = seenActual.get(actual);
  if (actualBack !== undefined) return fail(path, `循环引用，绕回 ${actualBack}`);
  const expectedBack = seenExpected.get(expected);
  if (expectedBack !== undefined) return fail(path, `循环引用，绕回 ${expectedBack}`);
  seenActual.set(actual, path);
  seenExpected.set(expected, path);

  try {
    const keys = new Set(ownKeys(actual));
    for (const key of ownKeys(expected)) keys.add(key);

    for (const key of keys) {
      const keyPath = joinPath(path, key);
      if (!hasOwn(actual, key)) return fail(keyPath, "键缺失");
      if (!hasOwn(expected, key)) return fail(keyPath, "多出键");
      const result = compare(actual[key], expected[key], keyPath, seenActual, seenExpected);
      if (result) return result;
    }

    if (Array.isArray(actual) && actual.length !== expected.length) {
      return fail(path, `数组长度不一致（${actual.length} 对 ${expected.length}）`);
    }
    return null;
  } finally {
    seenActual.delete(actual);
    seenExpected.delete(expected);
  }
}

// Minimal JSON parser that tracks paths and rejects duplicated keys,
// because JSON.parse silently keeps the last value for a repeated key.
function parseExpected(text) {
  let index = 0;

  function error(message) {
    return new Error(`期望值不是合法 JSON（位置 ${index}）：${message}`);
  }

  function skipWhitespace() {
    while (index < text.length && " \t\n\r".includes(text[index])) index += 1;
  }

  function parseValue(path) {
    skipWhitespace();
    const char = text[index];
    if (char === "{") return parseObject(path);
    if (char === "[") return parseArray(path);
    if (char === '"') return parseString();
    if (char === "-" || (char >= "0" && char <= "9")) return parseNumber();
    if (text.startsWith("true", index)) {
      index += 4;
      return true;
    }
    if (text.startsWith("false", index)) {
      index += 5;
      return false;
    }
    if (text.startsWith("null", index)) {
      index += 4;
      return null;
    }
    throw error("无法识别的值");
  }

  function parseString() {
    index += 1;
    let result = "";
    while (index < text.length) {
      const char = text[index];
      if (char === '"') {
        index += 1;
        return result;
      }
      if (char === "\\") {
        index += 1;
        const escaped = text[index];
        const simple = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (simple[escaped] !== undefined) {
          result += simple[escaped];
          index += 1;
        } else if (escaped === "u") {
          const hex = text.slice(index + 1, index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw error("非法 unicode 转义");
          result += String.fromCharCode(parseInt(hex, 16));
          index += 5;
        } else {
          throw error("非法转义");
        }
      } else {
        result += char;
        index += 1;
      }
    }
    throw error("字符串没有结束");
  }

  function parseNumber() {
    const start = index;
    if (text[index] === "-") index += 1;
    while (index < text.length && /[0-9.eE+\-]/.test(text[index])) index += 1;
    const raw = text.slice(start, index);
    if (!/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(raw)) {
      throw error("非法数字");
    }
    return Number(raw);
  }

  function parseObject(path) {
    index += 1;
    const object = {};
    skipWhitespace();
    if (text[index] === "}") {
      index += 1;
      return object;
    }
    while (true) {
      skipWhitespace();
      if (text[index] !== '"') throw error("对象键必须是字符串");
      const key = parseString();
      skipWhitespace();
      if (text[index] !== ":") throw error("缺少冒号");
      index += 1;
      if (hasOwn(object, key)) {
        throw error(`键 ${JSON.stringify(key)} 在 ${joinPath(path, key)} 重复出现`);
      }
      object[key] = parseValue(joinPath(path, key));
      skipWhitespace();
      if (text[index] === ",") {
        index += 1;
        continue;
      }
      if (text[index] === "}") {
        index += 1;
        return object;
      }
      throw error("对象里缺少逗号或右花括号");
    }
  }

  function parseArray(path) {
    index += 1;
    const array = [];
    skipWhitespace();
    if (text[index] === "]") {
      index += 1;
      return array;
    }
    let slot = 0;
    while (true) {
      skipWhitespace();
      if (text[index] === ",") {
        slot += 1;
        index += 1;
        continue;
      }
      if (text[index] === "]") {
        index += 1;
        array.length = slot + 1;
        return array;
      }
      array[slot] = parseValue(joinPath(path, slot));
      slot += 1;
      skipWhitespace();
      if (text[index] === ",") {
        index += 1;
        continue;
      }
      if (text[index] === "]") {
        index += 1;
        return array;
      }
      throw error("数组里缺少逗号或右方括号");
    }
  }

  const value = parseValue("$");
  skipWhitespace();
  if (index !== text.length) throw error("值后面还有多余内容");
  return value;
}

export function check(id, actual, expectedText) {
  let frozen;
  try {
    frozen = snapshot(actual, "$", new Map());
  } catch (error) {
    if (error && error.ok === false) return error;
    throw error;
  }
  live.set(id, frozen);

  let expected;
  try {
    expected = parseExpected(expectedText);
  } catch (error) {
    return { ok: false, path: "$", message: error.message };
  }

  const result = compare(frozen, expected, "$", new Map(), new Map());
  return result ?? { ok: true };
}

export function mutate(id, next) {
  try {
    live.set(id, snapshot(next, "$", new Map()));
  } catch (error) {
    if (error && error.ok === false) {
      live.set(id, error);
      return;
    }
    throw error;
  }
}
