import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import type { DmFilterConfig } from "./dm-filter.js";
export type { DmFilterConfig } from "./dm-filter.js";

export type WahaWebhookConfig = {
  host?: string;
  port?: number;
  path?: string;
  publicUrl?: string;
  hmacKey?: string;
  hmacKeyFile?: string;
  maxBodyBytes?: number;
};

export type PresenceConfig = {
  enabled?: boolean;
  sendSeen?: boolean;
  wpm?: number;
  readDelayMs?: [number, number];
  msPerReadChar?: number;
  typingDurationMs?: [number, number];
  pauseChance?: number;
  pauseDurationMs?: [number, number];
  pauseIntervalMs?: [number, number];
  jitter?: [number, number];
};

export type WahaAccountConfig = {
  name?: string;
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string | { source: "env" | "file" | "exec"; provider: string; id: string };
  apiKeyFile?: string;
  session?: string;
  dmPolicy?: "open" | "allowlist" | "pairing" | "disabled";
  groupPolicy?: "allowlist" | "open" | "disabled";
  allowFrom?: string[];
  groupAllowFrom?: string[];
  allowedGroups?: string[];
  webhookHost?: string;
  webhookPort?: number;
  webhookPath?: string;
  webhookPublicUrl?: string;
  webhookHmacKey?: string | { source: "env" | "file" | "exec"; provider: string; id: string };
  webhookHmacKeyFile?: string;
  actions?: {
    reactions?: boolean;
  };
  markdown?: {
    tables?: "auto" | "markdown" | "text";
    enabled?: boolean;
  };
  replyPrefix?: {
    enabled?: boolean;
    label?: string;
    separator?: string;
  };
  blockStreaming?: boolean;
  presence?: PresenceConfig;
  dmFilter?: DmFilterConfig;
  groupFilter?: DmFilterConfig;
  // Reliability config — wired to http-client.ts. Added Phase 1, Plan 03.
  timeoutMs?: number;
  rateLimitCapacity?: number;
  rateLimitRefillRate?: number;
  // Phase 2 config — health monitoring and inbound queue sizing. Added Phase 2, Plan 01.
  healthCheckIntervalMs?: number;
  dmQueueSize?: number;
  groupQueueSize?: number;
  // Phase 3 config — auto link preview in sendWahaText. Added Phase 3, Plan 01. DO NOT REMOVE.
  autoLinkPreview?: boolean;
  // Phase 4 config — multi-session roles and trigger word. DO NOT REMOVE.
  role?: string;              // "bot" | "human" — extensible, no enum
  subRole?: string;           // "full-access" | "listener" — extensible, no enum
  triggerWord?: string;       // e.g., "!bot"
  triggerResponseMode?: string; // "dm" | "reply-in-chat"
  // Phase 6 config — rules base path. DO NOT REMOVE.
  // If unset, defaults to ~/.openclaw/workspace/skills/waha-openclaw-channel/rules/
  rulesPath?: string;
  // Phase 12, Plan 02 (INIT-01) — global Can Initiate default. When true, the bot may start new
  // conversations with any contact unless a per-contact override blocks it.
  // Per-contact override (can_initiate_override in dm_settings): "default" | "allow" | "block".
  // DO NOT REMOVE.
  canInitiateGlobal?: boolean;
  // Phase 13 — background directory sync interval. DO NOT REMOVE.
  syncIntervalMinutes?: number;
  // Phase 16 — pairing mode config for passcode/deep-link onboarding. DO NOT REMOVE.
  pairingMode?: {
    enabled?: boolean;
    passcode?: string;
    grantTtlMinutes?: number;
    challengeMessage?: string;
    hmacSecret?: string;
    wrongPasscodeMessage?: string;
    lockoutMessage?: string;
  };
  // Phase 16 — auto-reply config for unauthorized DMs. DO NOT REMOVE.
  autoReply?: {
    enabled?: boolean;
    message?: string;
    intervalMinutes?: number;
  };
  mediaPreprocessing?: {
    enabled?: boolean;
    audio?: { enabled?: boolean; whisperScript?: string };
    image?: { enabled?: boolean; visionEndpoint?: string; visionApiKey?: string; visionModel?: string };
    video?: { enabled?: boolean; geminiApiKey?: string; geminiModel?: string };
    location?: { enabled?: boolean };
    vcard?: { enabled?: boolean };
    document?: { enabled?: boolean };
  };
};

export type WahaChannelConfig = WahaAccountConfig & {
  accounts?: Record<string, WahaAccountConfig>;
  defaultAccount?: string;
  presence?: PresenceConfig;
  dmFilter?: DmFilterConfig;
};

export type CoreConfig = OpenClawConfig & {
  channels?: {
    waha?: WahaChannelConfig;
  };
};

export type WahaWebhookEnvelope = {
  id: string;
  timestamp: number;
  event: string;
  session: string;
  payload: Record<string, unknown>;
  me?: { id?: string; pushName?: string };
  engine?: string;
  metadata?: Record<string, unknown>;
};

export type WahaInboundMessage = {
  messageId: string;
  timestamp: number;
  from: string;
  fromMe: boolean;
  chatId: string;
  body: string;
  hasMedia: boolean;
  mediaUrl?: string;
  mediaMime?: string;
  participant?: string;
  replyToId?: string | null;
  mentionedJids?: string[];  // Phase 3 Plan 02: @mentioned JIDs extracted from NOWEB _data, normalized to @c.us
  source?: string;
  location?: {
    latitude?: string;
    longitude?: string;
    name?: string;
    address?: string;
    url?: string;
  };
};

/** Raw WAHA poll creation message fields used for summary extraction */
export interface WahaPollCreationMessage {
  name?: string;
  options?: Array<{ name?: string } | string>;
  multipleAnswers?: boolean;
}

/** Raw WAHA event message fields used for summary extraction */
export interface WahaEventMessage {
  name?: string;
  startTime?: number;
  endTime?: number;
  location?: { name?: string };
  description?: string;
}

export type WahaReactionEvent = {
  messageId: string;
  from: string;
  fromMe: boolean;
  participant?: string;
  reaction: {
    text: string;
    messageId: string;
  };
};
