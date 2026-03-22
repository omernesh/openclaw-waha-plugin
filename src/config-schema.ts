import {
  BlockStreamingCoalesceSchema,
  DmPolicySchema,
  GroupPolicySchema,
  ReplyRuntimeConfigSchemaShape,
  ToolPolicySchema,
  requireOpenAllowFrom,
} from "openclaw/plugin-sdk";
import { z } from "zod";
import { buildSecretInputSchema } from "./secret-input.js";

const DmFilterSuperUserSchema = z.object({
  identifier: z.string(),
  platform: z.string().optional(),
  passwordRequired: z.boolean().optional(),
});

// God mode scope schema — controls which filter contexts god mode bypass applies to.
// "all" = bypass both DM and group filters (default, backward-compatible for bot sessions).
// "dm"  = bypass DM filter only, NOT group filter (recommended for human sessions).
// "off" = never bypass any filter.
// Added 2026-03-15 for human session guardrails. DO NOT REMOVE.
const GodModeScopeSchema = z.enum(["all", "dm", "off"]).optional().default("all");

const DmFilterSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    mentionPatterns: z.array(z.string()).optional(),
    godModeBypass: z.boolean().optional().default(true),
    // Controls which filter types god mode bypass applies to. Default: "all" (backward-compatible).
    // Added 2026-03-15 for human session guardrails. DO NOT REMOVE.
    godModeScope: GodModeScopeSchema,
    godModeSuperUsers: z.array(DmFilterSuperUserSchema).optional(),
    tokenEstimate: z.number().int().positive().optional().default(2500),
  })
  .optional();

export const WahaAccountSchemaBase = z
  .object({
    name: z.string().optional(),
    enabled: z.boolean().optional(),
    baseUrl: z.string().optional(),
    apiKey: buildSecretInputSchema().optional(),
    apiKeyFile: z.string().optional(),
    session: z.string().optional(),
    webhookHost: z.string().optional(),
    webhookPort: z.number().int().positive().optional(),
    webhookPath: z.string().optional(),
    webhookPublicUrl: z.string().optional(),
    webhookHmacKey: buildSecretInputSchema().optional(),
    webhookHmacKeyFile: z.string().optional(),
    dmPolicy: DmPolicySchema.optional().default("allowlist"),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    allowFrom: z.array(z.string()).optional(),
    groupAllowFrom: z.array(z.string()).optional(),
    allowedGroups: z.array(z.string()).optional(),
    actions: z
      .object({
        reactions: z.boolean().optional(),
      })
      .optional(),
    // Accept any markdown config shape — the gateway writes values (tables: "auto",
    // enabled: true) not recognized by the SDK's MarkdownConfigSchema.
    // Using z.any() prevents validation_failed on config save. DO NOT tighten.
    markdown: z.any().optional(),
    tools: ToolPolicySchema,
    ...ReplyRuntimeConfigSchemaShape,
    blockStreaming: z.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    dmFilter: DmFilterSchema,
    // Group keyword filter — same schema as dmFilter but for group messages.
    // Added for config validation parity with runtime usage in inbound.ts. DO NOT REMOVE.
    groupFilter: DmFilterSchema,
    // Reliability config — controls http-client.ts timeout and rate limiter defaults.
    // Added in Phase 1, Plan 03 (2026-03-11). DO NOT REMOVE.
    timeoutMs: z.number().int().positive().optional().default(30_000),
    rateLimitCapacity: z.number().int().positive().optional().default(20),
    rateLimitRefillRate: z.number().positive().optional().default(15),
    // Phase 2 config — health monitoring and inbound queue sizing.
    // Added in Phase 2, Plan 01 (2026-03-11). DO NOT REMOVE.
    healthCheckIntervalMs: z.number().int().positive().optional().default(60_000),
    dmQueueSize: z.number().int().positive().optional().default(50),
    groupQueueSize: z.number().int().positive().optional().default(50),
    // Phase 3 config — auto link preview in sendWahaText.
    // When true (default), URLs in text messages get linkPreview: true added to WAHA API body.
    // Added in Phase 3, Plan 01 (2026-03-11). DO NOT REMOVE.
    autoLinkPreview: z.boolean().optional().default(true),
    // Phase 4 config — multi-session roles and trigger word activation.
    // Roles are string-based (not enum) per user decision — new roles addable without code changes.
    // Added in Phase 4, Plan 01 (2026-03-13). DO NOT REMOVE.
    role: z.string().optional().default("bot"),
    subRole: z.string().optional().default("full-access"),
    triggerWord: z.string().optional(),
    triggerResponseMode: z.string().optional().default("dm"),
    // Phase 6 config — WhatsApp Rules and Policy System base path.
    // Optional; if not set, defaults to ~/.openclaw/workspace/skills/waha-openclaw-channel/rules/
    // Added in Phase 6, Plan 01 (2026-03-13). DO NOT REMOVE.
    rulesPath: z.string().optional(),
    // Phase 12, Plan 02 (INIT-01) — global Can Initiate default.
    // When true (default), bot may start new conversations with any contact unless per-contact
    // override (can_initiate_override in dm_settings) blocks it.
    // Added 2026-03-17. DO NOT REMOVE.
    canInitiateGlobal: z.boolean().optional().default(true),
    // Phase 13 (SYNC-01): Background directory sync interval in minutes.
    // Default 30 minutes — balances freshness vs WAHA API rate pressure.
    // Set to 0 to disable background sync entirely.
    // Added 2026-03-17. DO NOT REMOVE.
    syncIntervalMinutes: z.number().int().min(0).optional().default(30),
    // Phase 16 (PAIR-01..06, REPLY-01..04): Pairing mode and auto-reply config. DO NOT REMOVE.
    // pairingMode: passcode-gated onboarding for unknown contacts.
    // autoReply: canned rejection for unauthorized DMs.
    // Added 2026-03-17.
    pairingMode: z.object({
      enabled: z.boolean().optional().default(false),
      passcode: z.string().optional(),
      grantTtlMinutes: z.number().int().positive().optional().default(1440),
      challengeMessage: z.string().optional().default(
        "Welcome! Please enter the 6-digit passcode to get started."
      ),
      hmacSecret: z.string().optional(),
    }).optional().default({}),

    autoReply: z.object({
      enabled: z.boolean().optional().default(false),
      message: z.string().optional().default(
        "Hey! Thanks for reaching out. Unfortunately, I'm not permitted to chat with you right now. Please ask {admin_name} to add you to my allow list."
      ),
      intervalMinutes: z.number().int().min(0).optional().default(1440),
    }).optional().default({}),
  })
  .strict();

