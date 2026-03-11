import type { OpenClawConfig } from "openclaw/plugin-sdk";

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

export type DmFilterConfig = {
  enabled?: boolean;
  mentionPatterns?: string[];
  godModeBypass?: boolean;
  godModeSuperUsers?: Array<{
    identifier: string;
    platform?: string;
    passwordRequired?: boolean;
  }>;
  tokenEstimate?: number;
};

export type WahaAccountConfig = {
  name?: string;
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string | { source: "env" | "file" | "exec"; provider: string; id: string };
  apiKeyFile?: string;
  session?: string;
  dmPolicy?: "pairing" | "open" | "closed" | "allowlist";
  groupPolicy?: "allowlist" | "open" | "closed";
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
  source?: string;
  location?: {
    latitude?: string;
    longitude?: string;
    name?: string;
    address?: string;
    url?: string;
  };
};

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
