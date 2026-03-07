import {
  BlockStreamingCoalesceSchema,
  DmPolicySchema,
  GroupPolicySchema,
  MarkdownConfigSchema,
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

const DmFilterSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    mentionPatterns: z.array(z.string()).optional(),
    godModeBypass: z.boolean().optional().default(true),
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
    dmPolicy: DmPolicySchema.optional().default("pairing"),
    groupPolicy: GroupPolicySchema.optional().default("allowlist"),
    allowFrom: z.array(z.string()).optional(),
    groupAllowFrom: z.array(z.string()).optional(),
    allowedGroups: z.array(z.string()).optional(),
    actions: z
      .object({
        reactions: z.boolean().optional(),
      })
      .optional(),
    markdown: MarkdownConfigSchema,
    tools: ToolPolicySchema,
    ...ReplyRuntimeConfigSchemaShape,
    blockStreaming: z.boolean().optional(),
    blockStreamingCoalesce: BlockStreamingCoalesceSchema.optional(),
    dmFilter: DmFilterSchema,
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
