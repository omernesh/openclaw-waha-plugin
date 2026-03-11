import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// We test handleSendMulti via the exported wahaPlugin.actions.handleAction
// by calling the "sendMulti" action. This exercises registration + handler.

// Mock send.ts — sendWahaText and resolveWahaTarget
vi.mock("../src/send.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    sendWahaText: vi.fn().mockResolvedValue({ key: { id: "msg123" } }),
    resolveWahaTarget: vi.fn().mockResolvedValue({
      matches: [{ jid: "resolved@c.us", name: "Resolved", confidence: 0.95 }],
    }),
  };
});

// Mock other imports that channel.ts needs
vi.mock("../src/monitor.js", () => ({ monitorWahaProvider: vi.fn() }));
vi.mock("../src/runtime.js", () => ({
  getWahaRuntime: vi.fn(() => ({
    config: { readConfigFileSnapshot: () => ({}) },
    channel: { text: { chunkMarkdownText: (t: string, l: number) => [t] } },
  })),
}));
vi.mock("../src/accounts.js", () => ({
  listWahaAccountIds: vi.fn(() => []),
  resolveDefaultWahaAccountId: vi.fn(() => "default"),
  resolveWahaAccount: vi.fn(() => ({ accountId: "default", config: {} })),
}));
vi.mock("../src/normalize.js", () => ({
  normalizeWahaAllowEntry: vi.fn((e: string) => e),
  normalizeWahaMessagingTarget: vi.fn((t: string) => t),
}));
vi.mock("../src/config-schema.js", () => ({
  WahaConfigSchema: {},
}));
vi.mock("../src/http-client.js", () => ({
  configureReliability: vi.fn(),
}));
vi.mock("../src/error-formatter.js", () => ({
  formatActionError: vi.fn((err: Error) => `Error: ${err.message}`),
}));
vi.mock("openclaw/plugin-sdk", () => ({
  buildBaseChannelStatusSummary: vi.fn(),
  buildChannelConfigSchema: vi.fn(() => ({})),
  createDefaultChannelRuntimeState: vi.fn(() => ({})),
  DEFAULT_ACCOUNT_ID: "default",
  deleteAccountFromConfigSection: vi.fn(),
  formatPairingApproveHint: vi.fn(),
  resolveDefaultGroupPolicy: vi.fn(),
  setAccountEnabledInConfigSection: vi.fn(),
  waitUntilAbort: vi.fn(),
}));

import { wahaPlugin } from "../src/channel.js";
import { sendWahaText, resolveWahaTarget } from "../src/send.js";

const mockSendText = sendWahaText as ReturnType<typeof vi.fn>;
const mockResolveTarget = resolveWahaTarget as ReturnType<typeof vi.fn>;

const fakeCfg = { channels: { waha: { baseUrl: "http://localhost:3004", apiKey: "test", session: "test" } } } as any;

async function callSendMulti(params: Record<string, unknown>) {
  return wahaPlugin.actions.handleAction({
    action: "sendMulti",
    params,
    cfg: fakeCfg,
    accountId: "default",
    toolContext: {},
  });
}

