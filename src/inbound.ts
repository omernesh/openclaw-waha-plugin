import {
  GROUP_POLICY_BLOCKED_LABEL,
  createNormalizedOutboundDeliverer,
  createReplyPrefixOptions,
  createScopedPairingAccess,
  formatTextWithAttachmentLinks,
  logInboundDrop,
  readStoreAllowFromForDmPolicy,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  resolveDmGroupAccessWithCommandGate,
  resolveOutboundMediaUrls,
  warnMissingProviderGroupPolicyFallbackOnce,
  type OpenClawConfig,
  type OutboundReplyPayload,
  type RuntimeEnv,
} from "openclaw/plugin-sdk";
import { isWhatsAppGroupJid } from "openclaw/plugin-sdk";
import type { ResolvedWahaAccount } from "./accounts.js";
import { DmFilter } from "./dm-filter.js";
import { getDirectoryDb } from "./directory.js";
import { normalizeWahaAllowEntry, resolveWahaAllowlistMatch } from "./normalize.js";
import { startHumanPresence, type PresenceController } from "./presence.js";
import { getWahaRuntime } from "./runtime.js";
import { sendWahaMediaBatch, sendWahaPresence, sendWahaText } from "./send.js";
import type { CoreConfig, WahaInboundMessage } from "./types.js";

const CHANNEL_ID = "waha" as const;

// Module-level DM filter singleton (shared across invocations, reuses regex cache)
const _dmFilterInstance = new Map<string, DmFilter>();

function getDmFilter(cfg: CoreConfig, accountId: string): DmFilter {
  const dmFilterCfg = cfg.channels?.waha?.dmFilter ?? {};
  const key = accountId;
  if (!_dmFilterInstance.has(key)) {
    _dmFilterInstance.set(key, new DmFilter(dmFilterCfg));
  } else {
    _dmFilterInstance.get(key)!.updateConfig(dmFilterCfg);
  }
  return _dmFilterInstance.get(key)!;
}

// Exported for admin panel stats access
export function getDmFilterForAdmin(cfg: CoreConfig, accountId: string): DmFilter {
  return getDmFilter(cfg, accountId);
}

async function deliverWahaReply(params: {
  payload: OutboundReplyPayload;
  chatId: string;
  accountId: string;
  statusSink?: (patch: { lastOutboundAt?: number }) => void;
  cfg: CoreConfig;
  presenceCtrl?: PresenceController;
}) {
  const { payload, chatId, accountId, statusSink, cfg, presenceCtrl } = params;
  const mediaUrls = resolveOutboundMediaUrls(payload);
  const text = payload.text ?? "";

  // Stop typing before sending (reply is ready)
  if (presenceCtrl) {
    await presenceCtrl.finishTyping(text).catch(() => {});
  } else {
    await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(() => {});
  }

  if (mediaUrls.length > 0) {
    await sendWahaMediaBatch({
      cfg,
      to: chatId,
      mediaUrls,
      caption: text,
      replyToId: payload.replyToId,
      accountId,
    });
    // Safety net: ensure typing stopped after delivery
    await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(() => {});
    statusSink?.({ lastOutboundAt: Date.now() });
    return;
  }

  const combined = formatTextWithAttachmentLinks(text, mediaUrls);
  if (!combined) return;
  await sendWahaText({
    cfg,
    to: chatId,
    text: combined,
    replyToId: payload.replyToId,
    accountId,
  });
  // Safety net: ensure typing stopped after delivery
  await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(() => {});
  statusSink?.({ lastOutboundAt: Date.now() });
}

