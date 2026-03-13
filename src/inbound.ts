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
import { warnOnError } from "./http-client.js";
import type { CoreConfig, WahaInboundMessage } from "./types.js";
import { extractMentionedJids } from "./mentions.js";
// Re-export for external consumers (plan specifies extractMentionedJids in inbound.ts exports)
export { extractMentionedJids } from "./mentions.js";
import { preprocessInboundMessage, downloadWahaMedia } from "./media.js";
// Phase 4 Plan 02: Trigger word detection — pure functions extracted to trigger-word.ts for testability.
// Re-exported here so callers can import from inbound.ts as the canonical entrypoint. DO NOT REMOVE.
export { detectTriggerWord, resolveTriggerTarget } from "./trigger-word.js";
import { detectTriggerWord, resolveTriggerTarget } from "./trigger-word.js";

const CHANNEL_ID = "waha" as const;

// Module-level DM filter singleton (shared across invocations, reuses regex cache)
const _dmFilterInstance = new Map<string, DmFilter>();

function getDmFilter(cfg: CoreConfig, accountId: string): DmFilter {
  const dmFilterCfg = cfg.channels?.waha?.dmFilter ?? {};
  if (!_dmFilterInstance.has(accountId)) {
    _dmFilterInstance.set(accountId, new DmFilter(dmFilterCfg));
  } else {
    _dmFilterInstance.get(accountId)!.updateConfig(dmFilterCfg);
  }
  return _dmFilterInstance.get(accountId)!;
}

// Exported for admin panel stats access
export function getDmFilterForAdmin(cfg: CoreConfig, accountId: string): DmFilter {
  return getDmFilter(cfg, accountId);
}

// Module-level Group filter singleton (shared across invocations, reuses regex cache)
const _groupFilterInstance = new Map<string, DmFilter>();

// Default group filter patterns — keywords that trigger bot responses in groups
const DEFAULT_GROUP_FILTER_PATTERNS = ["sammie", "סמי", "help", "hello", "bot", "ai"];

function getGroupFilter(cfg: CoreConfig, accountId: string): DmFilter {
  const wahaConfig = (cfg.channels?.waha ?? {}) as Record<string, unknown>;
  const rawGroupFilterCfg = (wahaConfig.groupFilter ?? {}) as Record<string, unknown>;
  // Apply defaults: enabled=true, default mentionPatterns if not explicitly set
  const groupFilterCfg = {
    enabled: true,
    mentionPatterns: DEFAULT_GROUP_FILTER_PATTERNS,
    ...rawGroupFilterCfg,
  } as Parameters<typeof DmFilter.prototype.updateConfig>[0];
  if (!_groupFilterInstance.has(accountId)) {
    _groupFilterInstance.set(accountId, new DmFilter(groupFilterCfg));
  } else {
    _groupFilterInstance.get(accountId)!.updateConfig(groupFilterCfg);
  }
  return _groupFilterInstance.get(accountId)!;
}

// Exported for admin panel stats access
export function getGroupFilterForAdmin(cfg: CoreConfig, accountId: string): DmFilter {
  return getGroupFilter(cfg, accountId);
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
    await presenceCtrl.finishTyping(text).catch(warnOnError(`inbound presence finish-typing ${chatId}`));
  } else {
    await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(warnOnError(`inbound presence typing-stop ${chatId}`));
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
    await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(warnOnError(`inbound presence typing-stop ${chatId}`));
    statusSink?.({ lastOutboundAt: Date.now() });
    return;
  }

  if (!text) return;
  await sendWahaText({
    cfg,
    to: chatId,
    text,
    replyToId: payload.replyToId,
    accountId,
  });
  // Safety net: ensure typing stopped after delivery
  await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(warnOnError(`inbound presence typing-stop ${chatId}`));
  statusSink?.({ lastOutboundAt: Date.now() });
}

