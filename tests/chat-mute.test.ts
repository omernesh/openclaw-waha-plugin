import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the modules that mute/unmute depend on
vi.mock("../src/http-client.js", () => ({
  callWahaApi: vi.fn().mockResolvedValue({ ok: true }),
  warnOnError: vi.fn((p: any) => p),
}));

vi.mock("../src/accounts.js", () => ({
  resolveWahaAccount: vi.fn().mockReturnValue({
    baseUrl: "http://localhost:3004",
    apiKey: "test-key",
    session: "3cf11776_logan",
    role: "bot",
    subRole: "full-access",
  }),
  listEnabledWahaAccounts: vi.fn().mockReturnValue([{
    accountId: "default",
    enabled: true,
    baseUrl: "http://localhost:3004",
    apiKey: "test-key",
    session: "3cf11776_logan",
    role: "bot",
    subRole: "full-access",
  }]),
}));

vi.mock("../src/normalize.js", () => ({
  normalizeWahaMessagingTarget: vi.fn((t: string) => t),
}));

vi.mock("lru-cache", () => {
  class FakeLRUCache {
    get() { return undefined; }
    set() {}
    has() { return false; }
  }
  return { LRUCache: FakeLRUCache };
});

vi.mock("openclaw/plugin-sdk", () => ({
  detectMime: vi.fn(),
  sendMediaWithLeadingCaption: vi.fn(),
  DEFAULT_ACCOUNT_ID: "default",
}));

import { callWahaApi } from "../src/http-client.js";
import type { CoreConfig } from "../src/types.js";

const baseCfg: CoreConfig = {
  channels: {
    waha: {
      baseUrl: "http://localhost:3004",
      apiKey: "test-key",
      session: "3cf11776_logan",
    },
  },
} as CoreConfig;

describe("muteWahaChat / unmuteWahaChat", { timeout: 15_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("muteWahaChat calls correct WAHA API endpoint", async () => {
    const { muteWahaChat } = await import("../src/send.js");
    await muteWahaChat({ cfg: baseCfg, chatId: "123@c.us" });
    expect(callWahaApi).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("/chats/123%40c.us/mute"),
      }),
    );
  });

  it("unmuteWahaChat calls correct WAHA API endpoint", async () => {
    const { unmuteWahaChat } = await import("../src/send.js");
    await unmuteWahaChat({ cfg: baseCfg, chatId: "123@c.us" });
    expect(callWahaApi).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("/chats/123%40c.us/unmute"),
      }),
    );
  });

  it("muteWahaChat includes duration in body when provided", async () => {
    const { muteWahaChat } = await import("../src/send.js");
    await muteWahaChat({ cfg: baseCfg, chatId: "123@c.us", duration: 3600 });
    expect(callWahaApi).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ duration: 3600 }),
      }),
    );
  });
});
