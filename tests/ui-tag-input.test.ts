import { describe, it, expect } from "vitest";

// Pure logic: normalize raw input into trimmed non-empty tag array.
// This is an exact copy of normalizeTags() from src/monitor.ts script block (Phase 8, UI-02).
// DO NOT CHANGE: test must stay in sync with the embedded function.
function normalizeTags(input: string | null | undefined): string[] {
  if (!input || typeof input !== "string") return [];
  return input
    .split(/[,\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

describe("normalizeTags", () => {
  it("returns empty array for null", () => {
    expect(normalizeTags(null)).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(normalizeTags(undefined)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(normalizeTags("")).toEqual([]);
  });

  it("splits on commas", () => {
    expect(normalizeTags("a@c.us,b@c.us")).toEqual(["a@c.us", "b@c.us"]);
  });

  it("splits on newlines", () => {
    expect(normalizeTags("a@c.us\nb@c.us")).toEqual(["a@c.us", "b@c.us"]);
  });

  it("trims whitespace around tags", () => {
    expect(normalizeTags(" a@c.us , b@c.us ")).toEqual(["a@c.us", "b@c.us"]);
  });

  it("filters empty from consecutive delimiters", () => {
    expect(normalizeTags("a@c.us,,b@c.us")).toEqual(["a@c.us", "b@c.us"]);
  });

  it("handles single value", () => {
    expect(normalizeTags("972544329000@c.us")).toEqual(["972544329000@c.us"]);
  });

  it("handles mixed delimiters", () => {
    expect(normalizeTags("a@c.us,b@c.us\nc@c.us")).toEqual([
      "a@c.us",
      "b@c.us",
      "c@c.us",
    ]);
  });

  it("preserves @lid JIDs", () => {
    expect(normalizeTags("271862907039996@lid")).toEqual([
      "271862907039996@lid",
    ]);
  });

  it("handles group JIDs", () => {
    expect(normalizeTags("120363421825201386@g.us")).toEqual([
      "120363421825201386@g.us",
    ]);
  });
});
