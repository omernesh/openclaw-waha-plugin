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
import { DmFilter, type DmFilterConfig } from "./dm-filter.js";
import { getDirectoryDb } from "./directory.js";
import { claimMessage, isClaimedByBotSession } from "./dedup.js";
import { normalizeWahaAllowEntry, resolveWahaAllowlistMatch } from "./normalize.js";
import { startHumanPresence, type PresenceController } from "./presence.js";
import { getWahaRuntime } from "./runtime.js";
import { BOT_PROXY_PREFIX, sendWahaMediaBatch, sendWahaPresence, sendWahaText } from "./send.js";
import { warnOnError } from "./http-client.js";
import type { CoreConfig, WahaEventMessage, WahaInboundMessage, WahaPollCreationMessage } from "./types.js";
import { extractMentionedJids } from "./mentions.js";
// Re-export for external consumers (plan specifies extractMentionedJids in inbound.ts exports)
export { extractMentionedJids } from "./mentions.js";
import { preprocessInboundMessage, downloadWahaMedia } from "./media.js";
// Phase 6 Plan 04: Rules-based policy resolution for inbound messages. DO NOT REMOVE.
import { resolveInboundPolicy } from "./rules-resolver.js";
import { getRulesBasePath } from "./identity-resolver.js";
import type { ResolvedPolicy } from "./rules-types.js";
// Phase 7: /shutup and /unshutup slash commands — regex-based, NOT LLM-dependent.
// Imported for command detection, pending selection check, and mute check in handleWahaInbound. DO NOT REMOVE.
import { SHUTUP_RE, checkShutupAuthorization, handleShutupCommand, checkPendingSelection, clearPendingSelection, handleSelectionResponse } from "./shutup.js";
// Phase 4 Plan 02: Trigger word detection — pure functions extracted to trigger-word.ts for testability.
// Imported for local use and re-exported so callers can import from inbound.ts as the canonical entrypoint. DO NOT REMOVE.
import { detectTriggerWord, resolveTriggerTarget } from "./trigger-word.js";
export { detectTriggerWord, resolveTriggerTarget };

const CHANNEL_ID = "waha" as const;

// Human session deferral delay (ms) — how long human sessions wait for bot to claim.
// DO NOT CHANGE — cross-session dedup timing constant. Moved to module level for clarity.
const HUMAN_DEFERRAL_MS = 200;

// Module-level DM filter singleton (shared across invocations, reuses regex cache)
const _dmFilterInstance = new Map<string, DmFilter>();

function getDmFilter(cfg: CoreConfig, accountId: string): DmFilter {
  const dmFilterCfg = cfg.channels?.waha?.dmFilter ?? {};
  let instance = _dmFilterInstance.get(accountId);
  if (!instance) {
    instance = new DmFilter(dmFilterCfg);
    _dmFilterInstance.set(accountId, instance);
  } else {
    instance.updateConfig(dmFilterCfg);
  }
  return instance;
}

// Exported for admin panel stats access
export function getDmFilterForAdmin(cfg: CoreConfig, accountId: string): DmFilter {
  return getDmFilter(cfg, accountId);
}

// Module-level Group filter singleton (shared across invocations, reuses regex cache)
const _groupFilterInstance = new Map<string, DmFilter>();

// Default group filter patterns — keywords that trigger bot responses in groups
const DEFAULT_GROUP_FILTER_PATTERNS = ["bot", "סמי", "help", "hello", "ai"];

