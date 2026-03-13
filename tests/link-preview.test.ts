import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the modules that sendWahaText depends on
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

// Must mock lru-cache since send.ts imports it
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
import { sendWahaText } from "../src/send.js";
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

describe("sendWahaText link preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("detects URLs and adds linkPreview: true", async () => {
    await sendWahaText({ cfg: baseCfg, to: "123@c.us", text: "Check out https://example.com" });
    expect(callWahaApi).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ linkPreview: true }),
      }),
    );
  });

  it("does not add linkPreview when text has no URL", async () => {
    await sendWahaText({ cfg: baseCfg, to: "123@c.us", text: "Hello world no link here" });
    const callArgs = (callWahaApi as any).mock.calls[0][0];
    expect(callArgs.body).not.toHaveProperty("linkPreview");
  });

  it("adds linkPreview for http:// URLs too", async () => {
    await sendWahaText({ cfg: baseCfg, to: "123@c.us", text: "See http://example.com/page" });
    expect(callWahaApi).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ linkPreview: true }),
      }),
    );
  });

  it("respects autoLinkPreview: false config", async () => {
    const cfg: CoreConfig = {
      channels: {
        waha: {
          ...baseCfg.channels!.waha!,
          autoLinkPreview: false,
        },
      },
    } as CoreConfig;
    await sendWahaText({ cfg, to: "123@c.us", text: "Visit https://example.com" });
    const callArgs = (callWahaApi as any).mock.calls[0][0];
    expect(callArgs.body).not.toHaveProperty("linkPreview");
  });
});
