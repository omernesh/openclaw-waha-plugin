/**
 * Media download and preprocessing for inbound WhatsApp messages.
 *
 * Handles: audio transcription, image analysis, video analysis,
 * location geocoding, vCard parsing, document metadata.
 */

import { execFile } from "node:child_process";
import { readFile, writeFile, unlink, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { WahaInboundMessage } from "./types.js";
import type { ResolvedWahaAccount } from "./accounts.js";

// ---------------------------------------------------------------------------
// Config types (mirrors types.ts MediaPreprocessingConfig)
// ---------------------------------------------------------------------------

export type MediaPreprocessingConfig = {
  enabled?: boolean;
  audio?: { enabled?: boolean; whisperScript?: string };
  image?: { enabled?: boolean; visionEndpoint?: string; visionApiKey?: string; visionModel?: string };
  video?: { enabled?: boolean; geminiApiKey?: string; geminiModel?: string };
  location?: { enabled?: boolean };
  vcard?: { enabled?: boolean };
  document?: { enabled?: boolean };
};

const DEFAULT_WHISPER_SCRIPT = "/home/omer/.openclaw/workspace/scripts/transcribe.py";
const DEFAULT_VISION_ENDPOINT = "http://127.0.0.1:4000";
const DEFAULT_VISION_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
const MAX_VIDEO_SIZE = 20 * 1024 * 1024; // 20MB

// ---------------------------------------------------------------------------
// Media download (fixes encrypted audio bug)
// ---------------------------------------------------------------------------

type DownloadResult = { path: string; cleanup: () => Promise<void> };

export async function downloadWahaMedia(
  baseUrl: string,
  apiKey: string,
  session: string,
  messageId: string,
): Promise<DownloadResult> {
  const url = `${baseUrl}/api/${session}/messages/${messageId}/download`;
  const response = await fetch(url, {
    method: "GET",
    headers: { "x-api-key": apiKey },
  });

  if (!response.ok) {
    throw new Error(`Media download failed (${response.status}): ${await response.text().catch(() => "")}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const tmpPath = join(tmpdir(), `waha-media-${randomBytes(8).toString("hex")}`);
  await writeFile(tmpPath, buffer);

  return {
    path: tmpPath,
    cleanup: async () => {
      try { await unlink(tmpPath); } catch { /* ignore */ }
    },
  };
}

// ---------------------------------------------------------------------------
// Audio preprocessing (Whisper transcription)
// ---------------------------------------------------------------------------

function execFileAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${cmd} failed: ${stderr || error.message}`));
      else resolve(stdout.trim());
    });
  });
}

export async function preprocessAudio(
  filePath: string,
  config?: MediaPreprocessingConfig["audio"],
): Promise<string> {
  const script = config?.whisperScript || DEFAULT_WHISPER_SCRIPT;
  try {
    const transcription = await execFileAsync("python3", [script, filePath]);
    if (transcription) {
      return `[Voice Message Transcription]: "${transcription}"`;
    }
    return "[Voice Message]: (transcription returned empty)";
  } catch (err) {
    console.warn(`[waha] audio transcription failed: ${err}`);
    return "[Voice Message]: (transcription failed)";
  }
}

// ---------------------------------------------------------------------------
// Image preprocessing (Vision API)
// ---------------------------------------------------------------------------

export async function preprocessImage(
  filePath: string,
  config?: MediaPreprocessingConfig["image"],
  caption?: string,
): Promise<string> {
  const endpoint = config?.visionEndpoint || DEFAULT_VISION_ENDPOINT;
  const model = config?.visionModel || DEFAULT_VISION_MODEL;
  const apiKey = config?.visionApiKey || process.env.LITELLM_API_KEY || "";

  try {
    const imageBuffer = await readFile(filePath);
    const base64 = imageBuffer.toString("base64");
    // Detect mime type from file signature
    const mime = detectImageMime(imageBuffer) || "image/jpeg";

    const response = await fetch(`${endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this image concisely in 1-2 sentences." },
              { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
        max_tokens: 300,
      }),
    });

    if (!response.ok) {
      throw new Error(`Vision API ${response.status}: ${await response.text().catch(() => "")}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const description = data.choices?.[0]?.message?.content?.trim() || "(no description)";
    let result = `[Image Description]: "${description}"`;
    if (caption) {
      result += `\n\nCaption: "${caption}"`;
    }
    return result;
  } catch (err) {
    console.warn(`[waha] image preprocessing failed: ${err}`);
    let result = "[Image]: (analysis failed)";
    if (caption) result += `\n\nCaption: "${caption}"`;
    return result;
  }
}

function detectImageMime(buffer: Buffer): string | null {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer[0] === 0x47 && buffer[1] === 0x49) return "image/gif";
  if (buffer[0] === 0x52 && buffer[1] === 0x49) return "image/webp";
  return null;
}

