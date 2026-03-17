import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock directory and send modules before importing auto-reply
const mockDb = {
  getAutoReplyLastSent: vi.fn(),
  recordAutoReply: vi.fn(),
};

vi.mock("../src/directory.js", () => ({
  getDirectoryDb: () => mockDb,
}));

vi.mock("../src/send.js", () => ({
  sendWahaText: vi.fn().mockResolvedValue(undefined),
}));

import { AutoReplyEngine } from "../src/auto-reply.js";

describe("AutoReplyEngine", () => {
  let engine: AutoReplyEngine;

  beforeEach(() => {
    vi.clearAllMocks();
    engine = new AutoReplyEngine("test-account");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("shouldReply", () => {
    it("returns true for first message from contact (never replied before)", () => {
      mockDb.getAutoReplyLastSent.mockReturnValue(null);

      expect(engine.shouldReply("972544329000@c.us", 3600)).toBe(true);
    });

    it("returns false within rate limit window", () => {
      const now = Math.floor(Date.now() / 1000);
      // Last reply was 100 seconds ago, interval is 3600
      mockDb.getAutoReplyLastSent.mockReturnValue(now - 100);

      expect(engine.shouldReply("972544329000@c.us", 3600)).toBe(false);
    });

    it("returns true after rate limit expires", () => {
      const now = Math.floor(Date.now() / 1000);
      // Last reply was 3601 seconds ago, interval is 3600
      mockDb.getAutoReplyLastSent.mockReturnValue(now - 3601);

      expect(engine.shouldReply("972544329000@c.us", 3600)).toBe(true);
    });

    it("returns true exactly at rate limit boundary", () => {
      const now = Math.floor(Date.now() / 1000);
      // Last reply was exactly intervalSeconds + 1 seconds ago (just past boundary)
      mockDb.getAutoReplyLastSent.mockReturnValue(now - 301);

      expect(engine.shouldReply("972544329000@c.us", 300)).toBe(true);
    });

    it("returns false exactly at rate limit boundary (not yet passed)", () => {
      const now = Math.floor(Date.now() / 1000);
      // Last reply was exactly intervalSeconds seconds ago (not passed yet, need > not >=)
      mockDb.getAutoReplyLastSent.mockReturnValue(now - 300);

      expect(engine.shouldReply("972544329000@c.us", 300)).toBe(false);
    });
  });

  describe("resolveTemplate (static)", () => {
    it("replaces {admin_name} variable", () => {
      const result = AutoReplyEngine.resolveTemplate(
        "Contact {admin_name} for access.",
        { admin_name: "Omer", phone: "972544329000", jid: "972544329000@c.us" },
      );
      expect(result).toBe("Contact Omer for access.");
    });

    it("replaces {phone} variable", () => {
      const result = AutoReplyEngine.resolveTemplate(
        "Your number: {phone}",
        { admin_name: "Omer", phone: "972544329000", jid: "972544329000@c.us" },
      );
      expect(result).toBe("Your number: 972544329000");
    });

    it("replaces {jid} variable", () => {
      const result = AutoReplyEngine.resolveTemplate(
        "Your ID is {jid}",
        { admin_name: "Omer", phone: "972544329000", jid: "972544329000@c.us" },
      );
      expect(result).toBe("Your ID is 972544329000@c.us");
    });

    it("replaces multiple variables in one template", () => {
      const result = AutoReplyEngine.resolveTemplate(
        "Hi {phone}, contact {admin_name} ({jid})",
        { admin_name: "Omer", phone: "972544329000", jid: "972544329000@c.us" },
      );
      expect(result).toBe("Hi 972544329000, contact Omer (972544329000@c.us)");
    });

    it("replaces unknown variables with empty string", () => {
      const result = AutoReplyEngine.resolveTemplate(
        "Hello {unknown_var}!",
        { admin_name: "Omer", phone: "972544329000", jid: "972544329000@c.us" },
      );
      expect(result).toBe("Hello !");
    });

    it("handles template with no variables", () => {
      const result = AutoReplyEngine.resolveTemplate(
        "No variables here.",
        { admin_name: "Omer", phone: "972544329000", jid: "972544329000@c.us" },
      );
      expect(result).toBe("No variables here.");
    });

    it("handles empty template", () => {
      const result = AutoReplyEngine.resolveTemplate(
        "",
        { admin_name: "Omer", phone: "972544329000", jid: "972544329000@c.us" },
      );
      expect(result).toBe("");
    });
  });
});