export async function handleWahaInbound(params: {
  message: WahaInboundMessage;
  account: ResolvedWahaAccount;
  config: CoreConfig;
  runtime: RuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}) {
  const { message, account, config, runtime, statusSink } = params;
  const core = getWahaRuntime();
  const pairing = createScopedPairingAccess({
    core,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  const textBody = message.body?.trim() ?? "";

  const locationSummary = message.location
    ? [
        "[location]",
        message.location.latitude && message.location.longitude
          ? `lat=${message.location.latitude}, lon=${message.location.longitude}`
          : "",
        message.location.name ? `name=${message.location.name}` : "",
        message.location.address ? `address=${message.location.address}` : "",
        message.location.url ? `url=${message.location.url}` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  const imageLike = Boolean(message.mediaMime?.startsWith("image/"));
  const mediaSummary = message.hasMedia
    ? [
        imageLike ? "[image]" : "[media]",
        message.mediaMime ? `mime=${message.mediaMime}` : "",
        message.mediaUrl ? `url=${message.mediaUrl}` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";

  const rawBody = [textBody, locationSummary, mediaSummary].filter(Boolean).join("\n").trim();
  if (!rawBody) {
    return;
  }

  const isGroup = isWhatsAppGroupJid(message.chatId);
  const senderId = message.participant || message.from;
  const chatId = message.chatId;

  // Group whitelist: if allowedGroups is set, only respond in those groups
  if (isGroup) {
    const allowedGroups = account.config.allowedGroups;
    if (allowedGroups && allowedGroups.length > 0 && !allowedGroups.includes(chatId)) {
      runtime.log?.(`waha: drop group ${chatId} (not in allowedGroups)`);
      return;
    }
  }

  statusSink?.({ lastInboundAt: message.timestamp });

  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const defaultGroupPolicy = resolveDefaultGroupPolicy(config as OpenClawConfig);
  const { groupPolicy, providerMissingFallbackApplied } = resolveAllowlistProviderRuntimeGroupPolicy({
    providerConfigPresent: Boolean(config.channels?.waha),
    groupPolicy: account.config.groupPolicy,
    defaultGroupPolicy,
  });

  warnMissingProviderGroupPolicyFallbackOnce({
    providerMissingFallbackApplied,
    providerKey: CHANNEL_ID,
    accountId: account.accountId,
    blockedLabel: GROUP_POLICY_BLOCKED_LABEL.group,
    log: (message) => runtime.log?.(message),
  });

  const configAllowFrom = (account.config.allowFrom ?? []).map(normalizeWahaAllowEntry);
  const configGroupAllowFrom = (account.config.groupAllowFrom ?? []).map(normalizeWahaAllowEntry);
  const storeAllowFrom = await readStoreAllowFromForDmPolicy({
    provider: CHANNEL_ID,
    accountId: account.accountId,
    dmPolicy,
    readStore: pairing.readStoreForDmPolicy,
  });
  const storeAllowList = storeAllowFrom.map(normalizeWahaAllowEntry);

  const allowTextCommands = core.channel.commands.shouldHandleTextCommands({
    cfg: config as OpenClawConfig,
    surface: CHANNEL_ID,
  });
  const useAccessGroups =
    (config.commands as Record<string, unknown> | undefined)?.useAccessGroups !== false;
  const hasControlCommand = core.channel.text.hasControlCommand(rawBody, config as OpenClawConfig);

  const access = resolveDmGroupAccessWithCommandGate({
    isGroup,
    dmPolicy,
    groupPolicy,
    allowFrom: configAllowFrom,
    groupAllowFrom: configGroupAllowFrom,
    storeAllowFrom: storeAllowList,
    isSenderAllowed: (allowFrom) =>
      resolveWahaAllowlistMatch({ allowFrom, senderId }).allowed,
    command: {
      useAccessGroups,
      allowTextCommands,
      hasControlCommand,
    },
  });

  if (isGroup) {
    if (access.decision !== "allow") {
      runtime.log?.(`waha: drop group sender ${senderId} (reason=${access.reason})`);
      return;
    }
    const groupAllow = resolveWahaAllowlistMatch({
      allowFrom: access.effectiveGroupAllowFrom ?? [],
      senderId,
    });
    if (!groupAllow.allowed && groupPolicy !== "open") {
      runtime.log?.(`waha: drop group sender ${senderId} (policy=${groupPolicy})`);
      return;
    }
  } else if (access.decision !== "allow") {
    if (access.decision === "pairing") {
      const { code, created } = await pairing.upsertPairingRequest({
        id: senderId,
      });
      if (created) {
        try {
          await sendWahaText({
            cfg: config as CoreConfig,
            to: chatId,
            text: core.channel.pairing.buildPairingReply({
              channel: CHANNEL_ID,
              idLine: `Your WhatsApp id: ${senderId}`,
              code,
            }),
            accountId: account.accountId,
          });
          statusSink?.({ lastOutboundAt: Date.now() });
        } catch (err) {
          runtime.error?.(`waha: pairing reply failed for ${senderId}: ${String(err)}`);
        }
      }
    }
    runtime.log?.(`waha: drop DM sender ${senderId} (reason=${access.reason})`);
    return;
  }

  if (access.shouldBlockControlCommand) {
    logInboundDrop({
      log: (message) => runtime.log?.(message),
      channel: CHANNEL_ID,
      reason: "control command (unauthorized)",
      target: senderId,
    });
    return;
  }

  // DM keyword filter: silently drop DMs that don't match mentionPatterns
  if (!isGroup) {
    const dmFilter = getDmFilter(config, account.accountId);
    const filterResult = dmFilter.check({
      text: rawBody,
      senderId,
      log: (msg) => runtime.log?.(msg),
    });
    if (!filterResult.pass) {
      return; // Silent drop — no pairing message, no error
    }
  }

  // Track contact in directory (fire-and-forget, errors non-fatal)
  try {
    const dirDb = getDirectoryDb(account.accountId);
    dirDb.upsertContact(senderId, undefined, isGroup);
  } catch (err) {
    runtime.log?.(`waha: directory upsert failed for ${senderId}: ${String(err)}`);
  }

  // Per-DM settings enforcement (DMs only)
  if (!isGroup) {
    try {
      const dirDb = getDirectoryDb(account.accountId);
      const dmSettings = dirDb.getContactDmSettings(senderId);

      if (dmSettings.mode === "listen_only") {
        runtime.log?.(`waha: listen-only mode for ${senderId}, skipping response`);
        return;
      }

      if (dmSettings.mentionOnly) {
        const mentionPatterns = config.channels?.waha?.dmFilter?.mentionPatterns ?? [];
        const mentioned =
          mentionPatterns.length === 0 ||
          mentionPatterns.some((p) => {
            try {
              return new RegExp(p, "i").test(rawBody);
            } catch {
              return false;
            }
          });
        if (!mentioned) {
          runtime.log?.(`waha: mention-only mode for ${senderId}, no mention found`);
          return;
        }
      }
    } catch (err) {
      // Non-fatal: if SQLite fails, continue with normal processing
      runtime.log?.(`waha: per-DM settings check failed for ${senderId}: ${String(err)}`);
    }
  }

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config as OpenClawConfig,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: isGroup ? "group" : "direct",
      id: chatId,
    },
  });

  const fromLabel = isGroup ? `chat:${chatId}` : `user:${senderId}`;
  const storePath = core.channel.session.resolveStorePath(
    (config.session as Record<string, unknown> | undefined)?.store as string | undefined,
    { agentId: route.agentId },
  );
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(config as OpenClawConfig);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });

  const body = core.channel.reply.formatAgentEnvelope({
    channel: "WAHA",
    from: fromLabel,
    timestamp: message.timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: rawBody,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: isGroup ? `waha:chat:${chatId}` : `waha:${senderId}`,
    To: `waha:${chatId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: undefined,
    SenderId: senderId,
    GroupSubject: isGroup ? chatId : undefined,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    WasMentioned: undefined,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `waha:${chatId}`,
    CommandAuthorized: access.commandAuthorized,
  });

  await core.channel.session.recordInboundSession({
    storePath,
    sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
    ctx: ctxPayload,
    onRecordError: (err) => {
      runtime.error?.(`waha: failed updating session meta: ${String(err)}`);
    },
  });

  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg: config as OpenClawConfig,
    agentId: route.agentId,
    channel: CHANNEL_ID,
    accountId: account.accountId,
  });

  // Start human presence simulation (read delay + typing indicator)
  const presenceCtrl = await startHumanPresence({
    cfg: config as CoreConfig,
    chatId,
    messageId: message.messageId,
    incomingText: rawBody,
    accountId: account.accountId,
  });

  const deliverReply = createNormalizedOutboundDeliverer(async (payload) => {
    await deliverWahaReply({
      payload,
      chatId,
      accountId: account.accountId,
      statusSink,
      cfg: config as CoreConfig,
      presenceCtrl,
    });
  });

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config as OpenClawConfig,
    dispatcherOptions: {
      ...prefixOptions,
      deliver: deliverReply,
      onError: (err, info) => {
        // Cancel typing on error
        presenceCtrl.cancelTyping().catch(() => {});
        runtime.error?.(`waha ${info.kind} reply failed: ${String(err)}`);
      },
    },
    replyOptions: {
      onModelSelected,
      disableBlockStreaming:
        typeof account.config.blockStreaming === "boolean"
          ? !account.config.blockStreaming
          : undefined,
    },
  });
}