// ---------------------------------------------------------------------------
// Video preprocessing (Gemini API)
// ---------------------------------------------------------------------------

export async function preprocessVideo(
  filePath: string,
  config?: MediaPreprocessingConfig["video"],
): Promise<string> {
  const apiKey = config?.geminiApiKey || process.env.GEMINI_API_KEY || "";
  const model = config?.geminiModel || DEFAULT_GEMINI_MODEL;

  if (!apiKey) {
    return "[Video]: (no Gemini API key configured)";
  }

  try {
    // Check file size
    const fileStats = await stat(filePath);
    if (fileStats.size > MAX_VIDEO_SIZE) {
      return `[Video]: (file too large for analysis, ${(fileStats.size / 1024 / 1024).toFixed(1)} MB)`;
    }

    // Upload to Gemini Files API
    const fileBuffer = await readFile(filePath);
    const uploadResponse = await fetch(
      `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "video/mp4",
          "X-Goog-Upload-Protocol": "raw",
        },
        body: fileBuffer,
      },
    );

    if (!uploadResponse.ok) {
      throw new Error(`Gemini upload failed (${uploadResponse.status})`);
    }

    const uploadData = (await uploadResponse.json()) as { file?: { uri?: string; name?: string } };
    const fileUri = uploadData.file?.uri;
    if (!fileUri) throw new Error("No file URI returned from Gemini upload");

    // Wait for processing (poll status)
    const fileName = uploadData.file?.name;
    if (fileName) {
      for (let i = 0; i < 30; i++) {
        const statusRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`,
        );
        if (statusRes.ok) {
          const statusData = (await statusRes.json()) as { state?: string };
          if (statusData.state === "ACTIVE") break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Generate description
    const genResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { file_data: { mime_type: "video/mp4", file_uri: fileUri } },
                { text: "Describe this video concisely in 1-2 sentences. Include the approximate duration if discernible." },
              ],
            },
          ],
        }),
      },
    );

    if (!genResponse.ok) {
      throw new Error(`Gemini generateContent failed (${genResponse.status})`);
    }

    const genData = (await genResponse.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const description = genData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "(no description)";
    return `[Video Description]: "${description}"`;
  } catch (err) {
    console.warn(`[waha] video preprocessing failed: ${err}`);
    return "[Video]: (analysis failed)";
  }
}

// ---------------------------------------------------------------------------
// Location preprocessing (Nominatim reverse geocode)
// ---------------------------------------------------------------------------

export async function preprocessLocation(
  rawPayload: Record<string, unknown>,
): Promise<string | null> {
  const data = rawPayload._data as Record<string, unknown> | undefined;
  const message = data?.message as Record<string, unknown> | undefined;
  const locMsg =
    (message?.locationMessage as Record<string, unknown>) ??
    (message?.liveLocationMessage as Record<string, unknown>);

  if (!locMsg) return null;

  const lat = locMsg.degreesLatitude as number | undefined;
  const lon = locMsg.degreesLongitude as number | undefined;
  if (lat == null || lon == null) return null;

  let address = (locMsg.address as string) || (locMsg.name as string) || "";

  if (!address) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
        { headers: { "User-Agent": "OpenClaw-WAHA/1.0" } },
      );
      if (res.ok) {
        const geo = (await res.json()) as { display_name?: string };
        address = geo.display_name || "";
      }
    } catch {
      // ignore geocoding failure
    }
  }

  if (address) {
    return `[Location]: "${address}" (${lat.toFixed(6)}, ${lon.toFixed(6)})`;
  }
  return `[Location]: (${lat.toFixed(6)}, ${lon.toFixed(6)})`;
}

// ---------------------------------------------------------------------------
// vCard preprocessing
// ---------------------------------------------------------------------------

export function preprocessVCard(rawPayload: Record<string, unknown>): string | null {
  const data = rawPayload._data as Record<string, unknown> | undefined;
  const message = data?.message as Record<string, unknown> | undefined;

  // Single contact
  const contactMsg = message?.contactMessage as Record<string, unknown> | undefined;
  // Multiple contacts
  const contactsArray = message?.contactsArrayMessage as Record<string, unknown> | undefined;

  const vcards: string[] = [];

  if (contactMsg?.vcard) {
    vcards.push(contactMsg.vcard as string);
  } else if (contactsArray?.contacts) {
    const contacts = contactsArray.contacts as Array<Record<string, unknown>>;
    for (const c of contacts) {
      if (c.vcard) vcards.push(c.vcard as string);
    }
  }

  if (vcards.length === 0) return null;

  const parsed = vcards.map(parseVCardString);
  if (parsed.length === 1) {
    return `[Contact Shared]: ${parsed[0]}`;
  }
  return `[Contacts Shared]:\n${parsed.map((p, i) => `${i + 1}. ${p}`).join("\n")}`;
}

