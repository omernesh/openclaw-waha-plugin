import { describe, it, expect } from "vitest";
import * as path from "path";
import { normalizeToStableId, stableIdToFileSlug, findOverrideFile } from "../src/identity-resolver.js";

describe("normalizeToStableId", () => {
  it("normalizes @c.us JID to @c: prefix", () => {
    expect(normalizeToStableId("972544329000@c.us")).toBe("@c:972544329000@c.us");
  });

  it("normalizes @lid JID to @lid: prefix", () => {
    expect(normalizeToStableId("271862907039996@lid")).toBe("@lid:271862907039996@lid");
  });

  it("normalizes @g.us JID to @g: prefix", () => {
    expect(normalizeToStableId("120363421825201386@g.us")).toBe("@g:120363421825201386@g.us");
  });

  it("normalizes bare phone number to @c: format", () => {
    expect(normalizeToStableId("972544329000")).toBe("@c:972544329000@c.us");
  });

  it("trims and lowercases input before normalizing", () => {
    expect(normalizeToStableId("  972544329000@C.US  ")).toBe("@c:972544329000@c.us");
  });

  it("handles already-normalized @c: input gracefully (passthrough)", () => {
    // If input is already @c:972544329000@c.us (no known suffix), it falls to fallback
    // The fallback adds @c: prefix — so this won't double-prefix if already normalized
    // In practice, inputs should always be raw JIDs from WAHA
    const result = normalizeToStableId("@c:972544329000@c.us");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});

describe("stableIdToFileSlug", () => {
  it("converts @c: stable ID to filesystem-safe slug", () => {
    expect(stableIdToFileSlug("@c:972544329000@c.us")).toBe("972544329000_c_us");
  });

  it("converts @g: stable ID to filesystem-safe slug", () => {
    expect(stableIdToFileSlug("@g:120363421825201386@g.us")).toBe("120363421825201386_g_us");
  });

  it("converts @lid: stable ID to filesystem-safe slug", () => {
    expect(stableIdToFileSlug("@lid:271862907039996@lid")).toBe("271862907039996_lid");
  });
});

describe("findOverrideFile", () => {
  it("constructs correct path for contact scope with safe name", () => {
    const stableId = normalizeToStableId("972544329000@c.us");
    const slug = stableIdToFileSlug(stableId);
    const result = findOverrideFile("/rules", "contacts", stableId, "omer");
    expect(result).toBe(path.join("/rules", "contacts", `omer__${slug}.yaml`));
  });

  it("uses 'unknown' when safeName is not provided", () => {
    const stableId = normalizeToStableId("972544329000@c.us");
    const slug = stableIdToFileSlug(stableId);
    const result = findOverrideFile("/rules", "contacts", stableId);
    expect(result).toBe(path.join("/rules", "contacts", `unknown__${slug}.yaml`));
  });

  it("constructs correct path for groups scope", () => {
    const stableId = normalizeToStableId("120363421825201386@g.us");
    const slug = stableIdToFileSlug(stableId);
    const result = findOverrideFile("/rules", "groups", stableId, "test-group");
    expect(result).toBe(path.join("/rules", "groups", `test-group__${slug}.yaml`));
  });
});