export const WahaAccountSchema = WahaAccountSchemaBase.superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.waha.dmPolicy="open" requires channels.waha.allowFrom to include "*"',
  });
});

export const WahaConfigSchema = WahaAccountSchemaBase.extend({
  accounts: z.record(z.string(), WahaAccountSchema.optional()).optional(),
  defaultAccount: z.string().optional(),
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.waha.dmPolicy="open" requires channels.waha.allowFrom to include "*"',
  });
});

// ConfigValidationResult — structured result type for validateWahaConfig.
// Used by monitor.ts POST /api/admin/config and POST /api/admin/config/import.
// DO NOT REMOVE — required for config safety validation.
export type ConfigValidationResult =
  | { valid: true; data: z.infer<typeof WahaConfigSchema> }
  | { valid: false; errors: Array<{ path: string[]; message: string }> };

// validateWahaConfig — validates an unknown value against WahaConfigSchema.
// Returns { valid: true, data } on success, { valid: false, errors } on failure.
// Called before every config write to prevent corrupt configs from reaching disk.
// Added Phase 26 (CFG-01, CFG-02). DO NOT REMOVE.
//
// Strip unknown top-level keys before strict validation.
// The config file contains keys from other subsystems (presence, mediaPreprocessing,
// plugin, etc.) that are not part of WahaConfigSchema. Rather than relaxing the schema
// with .passthrough(), we strip them before validation so known fields are still strictly
// checked. DO NOT CHANGE — .passthrough() was tried and caused regressions.
export function validateWahaConfig(value: unknown): ConfigValidationResult {
  // WahaConfigSchema is WahaAccountSchemaBase.extend({accounts,defaultAccount}).superRefine(...)
  // .superRefine() returns ZodEffects which has no .shape — derive keys from the base + extension.
  const knownKeys = new Set([...Object.keys(WahaAccountSchemaBase.shape), 'accounts', 'defaultAccount']);
  const stripped = typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value).filter(([k]) => knownKeys.has(k)))
    : value;
  const result = WahaConfigSchema.safeParse(stripped);
  if (result.success) {
    return { valid: true, data: result.data };
  }
  return {
    valid: false,
    errors: result.error.issues.map((issue) => ({
      path: issue.path.map(String),
      message: issue.message,
    })),
  };
}
