import { describe, it, expect } from "vitest";
import { detectTriggerWord, resolveTriggerTarget } from "../src/trigger-word.js";
import type { WahaInboundMessage } from "../src/types.js";

// -- detectTriggerWord tests --

describe("detectTriggerWord", () => {
  it("detects trigger at start and strips prefix", () => {
    const result = detectTriggerWord("!bot hello", "!bot");
    expect(result).toEqual({ triggered: true, strippedText: "hello" });
  });

  it("is case-insensitive for trigger word", () => {
    const result = detectTriggerWord("!BOT hello", "!bot");
    expect(result).toEqual({ triggered: true, strippedText: "hello" });
  });

  it("is case-insensitive for mixed-case trigger config", () => {
    const result = detectTriggerWord("!Bot Hello world", "!BOT");
    expect(result).toEqual({ triggered: true, strippedText: "Hello world" });
  });

  it("returns empty strippedText when nothing follows trigger", () => {
    const result = detectTriggerWord("!bot", "!bot");
    expect(result).toEqual({ triggered: true, strippedText: "" });
  });

  it("returns empty strippedText for trigger with only whitespace after", () => {
    const result = detectTriggerWord("!bot   ", "!bot");
    expect(result).toEqual({ triggered: true, strippedText: "" });
  });

  it("does NOT trigger when trigger word is not at start", () => {
    const result = detectTriggerWord("hello !bot", "!bot");
    expect(result).toEqual({ triggered: false, strippedText: "hello !bot" });
  });

  it("does NOT trigger for unrelated message", () => {
    const result = detectTriggerWord("hello world", "!bot");
    expect(result).toEqual({ triggered: false, strippedText: "hello world" });
  });

  it("does NOT trigger when triggerWord is empty string", () => {
    const result = detectTriggerWord("!bot hello", "");
    expect(result).toEqual({ triggered: false, strippedText: "!bot hello" });
  });

  it("does NOT trigger when triggerWord is undefined", () => {
    const result = detectTriggerWord("!bot hello", undefined);
    expect(result).toEqual({ triggered: false, strippedText: "!bot hello" });
  });

  it("handles leading whitespace before trigger word", () => {
    // trimStart is applied before matching — ' !bot hello' still triggers
    const result = detectTriggerWord("  !bot hello", "!bot");
    expect(result).toEqual({ triggered: true, strippedText: "hello" });
  });

  it("handles empty message with no trigger", () => {
    const result = detectTriggerWord("", "!bot");
    expect(result).toEqual({ triggered: false, strippedText: "" });
  });

  it("handles empty message with empty trigger", () => {
    const result = detectTriggerWord("", "");
    expect(result).toEqual({ triggered: false, strippedText: "" });
  });

  it("strips only the trigger prefix, leaving rest of prompt intact", () => {
    const result = detectTriggerWord("!bot what is the weather today?", "!bot");
    expect(result).toEqual({ triggered: true, strippedText: "what is the weather today?" });
  });
});

// -- resolveTriggerTarget tests --

describe("resolveTriggerTarget", () => {
  const baseMessage: WahaInboundMessage = {
    messageId: "msg1",
    timestamp: 1700000000,
    from: "120363421825201386@g.us",  // group JID
    fromMe: false,
    chatId: "120363421825201386@g.us",
    body: "!bot hello",
    hasMedia: false,
  };

  it("returns participant JID in group context (not group chatId)", () => {
    const msg: WahaInboundMessage = {
      ...baseMessage,
      participant: "972544329000@c.us",
    };
    expect(resolveTriggerTarget(msg)).toBe("972544329000@c.us");
  });

  it("returns from JID in DM context (no participant)", () => {
    const msg: WahaInboundMessage = {
      ...baseMessage,
      from: "972544329000@c.us",
      chatId: "972544329000@c.us",
      participant: undefined,
    };
    expect(resolveTriggerTarget(msg)).toBe("972544329000@c.us");
  });

  it("prefers participant over from when both are set", () => {
    const msg: WahaInboundMessage = {
      ...baseMessage,
      from: "120363421825201386@g.us",
      participant: "972501234567@c.us",
    };
    expect(resolveTriggerTarget(msg)).toBe("972501234567@c.us");
  });

  it("falls back to from when participant is empty string", () => {
    // Empty string is falsy — should fall through to from
    const msg: WahaInboundMessage = {
      ...baseMessage,
      from: "972544329000@c.us",
      participant: "",
    };
    // Empty string is falsy, so || falls back to from
    expect(resolveTriggerTarget(msg)).toBe("972544329000@c.us");
  });
});
