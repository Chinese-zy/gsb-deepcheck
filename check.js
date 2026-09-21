// BUG: stringify whole object; order-sensitive; no freeze; no path errors; no cycle handling.
const live = new Map();

export function check(id, actual, expectedText) {
  live.set(id, actual);
  const left = JSON.stringify(live.get(id));
  const right = expectedText;
  if (left !== right) {
    return { ok: false, message: "整段不一样" };
  }
  return { ok: true };
}

export function mutate(id, next) {
  live.set(id, next);
}
