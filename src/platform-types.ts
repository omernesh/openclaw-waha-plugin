// SDK-free type definitions for standalone Chatlytics operation. Phase 58.

// ---------------------------------------------------------------------------
// RuntimeEnv — minimal shape actually used in the codebase.
// Replaces: openclaw/plugin-sdk/runtime -> RuntimeEnv
// Grep coverage: runtime.log (inbound.ts, monitor.ts), runtime.channel (inbound.ts
// via createScopedPairingAccess and readStoreAllowFromForDmPolicy).
// ---------------------------------------------------------------------------
export type RuntimeEnv = {
  log?: (msg: string) => void;
  channel?: {
    pairing?: {
      readAllowFromStore(params: { channel: string; accountId: string }): Promise<unknown>;
      upsertPairingRequest(params: {
        channel: string;
        accountId: string;
        id: string;
      }): Promise<unknown>;
    };
  };
};

// ---------------------------------------------------------------------------
// PluginRuntime — type used in runtime.ts to type the stored gateway runtime.
// Replaces: openclaw/plugin-sdk/core -> PluginRuntime
// Must be compatible with what OpenClaw gateway passes in via setWahaRuntime().
// Structurally a superset of RuntimeEnv to satisfy existing usage.
// ---------------------------------------------------------------------------
export type PluginRuntime = {
  log?: (msg: string) => void;
  channel: {
    pairing: {
      readAllowFromStore(params: { channel: string; accountId: string }): Promise<unknown>;
      upsertPairingRequest(params: {
        channel: string;
        accountId: string;
        id: string;
      }): Promise<unknown>;
    };
  };
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// OutboundReplyPayload — type used in inbound.ts for agent reply delivery.
// Replaces: openclaw/plugin-sdk/reply-payload -> OutboundReplyPayload
// Shape derived from all callsites in inbound.ts and deliverWahaReply.
// ---------------------------------------------------------------------------
export type OutboundReplyPayload = {
  text?: string;
  mediaUrls?: string[];
  replyToId?: string;
  attachments?: Array<{
    url?: string;
    mimeType?: string;
    filename?: string;
  }>;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// isWhatsAppGroupJid — pure function, replaces openclaw/plugin-sdk/whatsapp-shared.
// ---------------------------------------------------------------------------
export const isWhatsAppGroupJid = (jid: string): boolean => jid.endsWith("@g.us");

// ---------------------------------------------------------------------------
// StandaloneConfig — local replacement for OpenClawConfig from openclaw/plugin-sdk/core.
// Must be structurally compatible with OpenClawConfig so that CoreConfig (which
// previously extended OpenClawConfig) still passes type-checks in channel.ts
// and index.ts (which retain SDK imports).
//
// Shape derived by grepping all usages of OpenClawConfig and CoreConfig:
//   - cfg.channels (WahaChannelConfig)
//   - Passed to OpenClaw gateway SDK functions in channel.ts/index.ts
//
// This type is intentionally open (index signature + optional fields) so that
// channel.ts can still intersect StandaloneConfig with its SDK-typed variant.
// ---------------------------------------------------------------------------
export type StandaloneConfig = {
  channels?: Record<string, unknown>;
  [key: string]: unknown;
};
