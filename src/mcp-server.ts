// Phase 62 (MCP-01, MCP-04, MCP-05): MCP server factory for Chatlytics.
// Registers 10 tools and 5 resources using @modelcontextprotocol/sdk.
// All tool logic delegates to existing business modules — no new WAHA logic here.
// DO NOT CHANGE tool names (they are the API surface exposed to MCP clients).

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { handleProxySend } from "./proxy-send-handler.js";
import { listEnabledWahaAccounts } from "./accounts.js";
import { getHealthState } from "./health.js";
import { getMimicryDb, getCapStatus, resolveCapLimit, getMaturityPhase } from "./mimicry-gate.js";
import { getDirectoryDb } from "./directory.js";
import { getConfigPath, readConfig } from "./config-io.js";
import { callWahaApi } from "./http-client.js";
import { getWahaChatMessages } from "./send.js";
import type { CoreConfig } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Recovery hint builder (MCP-05)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Builds a human-readable recovery hint from a blocked send response body.
 * Used in all tool callbacks that call handleProxySend to surface actionable errors.
 * DO NOT REMOVE — MCP-05 requirement (actionable mimicry block errors).
 */
export function buildRecoveryHint(body: Record<string, unknown>): string {
  const error = String(body.error ?? "");
  if (/gate closed|time.?gate|outside.*window|quiet hours/i.test(error)) {
    // Extract a time if present
    const timeMatch = error.match(/until\s+([\d:]+)/i);
    const time = timeMatch ? timeMatch[1] : "the configured window";
    return `Gate closed until ${time} — retry then, or use update_settings to adjust gate hours (path: channels.waha.sendGate.startHour / endHour).`;
  }
  if (/hourly cap|cap exceeded|limit reached|cap of/i.test(error)) {
    const capMatch = error.match(/cap of (\d+)/i) ?? error.match(/(\d+)/);
    const cap = capMatch ? capMatch[1] : "N";
    return `Hourly cap of ${cap} reached — wait for the 1-hour window to reset, or increase cap via update_settings (path: channels.waha.hourlyCap.limits.stable).`;
  }
  return "Check get_status for current gate/cap state, or use update_settings to adjust mimicry configuration.";
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: get first enabled account's directory DB
// ─────────────────────────────────────────────────────────────────────────────

function getFirstAccountDb(cfg: CoreConfig) {
  const accounts = listEnabledWahaAccounts(cfg);
  const accountId = accounts[0]?.accountId ?? "default";
  const tenantId = accounts[0]?.tenantId ?? "default";
  return getDirectoryDb(accountId, tenantId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: get waha config section and base URL / apiKey
// ─────────────────────────────────────────────────────────────────────────────

function getWahaCfg(cfg: CoreConfig) {
  const wahaConfig = ((cfg as Record<string, unknown>)?.channels as Record<string, unknown> | undefined)?.waha ?? cfg;
  return {
    baseUrl: (wahaConfig.apiUrl as string | undefined) ?? "http://127.0.0.1:3004",
    apiKey: (wahaConfig.apiKey as string | undefined) ?? "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: sanitize config (remove API keys before exposing via resource)
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeCfg(cfg: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>;
  function scrub(obj: unknown): void {
    if (!obj || typeof obj !== "object") return;
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      if (/api.?key|secret|password|token/i.test(key)) {
        (obj as Record<string, unknown>)[key] = "***";
      } else {
        scrub((obj as Record<string, unknown>)[key]);
      }
    }
  }
  scrub(clone);
  return clone;
}

// ─────────────────────────────────────────────────────────────────────────────
// Simple dot-path setter (no lodash dependency needed)
// ─────────────────────────────────────────────────────────────────────────────

function setAtPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof cur[part] !== "object" || cur[part] === null) {
      cur[part] = {};
    }
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

// ─────────────────────────────────────────────────────────────────────────────
// createMcpServer factory (MCP-01, MCP-04, MCP-05)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates and returns a configured McpServer with all 10 tools and 5 resources.
 * Each call returns a fresh server instance — connect a transport externally.
 *
 * DO NOT CHANGE tool names or resource URIs — they are the API surface for MCP clients.
 * Phase 62 (MCP-01, MCP-04, MCP-05).
 */
export function createMcpServer(cfg: CoreConfig): McpServer {
  const server = new McpServer({ name: "chatlytics", version: "2.0.0" });

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 1: send_message (MCP-01)
  // ─────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "send_message",
    {
      description: "Send a WhatsApp text message. Routes through the mimicry gate (time gate + hourly cap). Returns isError:true with a recovery hint if blocked.",
      inputSchema: {
        chatId: z.string().describe("WhatsApp chat JID or display name (e.g. 'Alice' or '972501234567@c.us')"),
        session: z.string().describe("WAHA session name (e.g. '3cf11776_logan')"),
        text: z.string().describe("Message text to send"),
      },
    },
    async (args) => {
      try {
        const result = await handleProxySend({ body: { ...args, type: "text" }, cfg });
        if (result.body.blocked) {
          const hint = buildRecoveryHint(result.body);
          return { content: [{ type: "text", text: `${result.body.error}\n\nRecovery: ${hint}` }], isError: true };
        }
        if (result.status >= 400) {
          return { content: [{ type: "text", text: String(result.body.error ?? "Send failed") }], isError: true };
        }
        return { content: [{ type: "text", text: "Message sent." }] };
      } catch (err) {
        return { content: [{ type: "text", text: `send_message error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 2: send_media (MCP-01)
  // ─────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "send_media",
    {
      description: "Send a WhatsApp media message (image, video, file, or voice). Routes through the mimicry gate.",
      inputSchema: {
        chatId: z.string().describe("WhatsApp chat JID or display name"),
        session: z.string().describe("WAHA session name"),
        url: z.string().describe("Public URL of the media file"),
        type: z.enum(["image", "video", "file", "voice"]).describe("Media type"),
        caption: z.string().optional().describe("Optional caption for image/video"),
      },
    },
    async (args) => {
      try {
        const result = await handleProxySend({ body: { ...args }, cfg });
        if (result.body.blocked) {
          const hint = buildRecoveryHint(result.body);
          return { content: [{ type: "text", text: `${result.body.error}\n\nRecovery: ${hint}` }], isError: true };
        }
        if (result.status >= 400) {
          return { content: [{ type: "text", text: String(result.body.error ?? "Media send failed") }], isError: true };
        }
        return { content: [{ type: "text", text: `${args.type} sent.` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `send_media error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 3: read_messages (MCP-01)
  // ─────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "read_messages",
    {
      description: "Read recent WhatsApp messages from a chat.",
      inputSchema: {
        chatId: z.string().describe("WhatsApp chat JID"),
        session: z.string().describe("WAHA session name"),
        limit: z.number().int().min(1).max(100).optional().describe("Number of messages to return (default 20)"),
      },
    },
    async (args) => {
      try {
        const messages = await getWahaChatMessages({
          cfg,
          accountId: args.session,
          chatId: args.chatId,
          limit: args.limit ?? 20,
          downloadMedia: false,
        });
        return { content: [{ type: "text", text: JSON.stringify(messages) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `read_messages error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 4: search (MCP-01)
  // ─────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "search",
    {
      description: "Search contacts and groups in the WhatsApp directory by name or JID.",
      inputSchema: {
        query: z.string().describe("Search term (name or partial JID)"),
        limit: z.number().int().min(1).max(200).optional().describe("Max results (default 20)"),
      },
    },
    async (args) => {
      try {
        const db = getFirstAccountDb(cfg);
        const results = db.getContacts({ search: args.query, limit: args.limit ?? 20 });
        return { content: [{ type: "text", text: JSON.stringify(results) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `search error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 5: get_directory (MCP-01)
  // ─────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "get_directory",
    {
      description: "List contacts, groups, or newsletters from the WhatsApp directory with pagination.",
      inputSchema: {
        type: z.enum(["contact", "group", "newsletter"]).optional().describe("Filter by entry type"),
        search: z.string().optional().describe("Optional search term"),
        limit: z.number().int().min(1).max(500).optional().describe("Page size (default 50)"),
        offset: z.number().int().min(0).optional().describe("Page offset (default 0)"),
      },
    },
    async (args) => {
      try {
        const db = getFirstAccountDb(cfg);
        const results = db.getContacts({
          type: args.type as "contact" | "group" | "newsletter" | undefined,
          search: args.search,
          limit: args.limit ?? 50,
          offset: args.offset ?? 0,
        });
        const total = db.getContactCount(args.search, args.type as "contact" | "group" | "newsletter" | undefined);
        return { content: [{ type: "text", text: JSON.stringify({ total, results }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `get_directory error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 6: manage_group (MCP-01)
  // ─────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "manage_group",
    {
      description: "Manage a WhatsApp group: create, rename, add/remove participants, promote/demote admins, leave, or get info.",
      inputSchema: {
        action: z.enum(["create", "rename", "add_participant", "remove_participant", "promote_admin", "demote_admin", "leave", "info"]).describe("Group operation to perform"),
        session: z.string().describe("WAHA session name"),
        groupId: z.string().optional().describe("Group JID (required for all actions except create)"),
        name: z.string().optional().describe("Group name (required for create and rename)"),
        participants: z.array(z.string()).optional().describe("Participant JIDs (required for add/remove/promote/demote)"),
      },
    },
    async (args) => {
      try {
        const { baseUrl, apiKey } = getWahaCfg(cfg);
        const ctx = { action: `manage_group:${args.action}`, chatId: args.groupId };

        let path: string;
        let method: "GET" | "POST" | "PUT" | "DELETE" = "POST";
        let body: Record<string, unknown> = {};

        switch (args.action) {
          case "create":
            path = "/api/groups";
            body = { name: args.name ?? "", participants: args.participants ?? [] };
            break;
          case "rename":
            path = `/api/groups/${encodeURIComponent(args.groupId ?? "")}/subject`;
            method = "PUT";
            body = { subject: args.name ?? "" };
            break;
          case "add_participant":
            path = `/api/groups/${encodeURIComponent(args.groupId ?? "")}/participants/add`;
            body = { participants: (args.participants ?? []).map(jid => ({ id: jid })) };
            break;
          case "remove_participant":
            path = `/api/groups/${encodeURIComponent(args.groupId ?? "")}/participants/remove`;
            body = { participants: (args.participants ?? []).map(jid => ({ id: jid })) };
            break;
          case "promote_admin":
            path = `/api/groups/${encodeURIComponent(args.groupId ?? "")}/admin/promote`;
            body = { participants: (args.participants ?? []).map(jid => ({ id: jid })) };
            break;
          case "demote_admin":
            path = `/api/groups/${encodeURIComponent(args.groupId ?? "")}/admin/demote`;
            body = { participants: (args.participants ?? []).map(jid => ({ id: jid })) };
            break;
          case "leave":
            path = `/api/groups/${encodeURIComponent(args.groupId ?? "")}/leave`;
            body = {};
            break;
          case "info":
            path = `/api/groups/${encodeURIComponent(args.groupId ?? "")}`;
            method = "GET";
            body = {};
            break;
          default:
            return { content: [{ type: "text", text: `Unknown action: ${args.action}` }], isError: true };
        }

        const result = await callWahaApi({
          baseUrl,
          apiKey,
          path,
          method,
          body: method === "GET" ? undefined : body,
          session: args.session,
          context: ctx,
        });
        return { content: [{ type: "text", text: JSON.stringify(result ?? { ok: true }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `manage_group error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 7: get_status (MCP-01)
  // ─────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "get_status",
    {
      description: "Get session health and mimicry cap status. Returns all sessions, or a specific session if provided.",
      inputSchema: {
        session: z.string().optional().describe("Optional WAHA session name to filter to a single session"),
      },
    },
    async (args) => {
      try {
        const accounts = listEnabledWahaAccounts(cfg);
        const filtered = args.session
          ? accounts.filter(a => a.session === args.session)
          : accounts;

        const db = getMimicryDb();
        const wahaConfig = ((cfg as Record<string, unknown>)?.channels as Record<string, unknown> | undefined)?.waha ?? cfg;

        const statuses = filtered.map(acc => {
          const health = getHealthState(acc.session);
          const firstSendAt = db.getFirstSendAt(acc.session);
          const maturity = getMaturityPhase(firstSendAt);
          const limit = resolveCapLimit(acc.session, maturity, wahaConfig, null);
          const cap = getCapStatus(acc.session, limit, db);
          return {
            session: acc.session,
            accountId: acc.accountId,
            health: health ?? { status: "unknown" },
            mimicry: {
              count: cap.count,
              limit: cap.limit,
              remaining: cap.remaining,
              maturity: cap.maturity,
              windowStartMs: cap.windowStartMs,
            },
          };
        });

        return { content: [{ type: "text", text: JSON.stringify(statuses) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `get_status error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 8: update_settings (MCP-01)
  // Only allows paths under channels.waha to prevent unintended config corruption.
  // ─────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "update_settings",
    {
      description: "Update a Chatlytics config value. Path must be under 'channels.waha' (e.g. 'channels.waha.sendGate.startHour').",
      inputSchema: {
        path: z.string().describe("Dot-separated config path (must start with 'channels.waha')"),
        value: z.unknown().describe("New value to set at the given path"),
      },
    },
    async (args) => {
      try {
        if (!args.path.startsWith("channels.waha")) {
          return { content: [{ type: "text", text: "update_settings only allows paths under 'channels.waha'" }], isError: true };
        }
        const configPath = getConfigPath();
        const { modifyConfig } = await import("./config-io.js");
        await modifyConfig(configPath, (rawCfg) => {
          setAtPath(rawCfg, args.path, args.value);
        });
        return { content: [{ type: "text", text: `Updated ${args.path} = ${JSON.stringify(args.value)}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `update_settings error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 9: send_poll (MCP-01)
  // ─────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "send_poll",
    {
      description: "Send a WhatsApp poll message. Routes through the mimicry gate.",
      inputSchema: {
        chatId: z.string().describe("WhatsApp chat JID or display name"),
        session: z.string().describe("WAHA session name"),
        name: z.string().describe("Poll question"),
        options: z.array(z.string()).min(2).max(12).describe("Poll answer options (2-12)"),
        multipleAnswers: z.boolean().optional().describe("Allow multiple selections (default false)"),
      },
    },
    async (args) => {
      try {
        const result = await handleProxySend({
          body: {
            chatId: args.chatId,
            session: args.session,
            type: "poll",
            poll: { name: args.name, options: args.options, multipleAnswers: args.multipleAnswers ?? false },
          },
          cfg,
        });
        if (result.body.blocked) {
          const hint = buildRecoveryHint(result.body);
          return { content: [{ type: "text", text: `${result.body.error}\n\nRecovery: ${hint}` }], isError: true };
        }
        if (result.status >= 400) {
          return { content: [{ type: "text", text: String(result.body.error ?? "Poll send failed") }], isError: true };
        }
        return { content: [{ type: "text", text: "Poll sent." }] };
      } catch (err) {
        return { content: [{ type: "text", text: `send_poll error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Tool 10: send_reaction (MCP-01)
  // ─────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "send_reaction",
    {
      description: "Send an emoji reaction to a WhatsApp message.",
      inputSchema: {
        chatId: z.string().describe("WhatsApp chat JID"),
        session: z.string().describe("WAHA session name"),
        messageId: z.string().describe("Full message ID (e.g. 'true_972501234567@c.us_ABCDEF123')"),
        reaction: z.string().describe("Emoji reaction character (e.g. '👍')"),
      },
    },
    async (args) => {
      try {
        const { baseUrl, apiKey } = getWahaCfg(cfg);
        const result = await callWahaApi({
          baseUrl,
          apiKey,
          path: "/api/sendReaction",
          method: "PUT",
          body: { chatId: args.chatId, messageId: args.messageId, reaction: args.reaction },
          session: args.session,
          context: { action: "send_reaction", chatId: args.chatId },
        });
        return { content: [{ type: "text", text: JSON.stringify(result ?? { ok: true }) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `send_reaction error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
      }
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Resource 1: chatlytics://sessions (MCP-04)
  // ─────────────────────────────────────────────────────────────────────────
  server.registerResource(
    "sessions",
    "chatlytics://sessions",
    { description: "All configured WAHA sessions with health status" },
    async () => {
      const accounts = listEnabledWahaAccounts(cfg);
      const sessions = accounts.map(acc => ({
        accountId: acc.accountId,
        session: acc.session,
        role: acc.role,
        health: getHealthState(acc.session) ?? { status: "unknown" },
      }));
      return { contents: [{ uri: "chatlytics://sessions", text: JSON.stringify(sessions), mimeType: "application/json" }] };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Resource 2: chatlytics://contacts/{jid} (MCP-04)
  // ─────────────────────────────────────────────────────────────────────────
  const contactTemplate = new ResourceTemplate(
    "chatlytics://contacts/{jid}",
    {
      list: async () => {
        const db = getFirstAccountDb(cfg);
        const contacts = db.getContacts({ type: "contact", limit: 200 });
        return {
          resources: contacts.map(c => ({
            uri: `chatlytics://contacts/${encodeURIComponent(c.jid)}`,
            name: c.displayName ?? c.jid,
          })),
        };
      },
    }
  );
  server.registerResource(
    "contact",
    contactTemplate,
    { description: "WhatsApp contact details by JID (chatlytics://contacts/{jid})" },
    async (uri, vars) => {
      const db = getFirstAccountDb(cfg);
      const entry = db.getContact(decodeURIComponent(vars["jid"] as string));
      return { contents: [{ uri: uri.toString(), text: JSON.stringify(entry ?? null), mimeType: "application/json" }] };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Resource 3: chatlytics://groups/{jid} (MCP-04)
  // ─────────────────────────────────────────────────────────────────────────
  const groupTemplate = new ResourceTemplate(
    "chatlytics://groups/{jid}",
    {
      list: async () => {
        const db = getFirstAccountDb(cfg);
        const groups = db.getContacts({ type: "group", limit: 200 });
        return {
          resources: groups.map(g => ({
            uri: `chatlytics://groups/${encodeURIComponent(g.jid)}`,
            name: g.displayName ?? g.jid,
          })),
        };
      },
    }
  );
  server.registerResource(
    "group",
    groupTemplate,
    { description: "WhatsApp group details by JID (chatlytics://groups/{jid})" },
    async (uri, vars) => {
      const db = getFirstAccountDb(cfg);
      const entry = db.getContact(decodeURIComponent(vars["jid"] as string));
      return { contents: [{ uri: uri.toString(), text: JSON.stringify(entry ?? null), mimeType: "application/json" }] };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Resource 4: chatlytics://config (MCP-04)
  // Returns sanitized config (API keys redacted) — safe to expose to MCP clients.
  // ─────────────────────────────────────────────────────────────────────────
  server.registerResource(
    "config",
    "chatlytics://config",
    { description: "Current Chatlytics/WAHA channel configuration (sanitized — API keys redacted)" },
    async () => {
      const configPath = getConfigPath();
      let rawCfg: Record<string, unknown> = {};
      try {
        rawCfg = await readConfig(configPath);
      } catch {
        rawCfg = cfg as unknown as Record<string, unknown>;
      }
      const safe = sanitizeCfg(rawCfg);
      return { contents: [{ uri: "chatlytics://config", text: JSON.stringify(safe), mimeType: "application/json" }] };
    }
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Resource 5: chatlytics://mimicry (MCP-04)
  // Read-only via getCapStatus — NEVER calls checkAndConsumeCap.
  // ─────────────────────────────────────────────────────────────────────────
  server.registerResource(
    "mimicry",
    "chatlytics://mimicry",
    { description: "Per-session mimicry gate and hourly cap status (read-only)" },
    async () => {
      const accounts = listEnabledWahaAccounts(cfg);
      const db = getMimicryDb();
      const wahaConfig = ((cfg as Record<string, unknown>)?.channels as Record<string, unknown> | undefined)?.waha ?? cfg;
      const statuses = accounts.map(acc => {
        const firstSendAt = db.getFirstSendAt(acc.session);
        const maturity = getMaturityPhase(firstSendAt);
        const limit = resolveCapLimit(acc.session, maturity, wahaConfig, null);
        const cap = getCapStatus(acc.session, limit, db);
        return { session: acc.session, ...cap };
      });
      return { contents: [{ uri: "chatlytics://mimicry", text: JSON.stringify(statuses), mimeType: "application/json" }] };
    }
  );

  return server;
}