describe("sendMulti utility action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: resolve each recipient to a unique JID
    mockResolveTarget.mockImplementation(async ({ query }: { query: string }) => ({
      matches: [{ jid: `${query.replace(/\s/g, "")}@c.us`, name: query, confidence: 0.95 }],
    }));
    mockSendText.mockResolvedValue({ key: { id: "msg123" } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends to all recipients sequentially", async () => {
    const result = await callSendMulti({
      recipients: ["Alice", "Bob", "Charlie"],
      text: "Hello everyone!",
    });

    // Should not be an error
    expect((result as any).isError).toBeFalsy();

    // Parse the JSON result
    const content = JSON.parse((result as any).content[0].text);
    expect(content.sent).toBe(3);
    expect(content.failed).toBe(0);
    expect(content.results).toHaveLength(3);
    expect(content.results[0].status).toBe("sent");
    expect(content.results[1].status).toBe("sent");
    expect(content.results[2].status).toBe("sent");

    // Verify sendWahaText was called 3 times
    expect(mockSendText).toHaveBeenCalledTimes(3);
  });

  it("resolves names via autoResolveTarget before sending", async () => {
    await callSendMulti({
      recipients: ["Family Group"],
      text: "Hello!",
    });

    // resolveWahaTarget should have been called (autoResolveTarget calls it)
    expect(mockResolveTarget).toHaveBeenCalled();
    // sendWahaText should receive the resolved JID, not the raw name
    expect(mockSendText).toHaveBeenCalledWith(
      expect.objectContaining({ to: "FamilyGroup@c.us" }),
    );
  });

  it("caps at 10 recipients", async () => {
    const recipients = Array.from({ length: 11 }, (_, i) => `User${i}`);
    const result = await callSendMulti({ recipients, text: "Too many" });

    // Should return an error
    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text).toContain("10");
  });

  it("no fail-fast: continues when one recipient fails", async () => {
    // Make the second call fail
    let callCount = 0;
    mockSendText.mockImplementation(async () => {
      callCount++;
      if (callCount === 2) throw new Error("Send failed for Bob");
      return { key: { id: `msg${callCount}` } };
    });

    const result = await callSendMulti({
      recipients: ["Alice", "Bob", "Charlie"],
      text: "Hello!",
    });

    const content = JSON.parse((result as any).content[0].text);
    expect(content.sent).toBe(2);
    expect(content.failed).toBe(1);
    expect(content.results).toHaveLength(3);
    expect(content.results[0].status).toBe("sent");
    expect(content.results[1].status).toBe("failed");
    expect(content.results[1].error).toContain("Send failed for Bob");
    expect(content.results[2].status).toBe("sent");

    // Verify all 3 sends were attempted
    expect(mockSendText).toHaveBeenCalledTimes(3);
  });

  it("returns per-recipient results with status and error detail", async () => {
    mockSendText
      .mockResolvedValueOnce({ key: { id: "ok1" } })
      .mockRejectedValueOnce(new Error("Network error"));

    const result = await callSendMulti({
      recipients: ["Alice", "Bob"],
      text: "Hi",
    });

    const content = JSON.parse((result as any).content[0].text);
    expect(content.results[0]).toMatchObject({ recipient: "Alice", status: "sent" });
    expect(content.results[1]).toMatchObject({ recipient: "Bob", status: "failed" });
    expect(content.results[1].error).toBe("Network error");
    expect(content.sent).toBe(1);
    expect(content.failed).toBe(1);
  });

  it("requires text — rejects empty text", async () => {
    const result = await callSendMulti({
      recipients: ["Alice"],
      text: "",
    });

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text.toLowerCase()).toContain("text");
  });

  it("requires recipients — rejects empty array", async () => {
    const result = await callSendMulti({
      recipients: [],
      text: "Hello",
    });

    expect((result as any).isError).toBe(true);
    expect((result as any).content[0].text.toLowerCase()).toContain("recipient");
  });

  it("requires recipients — rejects missing recipients", async () => {
    const result = await callSendMulti({
      text: "Hello",
    });

    expect((result as any).isError).toBe(true);
  });

  it("sends are sequential not parallel (call order preserved)", async () => {
    const callOrder: string[] = [];
    mockSendText.mockImplementation(async (args: { to: string }) => {
      callOrder.push(args.to);
      // Small delay to make parallelism detectable
      await new Promise((r) => setTimeout(r, 10));
      return { key: { id: "ok" } };
    });

    await callSendMulti({
      recipients: ["Alice", "Bob", "Charlie"],
      text: "Sequential test",
    });

    expect(callOrder).toEqual(["Alice@c.us", "Bob@c.us", "Charlie@c.us"]);
  });

  it("handles single string recipient (not array)", async () => {
    const result = await callSendMulti({
      recipients: "Alice",
      text: "Hello single",
    });

    const content = JSON.parse((result as any).content[0].text);
    expect(content.sent).toBe(1);
    expect(content.results).toHaveLength(1);
  });

  it("is registered in UTILITY_ACTIONS (exposed to LLM)", async () => {
    const actions = wahaPlugin.actions.listActions();
    expect(actions).toContain("sendMulti");
  });
});