function parseVCardString(vcard: string): string {
  const parts: string[] = [];

  const fn = vcard.match(/FN:(.*)/i)?.[1]?.trim();
  if (fn) parts.push(`Name: ${fn}`);

  const tels = [...vcard.matchAll(/TEL[^:]*:(.*)/gi)].map((m) => m[1].trim());
  if (tels.length > 0) parts.push(`Phone: ${tels.join(", ")}`);

  const emails = [...vcard.matchAll(/EMAIL[^:]*:(.*)/gi)].map((m) => m[1].trim());
  if (emails.length > 0) parts.push(`Email: ${emails.join(", ")}`);

  const org = vcard.match(/ORG:(.*)/i)?.[1]?.trim();
  if (org) parts.push(`Org: ${org}`);

  const url = vcard.match(/URL:(.*)/i)?.[1]?.trim();
  if (url) parts.push(`URL: ${url}`);

  return parts.join(" | ") || "(empty contact)";
}

// ---------------------------------------------------------------------------
// Document preprocessing
// ---------------------------------------------------------------------------

export function preprocessDocument(rawPayload: Record<string, unknown>): string | null {
  const data = rawPayload._data as Record<string, unknown> | undefined;
  const message = data?.message as Record<string, unknown> | undefined;
  const docMsg = message?.documentMessage as Record<string, unknown> | undefined;

  if (!docMsg) return null;

  const filename = (docMsg.fileName as string) || (docMsg.title as string) || "unknown";
  const mimetype = (docMsg.mimetype as string) || "application/octet-stream";
  const fileLength = docMsg.fileLength as number | undefined;

  let sizeStr = "";
  if (fileLength != null && fileLength > 0) {
    if (fileLength >= 1024 * 1024) {
      sizeStr = `${(fileLength / (1024 * 1024)).toFixed(1)} MB`;
    } else if (fileLength >= 1024) {
      sizeStr = `${(fileLength / 1024).toFixed(1)} KB`;
    } else {
      sizeStr = `${fileLength} B`;
    }
  }

  const parts = [`"${filename}"`, `(${mimetype}`];
  if (sizeStr) parts[parts.length - 1] += `, ${sizeStr})`;
  else parts[parts.length - 1] += ")";

  return `[Document]: ${parts.join(" ")}`;
}

// ---------------------------------------------------------------------------
// Main preprocessing dispatcher
// ---------------------------------------------------------------------------

export async function preprocessInboundMessage(params: {
  message: WahaInboundMessage;
  rawPayload: Record<string, unknown>;
  account: ResolvedWahaAccount;
  config?: MediaPreprocessingConfig;
}): Promise<WahaInboundMessage> {
  const { message, rawPayload, account, config } = params;

  if (config?.enabled === false) return message;

  const data = rawPayload._data as Record<string, unknown> | undefined;
  const msgContent = data?.message as Record<string, unknown> | undefined;
  if (!msgContent) return message;

  let prefix: string | null = null;

  try {
    // Detect message type from _data.message keys
    if (msgContent.audioMessage || msgContent.pttMessage) {
      if (config?.audio?.enabled !== false) {
        const dl = await downloadWahaMedia(account.baseUrl, account.apiKey, account.session, message.messageId);
        try {
          prefix = await preprocessAudio(dl.path, config?.audio);
        } finally {
          await dl.cleanup();
        }
      }
    } else if (msgContent.imageMessage) {
      if (config?.image?.enabled !== false) {
        const dl = await downloadWahaMedia(account.baseUrl, account.apiKey, account.session, message.messageId);
        try {
          prefix = await preprocessImage(dl.path, config?.image, message.body || undefined);
        } finally {
          await dl.cleanup();
        }
      }
    } else if (msgContent.videoMessage) {
      if (config?.video?.enabled !== false) {
        const dl = await downloadWahaMedia(account.baseUrl, account.apiKey, account.session, message.messageId);
        try {
          prefix = await preprocessVideo(dl.path, config?.video);
        } finally {
          await dl.cleanup();
        }
      }
    } else if (msgContent.locationMessage || msgContent.liveLocationMessage) {
      if (config?.location?.enabled !== false) {
        prefix = await preprocessLocation(rawPayload);
      }
    } else if (msgContent.contactMessage || msgContent.contactsArrayMessage) {
      if (config?.vcard?.enabled !== false) {
        prefix = preprocessVCard(rawPayload);
      }
    } else if (msgContent.documentMessage) {
      if (config?.document?.enabled !== false) {
        prefix = preprocessDocument(rawPayload);
      }
    }
  } catch (err) {
    console.warn(`[waha] media preprocessing error: ${err}`);
  }

  if (prefix) {
    return {
      ...message,
      body: message.body ? `${prefix}\n\n${message.body}` : prefix,
    };
  }

  return message;
}
