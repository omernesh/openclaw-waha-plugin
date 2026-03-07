import {
  buildBaseChannelStatusSummary,
  buildChannelConfigSchema,
  createDefaultChannelRuntimeState,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  resolveDefaultGroupPolicy,
  setAccountEnabledInConfigSection,
  waitUntilAbort,
  type ChannelMessageActionAdapter,
  type ChannelPlugin,
  type OpenClawConfig,
  type ChannelSetupInput,
} from "openclaw/plugin-sdk";
import { WahaConfigSchema } from "./config-schema.js";
import {
  listWahaAccountIds,
  resolveDefaultWahaAccountId,
  resolveWahaAccount,
  type ResolvedWahaAccount,
} from "./accounts.js";
import { monitorWahaProvider } from "./monitor.js";
import { normalizeWahaAllowEntry, normalizeWahaMessagingTarget } from "./normalize.js";
import { getWahaRuntime } from "./runtime.js";
import { sendWahaMediaBatch, sendWahaReaction, sendWahaText } from "./send.js";
import type { CoreConfig } from "./types.js";

const meta = {
  id: "waha",
  label: "WAHA",
  selectionLabel: "WAHA (WhatsApp HTTP API)",
  docsPath: "/channels/whatsapp",
  docsLabel: "whatsapp",
  blurb: "Self-hosted WhatsApp via WAHA webhooks + REST API bridge.",
  order: 70,
  quickstartAllowFrom: true,
} as const;

const wahaMessageActions: ChannelMessageActionAdapter = {
  listActions: ({ cfg }) => {
    const baseActions = (cfg.channels?.waha?.actions as { reactions?: boolean } | undefined)
      ?.reactions;
    const hasReactionEnabled = listWahaAccountIds(cfg as CoreConfig)
      .map((accountId) => resolveWahaAccount({ cfg: cfg as CoreConfig, accountId }))
      .filter((account) => account.enabled)
      .some((account) => {
        const accountActions = account.config.actions as { reactions?: boolean } | undefined;
        return (accountActions?.reactions ?? baseActions ?? true) !== false;
      });

    return hasReactionEnabled ? ["react"] : [];
  },
  supportsAction: ({ action }) => action === "react",
  handleAction: async ({ action, params, cfg, accountId }) => {
    if (action !== "react") {
      throw new Error(`WAHA action ${action} not supported`);
    }
    const messageId = typeof (params as any)?.messageId === "string" ? (params as any).messageId : "";
    const emojiRaw = typeof (params as any)?.emoji === "string" ? (params as any).emoji : "";
    const remove = (params as any)?.remove === true;
    if (!messageId) throw new Error("WAHA react requires messageId");
    if (!emojiRaw && !remove) throw new Error("WAHA react requires emoji");

    await sendWahaReaction({
      cfg: cfg as CoreConfig,
      messageId,
      emoji: emojiRaw,
      remove,
      accountId: accountId ?? undefined,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: remove
            ? `Removed reaction from ${messageId}`
            : `Reacted with ${emojiRaw} on ${messageId}`,
        },
      ],
      details: {},
    };
  },
};

type WahaSetupInput = ChannelSetupInput & {
  baseUrl?: string;
  apiKey?: string;
  apiKeyFile?: string;
  session?: string;
};