export async function handleWahaInbound(params: {
  message: WahaInboundMessage;
  rawPayload?: Record<string, unknown>;
  account: ResolvedWahaAccount;
  config: CoreConfig;
  runtime: RuntimeEnv;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}) {
  const { message: rawMessage, rawPayload, account, config, runtime, statusSink } = params;

  // Quick pre-check: skip media preprocessing for groups not in allowedGroups
  const _preCheckIsGroup = isWhatsAppGroupJid(rawMessage.chatId);
  const _preCheckAllowedGroups = account.config.allowedGroups;
  const _preCheckDropped = _preCheckIsGroup && _preCheckAllowedGroups && _preCheckAllowedGroups.length > 0 && !_preCheckAllowedGroups.includes(rawMessage.chatId);

  // Preprocess media (download + transcribe/analyze) before building rawBody
  // Location, vCard, and document messages have hasMedia=false but still need preprocessing
  let message = rawMessage;
  const _rawData = (rawPayload as Record<string, unknown>)?._data as Record<string, unknown> | undefined;
  const _rawMsg = _rawData?.message as Record<string, unknown> | undefined;
  const needsPreprocessing = rawMessage.hasMedia
    || Boolean(rawMessage.location)
    || Boolean(_rawMsg?.locationMessage)
    || Boolean(_rawMsg?.liveLocationMessage)
    || Boolean(_rawMsg?.contactMessage)
    || Boolean(_rawMsg?.contactsArrayMessage)
    || Boolean(_rawMsg?.documentMessage)
    || Boolean(_rawMsg?.pollCreationMessage)        // polls
    || Boolean(_rawMsg?.eventMessage)               // events
    || Boolean(_rawMsg?.eventCreationMessage);       // event creation
  if (rawPayload && needsPreprocessing && !_preCheckDropped) {
    try {
      // !! DO NOT CHANGE — Media preprocessing config passthrough !!
      // Reads mediaPreprocessing from account config. Defaults to { enabled: true }.
      // CRITICAL: If mediaPreprocessing.enabled is false in openclaw.json, ALL media
      // preprocessing is disabled (audio transcription, image analysis, etc.).
      // The agent will receive raw media URLs and won't be able to understand
      // voice messages, images, or other media content.
      // Bug fixed 2026-03-10: config had enabled:false, broke voice transcription.
      const mediaConfig = account.config.mediaPreprocessing ?? { enabled: true };
      message = await preprocessInboundMessage({
        message: rawMessage,
        rawPayload,
        account,
        config: mediaConfig,
      });
    } catch (err) {
      runtime.log?.(`waha: media preprocessing failed: ${String(err)}`);
    }
  }
  // !! DO NOT CHANGE — Native media pipeline for images !!
  // Download image files from WAHA and pass to OpenClaw's native media-understanding
  // pipeline via MediaPath/MediaPaths on the context payload (same pipeline as Telegram).
  // This uses the gateway's configured vision providers and API keys automatically.
  // Audio transcription is NOT affected — it still uses local Whisper via media.ts.
  //
  // Bug fixed 2026-03-10: Custom vision API fetch() to LiteLLM returned 401 because
  // LITELLM_API_KEY was not in the systemd service env. Native pipeline resolves keys
  // from the gateway's secrets system, so it works without env vars.
  //
  // Verified working: 2026-03-10
  let mediaDownload: { path: string; cleanup: () => Promise<void> } | null = null;
  let mediaPayload: {
    MediaPath?: string;
    MediaType?: string;
    MediaUrl?: string;
    MediaPaths?: string[];
    MediaUrls?: string[];
    MediaTypes?: string[];
  } = {};
  if (rawMessage.hasMedia && !_preCheckDropped && _rawMsg?.imageMessage) {
    try {
      let resolvedUrl = rawMessage.mediaUrl;
      if (resolvedUrl && !resolvedUrl.startsWith("http")) {
        resolvedUrl = `${account.baseUrl}${resolvedUrl.startsWith("/") ? "" : "/"}${resolvedUrl}`;
      }
      if (resolvedUrl) {
        mediaDownload = await downloadWahaMedia(resolvedUrl, account.apiKey);
        const mimeType = rawMessage.mediaMime || "image/jpeg";
        mediaPayload = {
          MediaPath: mediaDownload.path,
          MediaType: mimeType,
          MediaUrl: mediaDownload.path,
          MediaPaths: [mediaDownload.path],
          MediaUrls: [mediaDownload.path],
          MediaTypes: [mimeType],
        };
      }
    } catch (err) {
      runtime.log?.(`waha: image download for native pipeline failed: ${String(err)}`);
      // Fallback: agent sees mediaSummary text but no image analysis
    }
  }

  // -- Phase 3 Plan 02: Extract @mentions from raw WAHA payload --
  // DO NOT CHANGE — Extracts mentionedJid from NOWEB _data, normalizes to @c.us.
  // Sets msg.mentionedJids for ctxPayload. Uses optional chaining for safety.
  const mentionedJids = extractMentionedJids(rawPayload);
  message = { ...message, mentionedJids };
  if (mentionedJids.length > 0) {
    runtime.log?.(`waha: mentions extracted count=${mentionedJids.length} jids=${mentionedJids.join(",")}`);
  }

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

  // Poll summary
  let pollSummary = "";
  const pollMsg = _rawMsg?.pollCreationMessage;
  if (pollMsg && typeof pollMsg === "object") {
    const pollName = (pollMsg as any).name ?? textBody ?? "Untitled poll";
    const options = Array.isArray((pollMsg as any).options)
      ? (pollMsg as any).options.map((o: any, i: number) => `${i + 1}) ${o.name ?? o}`).join("  ")
      : "";
    const multi = (pollMsg as any).multipleAnswers ? "yes" : "no";
    pollSummary = `[poll] "${pollName}"\nOptions: ${options}\nMultiple answers: ${multi}`;
    if (rawMessage.messageId) pollSummary += `\nPoll message ID: ${rawMessage.messageId}`;
  }

  // Event summary
  let eventSummary = "";
  const eventMsg = _rawMsg?.eventMessage ?? _rawMsg?.eventCreationMessage;
  if (eventMsg && typeof eventMsg === "object") {
    const evName = (eventMsg as any).name ?? "Untitled event";
    const startTs = (eventMsg as any).startTime;
    const endTs = (eventMsg as any).endTime;
    const startStr = startTs ? new Date(startTs * 1000).toISOString() : "unknown";
    const endStr = endTs ? new Date(endTs * 1000).toISOString() : "";
    const loc = (eventMsg as any).location?.name ?? "";
    const desc = (eventMsg as any).description ?? "";
    eventSummary = `[event] "${evName}"\nWhen: ${startStr}${endStr ? " to " + endStr : ""}`;
    if (loc) eventSummary += `\nWhere: ${loc}`;
    if (desc) eventSummary += `\nDescription: ${desc}`;
  }

  // Phase 3 Plan 02: Human-readable mention summary for agent context
  const mentionSummary = message.mentionedJids && message.mentionedJids.length > 0
    ? "Mentioned: " + message.mentionedJids.map((jid) => "+" + jid.replace(/@c\.us$/, "")).join(", ")
    : "";

  const rawBody = [textBody, locationSummary, mediaSummary, pollSummary, eventSummary, mentionSummary].filter(Boolean).join("\n").trim();
  if (!rawBody) {
    return;
  }

  const isGroup = isWhatsAppGroupJid(message.chatId);
  const senderId = message.participant || message.from;
  const chatId = message.chatId;

  // Phase 4 Plan 02: Trigger word detection — check before group filters.
  // Trigger-word messages are explicit bot invocations and bypass group keyword filtering.
  // triggerWord config is per-account (e.g., "!sammie"). Case-insensitive.
  // DO NOT MOVE above rawBody calculation — detectTriggerWord needs the text body.
  // DO NOT MOVE below group filter — trigger must bypass it (see RESEARCH.md Open Question 1).
  // Added Phase 4, Plan 02. DO NOT REMOVE.
  let effectiveBody = rawBody;
  let triggerActivated = false;
  let triggerResponseChatId = chatId; // default: respond in same chat
  const triggerWord = account.config.triggerWord;
  if (isGroup && triggerWord) {
    const triggerResult = detectTriggerWord(rawBody, triggerWord);
    if (triggerResult.triggered) {
      triggerActivated = true;
      effectiveBody = triggerResult.strippedText || rawBody; // preserve original if stripped is empty
      const triggerResponseMode = account.config.triggerResponseMode ?? "dm";
      if (triggerResponseMode === "dm") {
        // Respond via DM to the sender (participant in group, or from in DM)
        triggerResponseChatId = resolveTriggerTarget(message);
        runtime.log?.(`waha: trigger activated in group ${chatId}, responding via DM to ${triggerResponseChatId}`);
      } else {
        // "reply-in-chat": respond in the same group chat
        runtime.log?.(`waha: trigger activated in group ${chatId}, responding in-chat`);
      }
    }
  }

  // Group whitelist: if allowedGroups is set, only respond in those groups
  // Trigger-word activation still respects allowedGroups — only configured groups accepted.
  if (isGroup) {
    const allowedGroups = account.config.allowedGroups;
    if (allowedGroups && allowedGroups.length > 0 && !allowedGroups.includes(chatId)) {
      runtime.log?.(`waha: drop group ${chatId} (not in allowedGroups)`);
      return;
    }
  }

  // Group keyword filter: silently drop group messages that don't match patterns
  // (enabled by default — getGroupFilter applies defaults internally)
  // SKIP for trigger-word messages — explicit invocation bypasses keyword filter.
  if (isGroup && !triggerActivated) {
    const groupFilter = getGroupFilter(config, account.accountId);
    const filterResult = groupFilter.check({
      text: rawBody,
      senderId,
      log: (msg) => runtime.log?.(msg),
    });
    if (!filterResult.pass) {
      return; // Silent drop
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
  const hasControlCommand = core.channel.text.hasControlCommand(effectiveBody, config as OpenClawConfig);

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

  // Extract sender's pushName from raw payload for directory tracking
  const senderPushName =
    (rawPayload as Record<string, unknown> | undefined)?.pushName as string | undefined
    ?? ((rawPayload as Record<string, unknown> | undefined)?._data as Record<string, unknown> | undefined)?.notifyName as string | undefined
    ?? (rawPayload as Record<string, unknown> | undefined)?.from_name as string | undefined
    ?? undefined;

  // Track contact in directory (fire-and-forget, errors non-fatal)
  try {
    const dirDb = getDirectoryDb(account.accountId);
    dirDb.upsertContact(senderId, senderPushName || undefined, isGroup);
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
            } catch (err) {
              console.warn(`[waha] invalid mentionPattern regex "${p}": ${String(err)}`);
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

  // Phase 4 Plan 02: When trigger is activated in DM mode, route response to sender's JID.
  // triggerResponseChatId is already set to resolveTriggerTarget(message) above.
  // In non-trigger context, triggerResponseChatId === chatId (unchanged). DO NOT REMOVE.
  const responseChatId = triggerResponseChatId;
  const responseChatIsGroup = isGroup && responseChatId === chatId; // DM-mode trigger routes to user, not group

  const route = core.channel.routing.resolveAgentRoute({
    cfg: config as OpenClawConfig,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: {
      kind: responseChatIsGroup ? "group" : "direct",
      id: responseChatId,
    },
  });

  const fromLabel = responseChatIsGroup ? `chat:${chatId}` : `user:${senderId}`;
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
    body: effectiveBody,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: effectiveBody,
    RawBody: effectiveBody,
    CommandBody: effectiveBody,
    From: responseChatIsGroup ? `waha:chat:${chatId}` : `waha:${senderId}`,
    To: `waha:${responseChatId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: responseChatIsGroup ? "group" : "direct",
    ConversationLabel: fromLabel,
    SenderName: undefined,
    SenderId: senderId,
    GroupSubject: responseChatIsGroup ? chatId : undefined,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    WasMentioned: undefined,
    MessageSid: message.messageId,
    Timestamp: message.timestamp,
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: `waha:${chatId}`,
    CommandAuthorized: access.commandAuthorized,
    // Phase 3 Plan 02: Include @mentioned JIDs so agent knows who was tagged
    ...(message.mentionedJids && message.mentionedJids.length > 0
      ? { MentionedJids: message.mentionedJids }
      : {}),
    ...mediaPayload,
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
  // Use responseChatId — for trigger DM mode, presence is shown in the DM, not the group.
  const presenceCtrl = await startHumanPresence({
    cfg: config as CoreConfig,
    chatId: responseChatId,
    messageId: message.messageId,
    incomingText: effectiveBody,
    accountId: account.accountId,
  });

  const deliverReply = createNormalizedOutboundDeliverer(async (payload) => {
    await deliverWahaReply({
      payload,
      chatId: responseChatId,
      accountId: account.accountId,
      statusSink,
      cfg: config as CoreConfig,
      presenceCtrl,
    });
  });

  try {
    await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg: config as OpenClawConfig,
      dispatcherOptions: {
        ...prefixOptions,
        deliver: deliverReply,
        onError: (err, info) => {
          // Cancel typing on error
          presenceCtrl.cancelTyping().catch(warnOnError(`inbound presence cancel-typing ${responseChatId}`));
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
  } finally {
    // Guarantee typing is stopped after dispatch — handles empty responses,
    // errors, and any path where deliverReply was never called
    await presenceCtrl.cancelTyping().catch(warnOnError(`inbound presence cancel-typing ${responseChatId}`));
    // Clean up image temp file after native pipeline has processed it
    if (mediaDownload) await mediaDownload.cleanup().catch(warnOnError("media cleanup"));
  }
}
