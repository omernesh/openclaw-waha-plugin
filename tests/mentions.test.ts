import { describe, it, expect } from "vitest";
import { extractMentionedJids } from "../src/mentions.js";

describe("extractMentionedJids", () => {
  it("extracts mentions from _data.message.extendedTextMessage.contextInfo.mentionedJid", () => {
    const rawPayload = {
      _data: {
        message: {
          extendedTextMessage: {
            contextInfo: {
              mentionedJid: [
                "972544329000@s.whatsapp.net",
                "972501234567@s.whatsapp.net",
              ],
            },
          },
        },
      },
    };
    const result = extractMentionedJids(rawPayload);
    expect(result).toEqual(["972544329000@c.us", "972501234567@c.us"]);
  });

  it("normalizes @s.whatsapp.net to @c.us", () => {
    const rawPayload = {
      _data: {
        message: {
          extendedTextMessage: {
            contextInfo: {
              mentionedJid: ["123456@s.whatsapp.net"],
            },
          },
        },
      },
    };
    const result = extractMentionedJids(rawPayload);
    expect(result).toEqual(["123456@c.us"]);
  });

  it("preserves JIDs already in @c.us format", () => {
    const rawPayload = {
      _data: {
        message: {
          extendedTextMessage: {
            contextInfo: {
              mentionedJid: ["123456@c.us"],
            },
          },
        },
      },
    };
    const result = extractMentionedJids(rawPayload);
    expect(result).toEqual(["123456@c.us"]);
  });

  it("returns empty array when _data is undefined", () => {
    const rawPayload = {};
    expect(extractMentionedJids(rawPayload)).toEqual([]);
  });

  it("returns empty array when _data.message is undefined", () => {
    const rawPayload = { _data: {} };
    expect(extractMentionedJids(rawPayload)).toEqual([]);
  });

  it("returns empty array when extendedTextMessage is undefined", () => {
    const rawPayload = { _data: { message: {} } };
    expect(extractMentionedJids(rawPayload)).toEqual([]);
  });

  it("returns empty array when contextInfo is undefined", () => {
    const rawPayload = { _data: { message: { extendedTextMessage: {} } } };
    expect(extractMentionedJids(rawPayload)).toEqual([]);
  });

  it("returns empty array when mentionedJid is not an array", () => {
    const rawPayload = {
      _data: {
        message: {
          extendedTextMessage: {
            contextInfo: { mentionedJid: "not-an-array" },
          },
        },
      },
    };
    expect(extractMentionedJids(rawPayload)).toEqual([]);
  });

  it("returns empty array for non-text messages (image/video/etc)", () => {
    const rawPayload = {
      _data: {
        message: {
          imageMessage: { url: "https://example.com/image.jpg" },
        },
      },
    };
    expect(extractMentionedJids(rawPayload)).toEqual([]);
  });

  it("filters out non-string entries from mentionedJid array", () => {
    const rawPayload = {
      _data: {
        message: {
          extendedTextMessage: {
            contextInfo: {
              mentionedJid: ["972544329000@s.whatsapp.net", 12345, null, undefined, "972501234567@s.whatsapp.net"],
            },
          },
        },
      },
    };
    const result = extractMentionedJids(rawPayload);
    expect(result).toEqual(["972544329000@c.us", "972501234567@c.us"]);
  });

  it("returns empty array when rawPayload is undefined-ish", () => {
    expect(extractMentionedJids(undefined as any)).toEqual([]);
    expect(extractMentionedJids(null as any)).toEqual([]);
  });
});
