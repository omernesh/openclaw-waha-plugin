import { describe, it, expect, vi, afterEach } from "vitest";
import { formatActionError } from "../src/error-formatter.js";

describe("formatActionError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats 429/rate-limit error with retry suggestion", () => {
    const err = new Error("[WAHA] send rate limited (429 Too Many Requests) after 3 retries");
    const result = formatActionError(err, { action: "send", target: "120363@g.us" });
    expect(result).toContain("Failed to send 120363@g.us");
    expect(result.toLowerCase()).toContain("retry");
  });

  it("formats timeout error with try again suggestion", () => {
    const err = new Error("[WAHA] send timed out after 30000ms");
    const result = formatActionError(err, { action: "send", target: "120363@g.us" });
    expect(result).toContain("Failed to send 120363@g.us");
    expect(result.toLowerCase()).toContain("try again");
  });

  it("formats not-found error with search suggestion", () => {
    const err = new Error('Could not resolve "test group" to a WhatsApp JID. No matches found.');
    const result = formatActionError(err, { action: "send", target: "test group" });
    expect(result).toContain("Failed to send test group");
    expect(result.toLowerCase()).toContain("search");
  });

  it("formats 401/unauthorized error with do not retry", () => {
    const err = new Error("WAHA POST /api/sendText failed: 401 Unauthorized");
    const result = formatActionError(err, { action: "send", target: "120363@g.us" });
    expect(result).toContain("Failed to send 120363@g.us");
    expect(result.toLowerCase()).toContain("do not retry");
  });

  it("formats session unhealthy error with do not retry until reconnected", () => {
    const err = new Error("Session disconnected or unhealthy");
    const result = formatActionError(err, { action: "send", target: "120363@g.us" });
    expect(result).toContain("Failed to send 120363@g.us");
    expect(result.toLowerCase()).toContain("do not retry");
    expect(result.toLowerCase()).toContain("reconnect");
  });

  it("formats unknown error with generic suggestion", () => {
    const err = new Error("Something completely unexpected");
    const result = formatActionError(err, { action: "send", target: "120363@g.us" });
    expect(result).toContain("Failed to send 120363@g.us");
    expect(result.toLowerCase()).toContain("try again");
  });

  it("formats output as: Failed to [action] [target]: [error]. Try: [suggestion]", () => {
    const err = new Error("[WAHA] send rate limited (429)");
    const result = formatActionError(err, { action: "send", target: "120363@g.us" });
    // Should match the pattern: "Failed to <action> <target>: <msg>. Try: <suggestion>"
    expect(result).toMatch(/^Failed to send 120363@g\.us: .+\. Try: .+$/);
  });

  it("omits target from message when target is undefined", () => {
    const err = new Error("[WAHA] getGroups timed out after 30000ms");
    const result = formatActionError(err, { action: "getGroups" });
    expect(result).toMatch(/^Failed to getGroups: .+\. Try: .+$/);
    expect(result).not.toContain("undefined");
  });

  it("logs full original error with structured logger before formatting", () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const err = new Error("Some error");
    formatActionError(err, { action: "send", target: "test" });
    // Logger outputs structured JSON to stderr for warn level
    const output = stderrSpy.mock.calls.map((c) => String(c[0]));
    expect(output.some((msg) => msg.includes("send"))).toBe(true);
    stderrSpy.mockRestore();
  });
});
