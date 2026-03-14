/**
 * send-utils.test.ts
 * Tests for Phase 5 Plan 01: fuzzyScore and toArr utilities in send.ts.
 *
 * Covers:
 *  - fuzzyScore: scoring logic for all match tiers
 *  - toArr: wrapping/passthrough behavior for arrays and objects
 */

import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock send.ts's heavy dependencies so the module loads in tests
// ---------------------------------------------------------------------------

vi.mock("openclaw/plugin-sdk", () => ({
  detectMime: vi.fn(),
  sendMediaWithLeadingCaption: vi.fn(),
  DEFAULT_ACCOUNT_ID: "default",
}));

vi.mock("../src/accounts.js", () => ({
  listEnabledWahaAccounts: vi.fn(),
  resolveWahaAccount: vi.fn(),
}));

vi.mock("../src/normalize.js", () => ({
  normalizeWahaMessagingTarget: vi.fn((t: string) => t),
}));

vi.mock("../src/http-client.js", () => ({
  callWahaApi: vi.fn(),
  warnOnError: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import module under test (after mocks)
// ---------------------------------------------------------------------------

import { fuzzyScore, toArr } from "../src/send.js";

// ---------------------------------------------------------------------------
// fuzzyScore tests
// The scoring tiers (highest priority wins):
//   1.0 — exact match (case-insensitive)
//   0.9 — name starts with query
//   0.85 — query starts with name
//   0.8  — all query words found in name
//   0.7  — full query is substring of name (but word-level splits don't all match)
//   0.5  — any query word found in name
//   0.1  — empty query (list-all mode)
//   0    — no match
// ---------------------------------------------------------------------------

describe("fuzzyScore", () => {
  it("returns 1.0 for exact match (case-insensitive)", () => {
    expect(fuzzyScore("alpha test group", "Alpha Test Group")).toBe(1.0);
    expect(fuzzyScore("hello", "hello")).toBe(1.0);
  });

  it("returns 0.9 when name starts with query", () => {
    expect(fuzzyScore("alpha", "alpha test group")).toBe(0.9);
    expect(fuzzyScore("work", "work channel")).toBe(0.9);
  });

  it("returns 0.85 when query starts with name (name is prefix of query)", () => {
    expect(fuzzyScore("alpha test group and more", "alpha test group")).toBe(0.85);
  });

  it("returns 0.8 when all query words are found in the name (but not exact or prefix)", () => {
    // "test group" is found in "alpha test group" but "alpha test group".startsWith("test group") = false
    // both "test" and "group" are present → 0.8
    expect(fuzzyScore("test group", "alpha test group")).toBe(0.8);
  });

  // NOTE: The 0.7 tier (n.includes(q)) is unreachable in practice. If the full query
  // string is a substring of the name, then every individual word of the query is also
  // a substring of the name, so the 0.8 "all words found" check always fires first.
  // No test added because no input can reach this code path.

  it("returns 0.5 when any query word is found but not all words match", () => {
    // "alice work" — "alice" IS in "alice personal chat" but "work" is NOT
    // anyFound = true (alice) → 0.5
    expect(fuzzyScore("alice work", "alice personal chat")).toBe(0.5);
  });

  it("returns 0.1 for empty query (list-all mode)", () => {
    expect(fuzzyScore("", "any name here")).toBe(0.1);
    expect(fuzzyScore("  ", "some name")).toBe(0.1);
  });

  it("returns 0 for no match", () => {
    expect(fuzzyScore("xyz123", "completely unrelated name")).toBe(0);
    expect(fuzzyScore("zzz", "aaa bbb ccc")).toBe(0);
  });

  it("returns 0 when name is empty", () => {
    expect(fuzzyScore("anything", "")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// toArr tests
// toArr wraps values for iteration: passes arrays through, converts objects
// to their values array, returns [] for primitives and null/undefined.
// ---------------------------------------------------------------------------

describe("toArr", () => {
  it("passes an existing array through unchanged (same reference)", () => {
    const arr = ["a", "b", "c"];
    expect(toArr(arr)).toBe(arr); // same reference is intentional contract
  });

  it("returns Object.values when given a plain object", () => {
    const obj = { key1: "val1", key2: "val2" };
    expect(toArr(obj)).toEqual(["val1", "val2"]);
  });

  it("returns empty array for null", () => {
    expect(toArr(null)).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(toArr(undefined)).toEqual([]);
  });

  it("returns empty array for a string (primitives are not wrapped)", () => {
    expect(toArr("hello")).toEqual([]);
  });

  it("returns empty array for a number (primitives are not wrapped)", () => {
    expect(toArr(42)).toEqual([]);
  });

  it("returns empty array for empty object", () => {
    expect(toArr({})).toEqual([]);
  });

  it("returns Object.values for JID-keyed dict (WAHA API pattern)", () => {
    const dict = { "972@c.us": { name: "Omer" }, "120@g.us": { name: "Group" } };
    expect(toArr(dict)).toEqual([{ name: "Omer" }, { name: "Group" }]);
  });
});