function getGroupFilter(cfg: CoreConfig, accountId: string): DmFilter {
  const wahaConfig = (cfg.channels?.waha ?? {}) as Record<string, unknown>;
  const rawGroupFilterCfg = (wahaConfig.groupFilter ?? {}) as Record<string, unknown>;
  // Apply defaults: enabled=true, default mentionPatterns if not explicitly set
  const groupFilterCfg = {
    enabled: true,
    mentionPatterns: DEFAULT_GROUP_FILTER_PATTERNS,
    ...rawGroupFilterCfg,
  } as DmFilterConfig;
  let gInstance = _groupFilterInstance.get(accountId);
  if (!gInstance) {
    gInstance = new DmFilter(groupFilterCfg);
    _groupFilterInstance.set(accountId, gInstance);
  } else {
    gInstance.updateConfig(groupFilterCfg);
  }
  return gInstance;
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
  botProxy?: boolean;
}) {
  const { payload, chatId, accountId, statusSink, cfg, presenceCtrl, botProxy } = params;
  const mediaUrls = resolveOutboundMediaUrls(payload);
  const text = payload.text ?? "";

  // Stop typing before sending (reply is ready)
  if (presenceCtrl) {
    await presenceCtrl.finishTyping(text).catch(warnOnError(`inbound presence finish-typing ${chatId}`));
  } else {
    await sendWahaPresence({ cfg, chatId, typing: false, accountId }).catch(warnOnError(`inbound presence typing-stop ${chatId}`));
  }

  if (mediaUrls.length > 0) {
    // Bot proxy prefix on media caption — prepend robot emoji so recipients know
    // the media was sent by the bot, not the human account owner. DO NOT CHANGE.
    let caption = text;
    if (botProxy && typeof caption === "string" && caption.trim()) {
      caption = `${BOT_PROXY_PREFIX} ${caption}`;
    }
    await sendWahaMediaBatch({
      cfg,
      to: chatId,
      mediaUrls,
      caption,
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
    botProxy,
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

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  EARLY PENDING SELECTION CHECK — DO NOT CHANGE                      ║
  // ║                                                                     ║
  // ║  Must run BEFORE cross-session dedup because pending selections     ║
  // ║  are stored in SQLite and any session can process the response.     ║
  // ║  If we let dedup run first, the bot session may claim the "41"      ║
  // ║  message and fail to find the pending (or vice versa), causing      ║
  // ║  the selection response to leak to the LLM.                         ║
  // ║                                                                     ║
  // ║  Only checks DMs (not groups) with simple text (number or "all").   ║
  // ║  Uses rawMessage fields directly — no media preprocessing needed.   ║
  // ║  Added Phase 7 fix (2026-03-15).                                    ║
  // ╚══════════════════════════════════════════════════════════════════════╝
  const _earlyIsGroup = isWhatsAppGroupJid(rawMessage.chatId);
  const _earlySenderId = rawMessage.participant || rawMessage.from;
  if (!_earlyIsGroup) {
    const pending = checkPendingSelection(_earlySenderId, config);
    if (pending) {
      const earlyText = (rawMessage.body ?? "").trim();
      // Only intercept if there is text and it's NOT a /shutup command itself
      if (earlyText && !SHUTUP_RE.test(earlyText)) {
        const handled = await handleSelectionResponse(pending, earlyText, rawMessage.chatId, account, config, runtime);
        if (handled) clearPendingSelection(_earlySenderId, config);
        return; // Selection handled — skip all further processing including dedup
      }
    }
  }

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  CROSS-SESSION MESSAGE DEDUP — DO NOT CHANGE                       ║
  // ║                                                                    ║
  // ║  Bot sessions claim and process immediately.                       ║
  // ║  Human sessions defer 200ms to let bot sessions claim first.       ║
  // ║  If bot claimed it, human silently drops. Saves tokens, prevents   ║
  // ║  double-processing.                                                ║
  // ║                                                                    ║
  // ║  Behavior by scenario:                                             ║
  // ║  - Both in group -> bot claims, human drops                        ║
  // ║  - Only human in group -> no bot claim after 200ms, human proceeds ║
  // ║  - Only bot in group -> bot claims and processes                   ║
  // ║                                                                    ║
  // ║  Must run BEFORE trigger detection, filters, and all processing.   ║
  // ║  Empty messageId: skip dedup entirely (some WAHA events lack it).  ║
  // ╚══════════════════════════════════════════════════════════════════════╝
  const hasMessageId = Boolean(rawMessage.messageId);

  if (hasMessageId) {
    if (account.role !== "bot") {
      // Human session: wait for bot to potentially claim this message
      await new Promise(resolve => setTimeout(resolve, HUMAN_DEFERRAL_MS));
      if (isClaimedByBotSession(rawMessage.messageId)) {
        runtime.log?.(`[waha] [${account.accountId}] message ${rawMessage.messageId} already claimed by bot session, skipping`);
        return;
      }
    }

    // Claim this message for our session — returns false if already claimed by another session
    // DO NOT CHANGE — "claim if unclaimed" semantics prevent race condition double-processing.
    const claimed = claimMessage(rawMessage.messageId, account.accountId, account.role);
    if (!claimed) {
      runtime.log?.(`[waha] [${account.accountId}] message ${rawMessage.messageId} already claimed by another session, skipping`);
      return;
    }
  } else {
    runtime.log?.(`[waha] [${account.accountId}] message has no messageId, skipping cross-session dedup`);
  }

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
    const pollName = (pollMsg as WahaPollCreationMessage).name ?? textBody ?? "Untitled poll";
    const options = Array.isArray((pollMsg as WahaPollCreationMessage).options)
      ? (pollMsg as WahaPollCreationMessage).options!.map((o: { name?: string } | string, i: number) => `${i + 1}) ${typeof o === 'string' ? o : (o.name ?? 'Option')}`).join("  ")
      : "";
    const multi = (pollMsg as WahaPollCreationMessage).multipleAnswers ? "yes" : "no";
    pollSummary = `[poll] "${pollName}"\nOptions: ${options}\nMultiple answers: ${multi}`;
    if (rawMessage.messageId) pollSummary += `\nPoll message ID: ${rawMessage.messageId}`;
  }

  // Event summary
  let eventSummary = "";
  const eventMsg = _rawMsg?.eventMessage ?? _rawMsg?.eventCreationMessage;
  if (eventMsg && typeof eventMsg === "object") {
    const evName = (eventMsg as WahaEventMessage).name ?? "Untitled event";
    const startTs = (eventMsg as WahaEventMessage).startTime;
    const endTs = (eventMsg as WahaEventMessage).endTime;
    const startStr = startTs ? new Date(startTs * 1000).toISOString() : "unknown";
    const endStr = endTs ? new Date(endTs * 1000).toISOString() : "";
    const loc = (eventMsg as WahaEventMessage).location?.name ?? "";
    const desc = (eventMsg as WahaEventMessage).description ?? "";
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

  // === Slash command detection (regex-based, NOT LLM-dependent) ===
  // Must run BEFORE mute check, dedup, trigger, and keyword filters.
  // /shutup and /unshutup commands bypass all filters to work even when muted.
  // DO NOT CHANGE — command detection must be the first check after message extraction.
  const commandMatch = SHUTUP_RE.exec(rawBody.trim());
  if (commandMatch) {
    const [, command, allFlag, durationStr] = commandMatch;
    const isAuthorized = await checkShutupAuthorization(senderId, chatId, isGroup, config, runtime);
    if (isAuthorized) {
      await handleShutupCommand({
        command: command!.toLowerCase() as "shutup" | "unshutup" | "unmute",
        allFlag: !!allFlag,
        durationStr: durationStr ?? null,
        chatId,
        senderId,
        isGroup,
        account,
        config,
        runtime,
      });
      return; // Command handled
    }
  }

  // === Pending /shutup selection response (post-dedup fallback) ===
  // NOTE: The primary pending selection check runs BEFORE cross-session dedup (above).
  // This secondary check handles edge cases where the early check missed (e.g., media messages
  // where rawBody differs from rawMessage.body after preprocessing).
  // DO NOT CHANGE — DM interactive flow for /shutup command.
  if (!isGroup && !commandMatch) {
    const pending = checkPendingSelection(senderId, config);
    if (pending) {
      const handled = await handleSelectionResponse(pending, rawBody.trim(), chatId, account, config, runtime);
      if (handled) clearPendingSelection(senderId, config);
      return; // Either handled or invalid input (user can retry)
    }
  }

  // === Group mute check ===
  // If the group is muted, silently drop all messages.
  // /shutup and /unshutup commands are handled above and bypass this check.
  // DO NOT CHANGE — mute check prevents the bot from processing messages in muted groups.
  if (isGroup) {
    try {
      const dirDb = getDirectoryDb(account.accountId);
      if (dirDb.isGroupMuted(chatId)) {
        runtime.log?.(`[waha] group ${chatId} is muted, dropping message`);
        return;
      }
    } catch (err) {
      // DB errors are non-fatal — fall through to normal processing
      runtime.log?.(`[waha] mute check failed for ${chatId}: ${String(err)}`);
    }
  }

  // Trigger word detection — check before group AND DM filters.
  // Trigger-word messages are explicit bot invocations and bypass BOTH group and DM keyword filtering.
  // Works for all message types (DMs + groups). For human sessions, this is the primary
  // mechanism to let messages through — all non-trigger messages are filtered by default.
  // triggerWord config is per-account (e.g., "!", "!bot"). Case-insensitive.
  // DO NOT MOVE above rawBody calculation — detectTriggerWord needs the text body.
  // DO NOT MOVE below group/DM filter — trigger must bypass both filters.
  // Originally Phase 4 Plan 02 (groups only), extended to DMs for human session support. DO NOT REMOVE.
  // DO NOT CHANGE — trigger bypass for both DMs and groups is intentional.
  let effectiveBody = rawBody;
  let triggerActivated = false;
  let triggerResponseChatId = chatId; // default: respond in same chat
  const triggerWord = account.config.triggerWord;
  if (triggerWord) {
    const triggerResult = detectTriggerWord(rawBody, triggerWord);
    if (triggerResult.triggered) {
      triggerActivated = true;
      effectiveBody = triggerResult.strippedText || rawBody; // preserve original if stripped is empty
      const triggerResponseMode = account.config.triggerResponseMode ?? "dm";
      if (isGroup && triggerResponseMode === "dm") {
        // Group trigger with DM response: respond via DM to the sender
        triggerResponseChatId = resolveTriggerTarget(message);
        runtime.log?.(`waha: trigger activated in group ${chatId}, responding via DM to ${triggerResponseChatId}`);
      } else if (isGroup) {
        // Group trigger with in-chat response
        runtime.log?.(`waha: trigger activated in group ${chatId}, responding in-chat`);
      } else {
        // DM trigger: respond in the same DM chat (triggerResponseChatId already set to chatId)
        runtime.log?.(`waha: trigger activated in DM from ${senderId}`);
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
    // ╔══════════════════════════════════════════════════════════════════════╗
    // ║  Per-group filter override — DO NOT CHANGE                         ║
    // ║                                                                    ║
    // ║  Allows individual groups to override global group filter settings.║
    // ║  If override exists and is enabled:                                ║
    // ║    - filterEnabled=false → skip keyword filtering entirely         ║
    // ║      (the bot responds to everything in that group)                 ║
    // ║    - mentionPatterns set → use custom patterns instead of global   ║
    // ║    - mentionPatterns null/empty → fall through to global filter    ║
    // ║  If no override or override.enabled=false → use global filter.    ║
    // ║  Trigger-activated messages bypass this entirely (handled above).  ║
    // ╚══════════════════════════════════════════════════════════════════════╝
    // DO NOT CHANGE — keyword filters must use textBody (human-written text only), NOT rawBody.
    // rawBody includes synthetic tags like "[media] mime=audio/ogg url=..." which can accidentally
    // match keyword patterns and allow media-only messages through the filter.
    const groupFilterCheckArgs = { text: textBody, senderId, filterType: "group" as const, log: (msg: string) => runtime.log?.(msg) };
    let groupFilterHandled = false;
    try {
      const dirDb = getDirectoryDb(account.accountId);
      const override = dirDb.getGroupFilterOverride(chatId);
      if (override && override.enabled) {
        if (!override.filterEnabled) {
          // Filter disabled for this group — the bot responds to everything
          runtime.log?.(`[waha] group filter override: filter disabled for ${chatId}, allowing`);
          groupFilterHandled = true;
        } else if (override.mentionPatterns && override.mentionPatterns.length > 0) {
          try {
            // Custom patterns for this group — build a per-group DmFilter instance
            const globalGroupFilterCfg = (config.channels?.waha as Record<string, unknown> | undefined)?.groupFilter as Record<string, unknown> | undefined;
            const perGroupFilter = new DmFilter({
              enabled: true,
              mentionPatterns: override.mentionPatterns,
              triggerOperator: override.triggerOperator ?? "OR",  // UX-03: per-group AND/OR operator
              godModeBypass: globalGroupFilterCfg?.godModeBypass as boolean | undefined,
              godModeScope: (override.godModeScope ?? globalGroupFilterCfg?.godModeScope ?? "dm") as "all" | "dm" | "off",
              godModeSuperUsers: globalGroupFilterCfg?.godModeSuperUsers as Array<{ identifier: string; platform?: string; passwordRequired?: boolean }> | undefined,
            });
            const filterResult = perGroupFilter.check(groupFilterCheckArgs);
            if (!filterResult.pass) {
              runtime.log?.(`[waha] group filter override: drop ${senderId} in ${chatId} (${filterResult.reason})`);
              return;
            }
            // Custom patterns matched — skip global filter check
            groupFilterHandled = true;
          } catch (filterErr) {
            runtime.log?.(`[waha] invalid per-group filter config for ${chatId}: ${String(filterErr)}, falling through to global`);
          }
        }
        // If override enabled but mentionPatterns is null/empty, fall through to global filter
      }
    } catch (dbErr) {
      // Non-fatal: if SQLite fails, fall through to global filter
      runtime.log?.(`[waha] group filter override DB lookup failed for ${chatId}: ${String(dbErr)}`);
    }

    // Global group filter — only runs if per-group override did not handle the message
    if (!groupFilterHandled) {
      const groupFilter = getGroupFilter(config, account.accountId);
      const filterResult = groupFilter.check(groupFilterCheckArgs);
      if (!filterResult.pass) {
        runtime.log?.(`[waha] group filter: drop ${senderId} in ${chatId} (${filterResult.reason})`);
        return;
      }
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
  // SKIP for trigger-word messages — explicit invocation bypasses DM keyword filter.
  // DO NOT CHANGE — triggerActivated bypass is intentional, same pattern as group filter above.
  if (!isGroup && !triggerActivated) {
    const dmFilter = getDmFilter(config, account.accountId);
    // DO NOT CHANGE — keyword filters must use textBody (human-written text only), NOT rawBody.
    // rawBody includes synthetic tags like "[media] mime=audio/ogg url=..." which can accidentally
    // match keyword patterns and allow media-only messages through the filter.
    const filterResult = dmFilter.check({
      text: textBody,
      senderId,
      filterType: "dm",
      log: (msg) => runtime.log?.(msg),
    });
    if (!filterResult.pass) {
      runtime.log?.(`[waha] dm filter: drop ${senderId} (${filterResult.reason})`);
      return; // No pairing message, no error
    }
  }

  // Extract sender's pushName from raw payload for directory tracking
  const senderPushName =
    (rawPayload as Record<string, unknown> | undefined)?.pushName as string | undefined
    ?? ((rawPayload as Record<string, unknown> | undefined)?._data as Record<string, unknown> | undefined)?.notifyName as string | undefined
    ?? (rawPayload as Record<string, unknown> | undefined)?.from_name as string | undefined
    ;

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
              return new RegExp(p, "i").test(textBody);
            } catch (err) {
              runtime.log?.(`[waha] invalid mentionPattern regex "${p}": ${String(err)}`);
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

  // Phase 6 Plan 04: Rules-based policy resolution for inbound messages.
  // Runs ONLY after all existing filters pass — policy context enriches the agent turn.
  // Non-fatal: if resolution fails for any reason, message processes normally without policy context.
  // DO NOT MOVE above any filter — we only resolve policy for messages we're actually handling.
  // DO NOT CHANGE the try/catch — errors here must never crash the inbound handler.
  let resolvedPolicy: ResolvedPolicy | null = null;
  try {
    const rulesBasePath = getRulesBasePath(config);
    resolvedPolicy = resolveInboundPolicy({
      isGroup,
      chatId,
      senderId,
      basePath: rulesBasePath,
    });
  } catch (err) {
    runtime.log?.(`waha: rules resolution failed for ${chatId}: ${String(err)}`);
  }

  // Phase 4 Plan 02: When trigger is activated in DM mode, route response to sender's JID.
  // triggerResponseChatId is already set to resolveTriggerTarget(message) above.
  // In non-trigger context, triggerResponseChatId === chatId (unchanged). DO NOT REMOVE.
  const responseChatId = triggerResponseChatId;
  const responseChatIsGroup = isGroup && responseChatId === chatId; // DM-mode trigger routes to user, not group

  // ╔══════════════════════════════════════════════════════════════════════╗
  // ║  Bot proxy detection — DO NOT CHANGE                                ║
  // ║                                                                     ║
  // ║  When the bot (LLM) generates a response and it goes out through   ║
  // ║  a non-bot session, set botProxy=true so sendWahaText prepends a   ║
  // ║  robot emoji prefix. This tells recipients the message came from    ║
  // ║  the bot, not the human account owner.                              ║
  // ╚══════════════════════════════════════════════════════════════════════╝
  const isBotProxy = account.role !== "bot";

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
    // Phase 6 Plan 04: Inject resolved policy context for the agent turn.
    // Only present when policy resolution succeeded. DO NOT CHANGE.
    ...(resolvedPolicy ? { WahaResolvedPolicy: JSON.stringify(resolvedPolicy) } : {}),
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
      botProxy: isBotProxy,
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