export const wahaPlugin: ChannelPlugin<ResolvedWahaAccount> = {
  id: "waha",
  meta,
  pairing: {
    idLabel: "whatsappUserId",
    normalizeAllowEntry: (entry) => normalizeWahaAllowEntry(entry),
    notifyApproval: async ({ id }) => {
      console.log(`[waha] user ${id} approved for pairing`);
    },
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: true,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: true,
  },
  messageActions: wahaMessageActions,
  reload: { configPrefixes: ["channels.waha"] },
  configSchema: buildChannelConfigSchema(WahaConfigSchema),
  config: {
    listAccountIds: (cfg) => listWahaAccountIds(cfg as CoreConfig),
    resolveAccount: (cfg, accountId) => resolveWahaAccount({ cfg: cfg as CoreConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultWahaAccountId(cfg as CoreConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "waha",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "waha",
        accountId,
        clearBaseFields: ["baseUrl", "apiKey", "apiKeyFile", "session"],
      }),
    isConfigured: (account) => Boolean(account.baseUrl?.trim() && account.apiKey?.trim()),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.baseUrl?.trim() && account.apiKey?.trim()),
      baseUrl: account.baseUrl ? "[set]" : "[missing]",
      apiKeySource: account.apiKeySource,
      session: account.session,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveWahaAccount({ cfg: cfg as CoreConfig, accountId }).config.allowFrom ?? []).map(
        (entry) => normalizeWahaAllowEntry(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^(waha|whatsapp):/i, ""))
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(cfg.channels?.waha?.accounts?.[resolvedId]);
      const policy = useAccountPath
        ? cfg.channels?.waha?.accounts?.[resolvedId]?.dmPolicy
        : cfg.channels?.waha?.dmPolicy;
      return {
        policy: policy ?? "pairing",
        approvalHint: formatPairingApproveHint({
          config: cfg,
          channel: "waha",
          accountId: resolvedId,
        }),
      };
    },
    resolveGroupPolicy: ({ cfg, accountId }) => {
      const resolvedId = accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(cfg.channels?.waha?.accounts?.[resolvedId]);
      const policy = useAccountPath
        ? cfg.channels?.waha?.accounts?.[resolvedId]?.groupPolicy
        : cfg.channels?.waha?.groupPolicy;
      return policy ?? resolveDefaultGroupPolicy(cfg as OpenClawConfig);
    },
  },
  onboarding: {
    resolveSetupPatch: (input) => {
      const setup = input as WahaSetupInput;
      const accountId = setup.accountId ?? DEFAULT_ACCOUNT_ID;
      return {
        channels: {
          waha: {
            ...input.baseConfig?.channels?.waha,
            enabled: true,
            accounts: {
              ...input.baseConfig?.channels?.waha?.accounts,
              [accountId]: {
                ...input.baseConfig?.channels?.waha?.accounts?.[accountId],
                enabled: true,
                baseUrl: setup.baseUrl,
                ...(setup.apiKeyFile
                  ? { apiKeyFile: setup.apiKeyFile }
                  : setup.apiKey
                    ? { apiKey: setup.apiKey }
                    : {}),
                ...(setup.session ? { session: setup.session } : {}),
              },
            },
          },
        },
      } as OpenClawConfig;
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getWahaRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: 4000,
    sendText: async ({ to, text, accountId, replyToId }) => {
      const result = await sendWahaText({
        cfg: getWahaRuntime().config.readConfigFile() as CoreConfig,
        to: normalizeWahaMessagingTarget(to),
        text,
        replyToId: replyToId ?? undefined,
        accountId: accountId ?? undefined,
      });
      return { channel: "waha", ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, replyToId }) => {
      await sendWahaMediaBatch({
        cfg: getWahaRuntime().config.readConfigFile() as CoreConfig,
        to: normalizeWahaMessagingTarget(to),
        mediaUrls: mediaUrl ? [mediaUrl] : [],
        caption: text,
        replyToId: replyToId ?? undefined,
        accountId: accountId ?? undefined,
      });
      return { channel: "waha", ok: true } as const;
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) =>
      buildBaseChannelStatusSummary({
        snapshot,
        mode: "webhook",
      }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      ...createDefaultChannelRuntimeState({ accountId: account.accountId }),
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.baseUrl?.trim() && account.apiKey?.trim()),
      baseUrl: account.baseUrl ? "[set]" : "[missing]",
      apiKeySource: account.apiKeySource,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: runtime?.lastInboundAt ?? null,
      lastOutboundAt: runtime?.lastOutboundAt ?? null,
      mode: "webhook",
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      if (!account.baseUrl || !account.apiKey) {
        throw new Error(
          `WAHA not configured for account "${account.accountId}" (missing baseUrl or apiKey)`,
        );
      }

      ctx.log?.info(`[${account.accountId}] starting WAHA webhook server`);

      const { stop } = await monitorWahaProvider({
        accountId: account.accountId,
        config: ctx.cfg as CoreConfig,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
      });

      await waitUntilAbort(ctx.abortSignal);
      stop();
    },
    logoutAccount: async ({ accountId, cfg }) => {
      const nextCfg = { ...cfg } as OpenClawConfig;
      const nextSection = cfg.channels?.waha ? { ...cfg.channels.waha } : undefined;
      let cleared = false;
      let changed = false;

      if (nextSection) {
        if (accountId === DEFAULT_ACCOUNT_ID && nextSection.apiKey) {
          delete nextSection.apiKey;
          cleared = true;
          changed = true;
        }
        const accounts = nextSection.accounts && typeof nextSection.accounts === "object"
          ? { ...nextSection.accounts }
          : undefined;
        if (accounts && accountId in accounts) {
          const entry = accounts[accountId];
          if (entry && typeof entry === "object") {
            const nextEntry = { ...entry } as Record<string, unknown>;
            if ("apiKey" in nextEntry) {
              const secret = nextEntry.apiKey;
              if (typeof secret === "string" ? secret.trim() : secret) {
                cleared = true;
              }
              delete nextEntry.apiKey;
              changed = true;
            }
            if (Object.keys(nextEntry).length === 0) {
              delete accounts[accountId];
              changed = true;
            } else {
              accounts[accountId] = nextEntry as typeof entry;
            }
          }
        }
        if (accounts) {
          if (Object.keys(accounts).length === 0) {
            delete nextSection.accounts;
            changed = true;
          } else {
            nextSection.accounts = accounts;
          }
        }
      }

      if (changed) {
        if (nextSection && Object.keys(nextSection).length > 0) {
          nextCfg.channels = { ...nextCfg.channels, waha: nextSection } as OpenClawConfig["channels"];
        } else {
          const nextChannels = { ...nextCfg.channels } as Record<string, unknown>;
          delete nextChannels.waha;
          if (Object.keys(nextChannels).length > 0) {
            nextCfg.channels = nextChannels as OpenClawConfig["channels"];
          } else {
            delete nextCfg.channels;
          }
        }
      }

      if (changed) {
        await getWahaRuntime().config.writeConfigFile(nextCfg);
      }

      return {
        cleared,
        envApiKey: Boolean(process.env.WAHA_API_KEY?.trim()),
        loggedOut: !cleared,
      };
    },
  },
};
