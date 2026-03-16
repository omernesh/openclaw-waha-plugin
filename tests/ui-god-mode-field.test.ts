import { describe, it, expect } from "vitest";

// Exact copies of pure functions from src/monitor.ts script block (Phase 8, UI-03/UI-04).
// DO NOT CHANGE: tests must stay in sync with the embedded functions.

function toggleSelection(
  arr: Array<{ jid: string; displayName: string }>,
  item: { jid: string; displayName?: string }
): Array<{ jid: string; displayName: string }> {
  var idx = -1;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].jid === item.jid) { idx = i; break; }
  }
  var next = arr.slice();
  if (idx >= 0) {
    next.splice(idx, 1);
  } else {
    next.push({ jid: item.jid, displayName: item.displayName || item.jid });
  }
  return next;
}

function serializeGodModeUsers(
  selected: Array<{ jid: string; lid?: string | null }>
): Array<{ identifier: string }> {
  var result: Array<{ identifier: string }> = [];
  for (var i = 0; i < selected.length; i++) {
    result.push({ identifier: selected[i].jid });
    var lid = selected[i].lid;
    if (lid) result.push({ identifier: lid });
  }
  return result;
}

function deserializeGodModeUsers(
  configArr: Array<string | { identifier: string }> | null
): Array<{ jid: string; displayName: string; lid: string | null }> {
  if (!configArr || !configArr.length) return [];
  var result: Array<{ jid: string; displayName: string; lid: string | null }> = [];
  for (var i = 0; i < configArr.length; i++) {
    var id = typeof configArr[i] === "string"
      ? (configArr[i] as string)
      : ((configArr[i] as { identifier: string }).identifier || "");
    if (!id) continue;
    if (id.endsWith("@lid")) {
      // Find the last @c.us entry without a lid (immediately preceding this @lid)
      var found = false;
      for (var j = result.length - 1; j >= 0; j--) {
        if (!result[j].lid) { result[j].lid = id; found = true; break; }
      }
      if (!found) result.push({ jid: id, displayName: id, lid: null });
    } else {
      result.push({ jid: id, displayName: id, lid: null });
    }
  }
  return result;
}

// ---- toggleSelection tests ----

describe("toggleSelection", () => {
  it("adds item to empty array", () => {
    const result = toggleSelection([], { jid: "a@c.us", displayName: "Alice" });
    expect(result).toEqual([{ jid: "a@c.us", displayName: "Alice" }]);
  });

  it("adds item to existing array", () => {
    const arr = [{ jid: "a@c.us", displayName: "Alice" }];
    const result = toggleSelection(arr, { jid: "b@c.us", displayName: "Bob" });
    expect(result).toEqual([
      { jid: "a@c.us", displayName: "Alice" },
      { jid: "b@c.us", displayName: "Bob" },
    ]);
  });

  it("removes item if already present", () => {
    const arr = [{ jid: "a@c.us", displayName: "Alice" }];
    const result = toggleSelection(arr, { jid: "a@c.us" });
    expect(result).toEqual([]);
  });

  it("does not mutate original array", () => {
    const arr = [{ jid: "a@c.us", displayName: "Alice" }];
    const original = arr.slice();
    toggleSelection(arr, { jid: "b@c.us", displayName: "Bob" });
    expect(arr).toEqual(original);
  });

  it("uses jid as displayName fallback", () => {
    const result = toggleSelection([], { jid: "x@c.us" });
    expect(result).toEqual([{ jid: "x@c.us", displayName: "x@c.us" }]);
  });

  it("deduplicates by jid -- toggling same jid twice on empty array returns empty", () => {
    const step1 = toggleSelection([], { jid: "a@c.us", displayName: "Alice" });
    const step2 = toggleSelection(step1, { jid: "a@c.us", displayName: "Alice" });
    expect(step2).toEqual([]);
  });
});

// ---- serializeGodModeUsers tests ----

describe("serializeGodModeUsers", () => {
  it("returns empty array for empty input", () => {
    expect(serializeGodModeUsers([])).toEqual([]);
  });

  it("serializes single JID without lid", () => {
    expect(serializeGodModeUsers([{ jid: "972544329000@c.us", lid: null }])).toEqual([
      { identifier: "972544329000@c.us" },
    ]);
  });

  it("serializes JID with paired lid", () => {
    expect(
      serializeGodModeUsers([{ jid: "972544329000@c.us", lid: "271862907039996@lid" }])
    ).toEqual([
      { identifier: "972544329000@c.us" },
      { identifier: "271862907039996@lid" },
    ]);
  });

  it("serializes multiple contacts -- one with lid, one without", () => {
    const result = serializeGodModeUsers([
      { jid: "972544329000@c.us", lid: "271862907039996@lid" },
      { jid: "555000111@c.us", lid: null },
    ]);
    expect(result).toEqual([
      { identifier: "972544329000@c.us" },
      { identifier: "271862907039996@lid" },
      { identifier: "555000111@c.us" },
    ]);
  });

  it("omits lid when undefined", () => {
    expect(serializeGodModeUsers([{ jid: "x@c.us" }])).toEqual([
      { identifier: "x@c.us" },
    ]);
  });
});

// ---- deserializeGodModeUsers tests ----

describe("deserializeGodModeUsers", () => {
  it("returns empty for null", () => {
    expect(deserializeGodModeUsers(null)).toEqual([]);
  });

  it("returns empty for empty array", () => {
    expect(deserializeGodModeUsers([])).toEqual([]);
  });

  it("handles string format", () => {
    expect(deserializeGodModeUsers(["972544329000@c.us"])).toEqual([
      { jid: "972544329000@c.us", displayName: "972544329000@c.us", lid: null },
    ]);
  });

  it("handles object format", () => {
    expect(
      deserializeGodModeUsers([{ identifier: "972544329000@c.us" }])
    ).toEqual([
      { jid: "972544329000@c.us", displayName: "972544329000@c.us", lid: null },
    ]);
  });

  it("pairs @c.us with following @lid", () => {
    const result = deserializeGodModeUsers([
      { identifier: "972544329000@c.us" },
      { identifier: "271862907039996@lid" },
    ]);
    expect(result).toEqual([
      { jid: "972544329000@c.us", displayName: "972544329000@c.us", lid: "271862907039996@lid" },
    ]);
  });

  it("handles @lid without preceding @c.us", () => {
    const result = deserializeGodModeUsers([{ identifier: "271862907039996@lid" }]);
    expect(result).toEqual([
      { jid: "271862907039996@lid", displayName: "271862907039996@lid", lid: null },
    ]);
  });

  it("handles mixed contacts -- first with lid, second without", () => {
    const result = deserializeGodModeUsers([
      { identifier: "111@c.us" },
      { identifier: "aaa@lid" },
      { identifier: "222@c.us" },
    ]);
    expect(result).toEqual([
      { jid: "111@c.us", displayName: "111@c.us", lid: "aaa@lid" },
      { jid: "222@c.us", displayName: "222@c.us", lid: null },
    ]);
  });

  it("filters empty identifiers", () => {
    const result = deserializeGodModeUsers([
      { identifier: "" },
      { identifier: "x@c.us" },
    ]);
    expect(result).toEqual([
      { jid: "x@c.us", displayName: "x@c.us", lid: null },
    ]);
  });
});
