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
import { configureReliability } from "./http-client.js";
import { formatActionError } from "./error-formatter.js";
import { normalizeWahaAllowEntry, normalizeWahaMessagingTarget } from "./normalize.js";
import { getWahaRuntime } from "./runtime.js";
import {
  sendWahaMediaBatch, sendWahaImage, sendWahaVideo, sendWahaFile, sendWahaReaction, sendWahaText,
  // Rich messages
  sendWahaPoll, sendWahaPollVote, sendWahaLocation, sendWahaContactVcard,
  sendWahaList, forwardWahaMessage, sendWahaLinkPreview, sendWahaButtonsReply,
  // Message management
  editWahaMessage, deleteWahaMessage, pinWahaMessage, unpinWahaMessage, starWahaMessage,
  // Chat management
  getWahaChats, getWahaChatsOverview, getWahaChatMessages, getWahaChatMessage,
  deleteWahaChat, clearWahaChatMessages, archiveWahaChat, unarchiveWahaChat,
  unreadWahaChat, readWahaChatMessages, getWahaChatPicture,
  // Group admin
  createWahaGroup, getWahaGroups, getWahaGroup, deleteWahaGroup, leaveWahaGroup,
  setWahaGroupSubject, setWahaGroupDescription, setWahaGroupPicture, deleteWahaGroupPicture,
  getWahaGroupPicture, addWahaGroupParticipants, removeWahaGroupParticipants,
  promoteWahaGroupAdmin, demoteWahaGroupAdmin, getWahaGroupParticipants,
  setWahaGroupInfoAdminOnly, getWahaGroupInfoAdminOnly,
  setWahaGroupMessagesAdminOnly, getWahaGroupMessagesAdminOnly,
  getWahaGroupInviteCode, revokeWahaGroupInviteCode, joinWahaGroup, getWahaGroupsCount,
  // Contacts
  getWahaContacts, getWahaContact, checkWahaContactExists,
  getWahaContactAbout, getWahaContactPicture, blockWahaContact, unblockWahaContact,
  // Labels
  getWahaLabels, createWahaLabel, updateWahaLabel, deleteWahaLabel,
  getWahaChatLabels, setWahaChatLabels, getWahaChatsByLabel,
  // Status
  sendWahaTextStatus, sendWahaImageStatus, sendWahaVoiceStatus, sendWahaVideoStatus, deleteWahaStatus,
  // Channels
  getWahaChannels, createWahaChannel, getWahaChannel, deleteWahaChannel,
  followWahaChannel, unfollowWahaChannel, muteWahaChannel, unmuteWahaChannel,
  searchWahaChannelsByText, previewWahaChannelMessages,
  // Events
  sendWahaEvent,
  // Presence
  setWahaPresenceStatus, getWahaPresence, subscribeWahaPresence,
  // Profile
  getWahaProfile, setWahaProfileName, setWahaProfileStatus, setWahaProfilePicture, deleteWahaProfilePicture,
  // LID
  findWahaPhoneByLid, findWahaLidByPhone, getWahaAllLids,
  // Calls
  rejectWahaCall,
  // Name resolution
  resolveWahaTarget,
} from "./send.js";
import type { CoreConfig } from "./types.js";

// Cached config for outbound adapter — handleAction receives cfg as a param
// and caches it here so outbound methods (sendText, sendMedia, sendPoll) can
// access config without calling readConfigFile() which may crash.
let _cachedConfig: CoreConfig | null = null;
function getCachedConfig(): CoreConfig {
  if (_cachedConfig) return _cachedConfig;
  // Try SDK methods as fallback
  try {
    const rt = getWahaRuntime();
    if (typeof rt.config.readConfigFileSnapshot === "function") {
      return rt.config.readConfigFileSnapshot() as CoreConfig;
    }
    if (typeof rt.config.readConfigFile === "function") {
      return rt.config.readConfigFile() as CoreConfig;
    }
  } catch (sdkErr) {
    throw new Error(`WAHA config not available — no cached config and SDK methods failed: ${String(sdkErr)}`);
  }
  throw new Error("WAHA config not available — no cached config and no SDK config reader methods found on runtime");
}

const meta = {
  id: "waha",
  label: "WAHA",
  selectionLabel: "WAHA (WhatsApp HTTP API)",
  docsPath: "/channels/whatsapp",
  docsLabel: "whatsapp",
  blurb: "Self-hosted WhatsApp via WAHA webhooks + REST API bridge.",
  order: 70,
} as const;

// Action name → handler function map
const ACTION_HANDLERS: Record<string, (params: Record<string, unknown>, cfg: CoreConfig, accountId?: string) => Promise<unknown>> = {
  // Rich messages
  sendPoll: (p, cfg, aid) => sendWahaPoll({ cfg, chatId: String(p.chatId), name: String(p.name), options: p.options as string[], multipleAnswers: Boolean(p.multipleAnswers), replyToId: p.replyToId ? String(p.replyToId) : undefined, accountId: aid }),
  sendPollVote: (p, cfg, aid) => sendWahaPollVote({ cfg, chatId: String(p.chatId), pollMessageId: String(p.pollMessageId), votes: p.votes as string[], accountId: aid }),
  sendLocation: (p, cfg, aid) => sendWahaLocation({ cfg, chatId: String(p.chatId), latitude: Number(p.latitude), longitude: Number(p.longitude), title: String(p.title ?? ""), replyToId: p.replyToId ? String(p.replyToId) : undefined, accountId: aid }),
  sendContactVcard: (p, cfg, aid) => sendWahaContactVcard({ cfg, chatId: String(p.chatId), contacts: p.contacts as any[], replyToId: p.replyToId ? String(p.replyToId) : undefined, accountId: aid }),
  sendList: (p, cfg, aid) => sendWahaList({ cfg, chatId: String(p.chatId), title: String(p.title), description: String(p.description ?? ""), buttonText: String(p.buttonText ?? "Select"), sections: p.sections as any[], replyToId: p.replyToId ? String(p.replyToId) : undefined, accountId: aid }),
  forwardMessage: (p, cfg, aid) => forwardWahaMessage({ cfg, chatId: String(p.chatId), messageId: String(p.messageId), accountId: aid }),
  sendLinkPreview: (p, cfg, aid) => sendWahaLinkPreview({ cfg, chatId: String(p.chatId), url: String(p.url), title: String(p.title ?? ""), description: p.description ? String(p.description) : undefined, image: p.image ? String(p.image) : undefined, replyToId: p.replyToId ? String(p.replyToId) : undefined, accountId: aid }),
  sendButtonsReply: (p, cfg, aid) => sendWahaButtonsReply({ cfg, chatId: String(p.chatId), messageId: String(p.messageId), buttonId: String(p.buttonId), accountId: aid }),
  sendEvent: (p, cfg, aid) => sendWahaEvent({ cfg, chatId: String(p.chatId), name: String(p.name), startTime: Number(p.startTime), endTime: p.endTime != null ? Number(p.endTime) : undefined, description: p.description ? String(p.description) : undefined, location: p.location as any, extraGuestsAllowed: p.extraGuestsAllowed != null ? Boolean(p.extraGuestsAllowed) : undefined, replyToId: p.replyToId ? String(p.replyToId) : undefined, accountId: aid }),
  // Media sending — explicit type-specific actions for the agent
  // DO NOT CHANGE sendImage/sendVideo/sendFile to use sendWahaMediaBatch — they must call WAHA API directly.
  // sendWahaMediaBatch does MIME detection which re-routes the call based on content type.
  // When the agent says sendImage, it MUST go to /api/sendImage. Verified 2026-03-10.
  sendImage: (p, cfg, aid) => sendWahaImage({ cfg, chatId: String(p.chatId || p.to), file: String(p.image || p.url || p.file), caption: p.caption ? String(p.caption) : undefined, replyToId: p.replyToId ? String(p.replyToId) : undefined, accountId: aid }),
  sendVideo: (p, cfg, aid) => sendWahaVideo({ cfg, chatId: String(p.chatId || p.to), file: String(p.video || p.url || p.file), caption: p.caption ? String(p.caption) : undefined, replyToId: p.replyToId ? String(p.replyToId) : undefined, accountId: aid }),
  sendFile: (p, cfg, aid) => sendWahaFile({ cfg, chatId: String(p.chatId || p.to), file: String(p.file || p.url), caption: p.caption ? String(p.caption) : undefined, replyToId: p.replyToId ? String(p.replyToId) : undefined, accountId: aid }),
  // Message management
  editMessage: (p, cfg, aid) => editWahaMessage({ cfg, chatId: String(p.chatId), messageId: String(p.messageId), text: String(p.text), accountId: aid }),
  deleteMessage: (p, cfg, aid) => deleteWahaMessage({ cfg, chatId: String(p.chatId), messageId: String(p.messageId), accountId: aid }),
  pinMessage: (p, cfg, aid) => pinWahaMessage({ cfg, chatId: String(p.chatId), messageId: String(p.messageId), accountId: aid }),
  unpinMessage: (p, cfg, aid) => unpinWahaMessage({ cfg, chatId: String(p.chatId), messageId: String(p.messageId), accountId: aid }),
  starMessage: (p, cfg, aid) => starWahaMessage({ cfg, chatId: String(p.chatId), messageId: String(p.messageId), star: Boolean(p.star), accountId: aid }),
  // Chat management
  getChats: (p, cfg, aid) => getWahaChats({ cfg, accountId: aid }),
  getChatsOverview: (p, cfg, aid) => getWahaChatsOverview({ cfg, page: p.page != null ? Number(p.page) : undefined, limit: p.limit != null ? Number(p.limit) : undefined, accountId: aid }),
  getChatMessages: (p, cfg, aid) => getWahaChatMessages({ cfg, chatId: String(p.chatId), limit: p.limit != null ? Number(p.limit) : undefined, offset: p.offset != null ? Number(p.offset) : undefined, downloadMedia: p.downloadMedia != null ? Boolean(p.downloadMedia) : undefined, accountId: aid }),
  getChatMessage: (p, cfg, aid) => getWahaChatMessage({ cfg, chatId: String(p.chatId), messageId: String(p.messageId), accountId: aid }),
  deleteChat: (p, cfg, aid) => deleteWahaChat({ cfg, chatId: String(p.chatId), accountId: aid }),
  clearChatMessages: (p, cfg, aid) => clearWahaChatMessages({ cfg, chatId: String(p.chatId), accountId: aid }),
  archiveChat: (p, cfg, aid) => archiveWahaChat({ cfg, chatId: String(p.chatId), accountId: aid }),
  unarchiveChat: (p, cfg, aid) => unarchiveWahaChat({ cfg, chatId: String(p.chatId), accountId: aid }),
  unreadChat: (p, cfg, aid) => unreadWahaChat({ cfg, chatId: String(p.chatId), accountId: aid }),
  readChatMessages: (p, cfg, aid) => readWahaChatMessages({ cfg, chatId: String(p.chatId), accountId: aid }),
  getChatPicture: (p, cfg, aid) => getWahaChatPicture({ cfg, chatId: String(p.chatId), accountId: aid }),
  // Group admin
  createGroup: (p, cfg, aid) => createWahaGroup({ cfg, name: String(p.name), participants: p.participants as string[], accountId: aid }),
  getGroups: (p, cfg, aid) => getWahaGroups({ cfg, accountId: aid }),
  getGroup: (p, cfg, aid) => getWahaGroup({ cfg, groupId: String(p.groupId), accountId: aid }),
  deleteGroup: (p, cfg, aid) => deleteWahaGroup({ cfg, groupId: String(p.groupId), accountId: aid }),
  leaveGroup: (p, cfg, aid) => leaveWahaGroup({ cfg, groupId: String(p.groupId), accountId: aid }),
  setGroupSubject: (p, cfg, aid) => setWahaGroupSubject({ cfg, groupId: String(p.groupId), subject: String(p.subject), accountId: aid }),
  setGroupDescription: (p, cfg, aid) => setWahaGroupDescription({ cfg, groupId: String(p.groupId), description: String(p.description), accountId: aid }),
  setGroupPicture: (p, cfg, aid) => setWahaGroupPicture({ cfg, groupId: String(p.groupId), file: String(p.file), accountId: aid }),
  deleteGroupPicture: (p, cfg, aid) => deleteWahaGroupPicture({ cfg, groupId: String(p.groupId), accountId: aid }),
  getGroupPicture: (p, cfg, aid) => getWahaGroupPicture({ cfg, groupId: String(p.groupId), accountId: aid }),
  addParticipants: (p, cfg, aid) => addWahaGroupParticipants({ cfg, groupId: String(p.groupId), participants: p.participants as string[], accountId: aid }),
  removeParticipants: (p, cfg, aid) => removeWahaGroupParticipants({ cfg, groupId: String(p.groupId), participants: p.participants as string[], accountId: aid }),
  promoteToAdmin: (p, cfg, aid) => promoteWahaGroupAdmin({ cfg, groupId: String(p.groupId), participants: p.participants as string[], accountId: aid }),
  demoteFromAdmin: (p, cfg, aid) => demoteWahaGroupAdmin({ cfg, groupId: String(p.groupId), participants: p.participants as string[], accountId: aid }),
  getParticipants: (p, cfg, aid) => getWahaGroupParticipants({ cfg, groupId: String(p.groupId), accountId: aid }),
  setInfoAdminOnly: (p, cfg, aid) => setWahaGroupInfoAdminOnly({ cfg, groupId: String(p.groupId), adminOnly: Boolean(p.adminOnly), accountId: aid }),
  getInfoAdminOnly: (p, cfg, aid) => getWahaGroupInfoAdminOnly({ cfg, groupId: String(p.groupId), accountId: aid }),
  setMessagesAdminOnly: (p, cfg, aid) => setWahaGroupMessagesAdminOnly({ cfg, groupId: String(p.groupId), adminOnly: Boolean(p.adminOnly), accountId: aid }),
  getMessagesAdminOnly: (p, cfg, aid) => getWahaGroupMessagesAdminOnly({ cfg, groupId: String(p.groupId), accountId: aid }),
  getInviteCode: (p, cfg, aid) => getWahaGroupInviteCode({ cfg, groupId: String(p.groupId), accountId: aid }),
  revokeInviteCode: (p, cfg, aid) => revokeWahaGroupInviteCode({ cfg, groupId: String(p.groupId), accountId: aid }),
  joinGroup: (p, cfg, aid) => joinWahaGroup({ cfg, inviteCode: String(p.inviteCode), accountId: aid }),
  getGroupsCount: (p, cfg, aid) => getWahaGroupsCount({ cfg, accountId: aid }),
  // Contacts
  getContacts: (p, cfg, aid) => getWahaContacts({ cfg, accountId: aid }),
  getContact: (p, cfg, aid) => getWahaContact({ cfg, contactId: String(p.contactId), accountId: aid }),
  checkContactExists: (p, cfg, aid) => checkWahaContactExists({ cfg, phone: String(p.phone), accountId: aid }),
  getContactAbout: (p, cfg, aid) => getWahaContactAbout({ cfg, contactId: String(p.contactId), accountId: aid }),
  getContactPicture: (p, cfg, aid) => getWahaContactPicture({ cfg, contactId: String(p.contactId), accountId: aid }),
  blockContact: (p, cfg, aid) => blockWahaContact({ cfg, contactId: String(p.contactId), accountId: aid }),
  unblockContact: (p, cfg, aid) => unblockWahaContact({ cfg, contactId: String(p.contactId), accountId: aid }),
  // Labels
  getLabels: (p, cfg, aid) => getWahaLabels({ cfg, accountId: aid }),
  createLabel: (p, cfg, aid) => createWahaLabel({ cfg, name: String(p.name), color: p.color != null ? Number(p.color) : undefined, accountId: aid }),
  updateLabel: (p, cfg, aid) => updateWahaLabel({ cfg, labelId: String(p.labelId), name: p.name ? String(p.name) : undefined, color: p.color != null ? Number(p.color) : undefined, accountId: aid }),
  deleteLabel: (p, cfg, aid) => deleteWahaLabel({ cfg, labelId: String(p.labelId), accountId: aid }),
  getChatLabels: (p, cfg, aid) => getWahaChatLabels({ cfg, chatId: String(p.chatId), accountId: aid }),
  setChatLabels: (p, cfg, aid) => setWahaChatLabels({ cfg, chatId: String(p.chatId), labels: p.labels as Array<{ id: string }>, accountId: aid }),
  getChatsByLabel: (p, cfg, aid) => getWahaChatsByLabel({ cfg, labelId: String(p.labelId), accountId: aid }),
  // Status
  sendTextStatus: (p, cfg, aid) => sendWahaTextStatus({ cfg, text: String(p.text), backgroundColor: p.backgroundColor ? String(p.backgroundColor) : undefined, font: p.font != null ? Number(p.font) : undefined, accountId: aid }),
  sendImageStatus: (p, cfg, aid) => sendWahaImageStatus({ cfg, image: String(p.image), caption: p.caption ? String(p.caption) : undefined, accountId: aid }),
  sendVoiceStatus: (p, cfg, aid) => sendWahaVoiceStatus({ cfg, voice: String(p.voice), accountId: aid }),
  sendVideoStatus: (p, cfg, aid) => sendWahaVideoStatus({ cfg, video: String(p.video), caption: p.caption ? String(p.caption) : undefined, accountId: aid }),
  deleteStatus: (p, cfg, aid) => deleteWahaStatus({ cfg, id: String(p.id), accountId: aid }),
  // Channels
  getChannels: (p, cfg, aid) => getWahaChannels({ cfg, accountId: aid }),
  createChannel: (p, cfg, aid) => createWahaChannel({ cfg, name: String(p.name), description: p.description ? String(p.description) : undefined, picture: p.picture ? String(p.picture) : undefined, accountId: aid }),
  getChannel: (p, cfg, aid) => getWahaChannel({ cfg, channelId: String(p.channelId), accountId: aid }),
  deleteChannel: (p, cfg, aid) => deleteWahaChannel({ cfg, channelId: String(p.channelId), accountId: aid }),
  followChannel: (p, cfg, aid) => followWahaChannel({ cfg, channelId: String(p.channelId), accountId: aid }),
  unfollowChannel: (p, cfg, aid) => unfollowWahaChannel({ cfg, channelId: String(p.channelId), accountId: aid }),
  muteChannel: (p, cfg, aid) => muteWahaChannel({ cfg, channelId: String(p.channelId), accountId: aid }),
  unmuteChannel: (p, cfg, aid) => unmuteWahaChannel({ cfg, channelId: String(p.channelId), accountId: aid }),
  searchChannelsByText: (p, cfg, aid) => searchWahaChannelsByText({ cfg, query: String(p.query), accountId: aid }),
  previewChannelMessages: (p, cfg, aid) => previewWahaChannelMessages({ cfg, channelId: String(p.channelId), accountId: aid }),
  // Presence
  setPresenceStatus: (p, cfg, aid) => setWahaPresenceStatus({ cfg, status: p.status as "online" | "offline", accountId: aid }),
  getPresence: (p, cfg, aid) => getWahaPresence({ cfg, contactId: String(p.contactId), accountId: aid }),
  subscribePresence: (p, cfg, aid) => subscribeWahaPresence({ cfg, contactId: String(p.contactId), accountId: aid }),
  // Profile
  getProfile: (p, cfg, aid) => getWahaProfile({ cfg, accountId: aid }),
  setProfileName: (p, cfg, aid) => setWahaProfileName({ cfg, name: String(p.name), accountId: aid }),
  setProfileStatus: (p, cfg, aid) => setWahaProfileStatus({ cfg, status: String(p.status), accountId: aid }),
  setProfilePicture: (p, cfg, aid) => setWahaProfilePicture({ cfg, file: String(p.file), accountId: aid }),
  deleteProfilePicture: (p, cfg, aid) => deleteWahaProfilePicture({ cfg, accountId: aid }),
  // LID
  findPhoneByLid: (p, cfg, aid) => findWahaPhoneByLid({ cfg, lid: String(p.lid), accountId: aid }),
  findLidByPhone: (p, cfg, aid) => findWahaLidByPhone({ cfg, phone: String(p.phone), accountId: aid }),
  getAllLids: (p, cfg, aid) => getWahaAllLids({ cfg, accountId: aid }),
  // Calls
  rejectCall: (p, cfg, aid) => rejectWahaCall({ cfg, callId: String(p.callId), accountId: aid }),
  // ── resolveTarget — DO NOT CHANGE / DO NOT REMOVE ────────────────────
  // Fuzzy name-to-JID resolver. The ONLY way agents can resolve human-readable
  // names to WhatsApp JIDs. Removing this breaks all name-based targeting.
  // Added: 2026-03-10
  resolveTarget: (p, cfg, aid) => resolveWahaTarget({ cfg, query: String(p.query ?? ""), type: (p.type as "group" | "contact" | "channel" | "auto") ?? "auto", accountId: aid }),
  // ── search — DO NOT CHANGE / DO NOT REMOVE ─────────────────────────
  // Gateway-recognized action name (mode "none" in MESSAGE_ACTION_TARGET_MODE).
  // Wraps resolveWahaTarget for listing/searching groups, contacts, channels.
  //
  // WHY THIS EXISTS:
  // Utility actions (getGroups, resolveTarget, etc.) fail when the LLM passes
  // a target — the gateway hardcodes MESSAGE_ACTION_TARGET_MODE and rejects
  // mode "none" actions that have targets with "does not accept a target" error.
  // The name "search" makes the LLM naturally put queries in PARAMETERS (not
  // as a target), solving the rejection issue without any core gateway changes.
  //
  // Verified: 2026-03-11 — "list all Hebrew groups" works via Sammie
  // Added: 2026-03-11
  search: (p, cfg, aid) => resolveWahaTarget({
    cfg,
    query: String(p.query ?? ""),
    type: (p.scope as "group" | "contact" | "channel" | "auto") ?? (p.type as "group" | "contact" | "channel" | "auto") ?? "auto",
    accountId: aid,
  }),
};

// ======================================================================
// VERIFIED WORKING -- DO NOT MODIFY WITHOUT READING THIS
//
// These action names MUST match OpenClaw gateway's
// MESSAGE_ACTION_TARGET_MODE registry (in compact-*.js).
// Custom WAHA names (sendPoll, editMessage, etc.) are REJECTED
// by the gateway with "Action X does not accept a target" error.
//
// Only these standard names support target resolution:
//   send, poll, react, edit, unsend, pin, unpin, read, delete, reply
//
// handleAction() below maps these standard names to WAHA API calls.
// Last verified: 2026-03-10 -- all 7/8 actions PASS (sendEvent=NOWEB)
//
// If you change these names, the gateway will silently reject them.
// See: docs/integrations/OPENCLAW_LESSONS_LEARNED.md
// ======================================================================
const STANDARD_ACTIONS = ["send", "poll", "react", "edit", "unsend", "pin", "unpin", "read", "delete", "reply"];

// Utility actions don't need target resolution. They are exposed to the LLM
// as available tools. Keep this list curated -- too many actions overwhelm the
// model's context and degrade response quality. Each action here costs ~50 tokens.
const UTILITY_ACTIONS = [
  "search", // DO NOT REMOVE — gateway-recognized name for listing/searching. See search handler above.
  "getGroups", "getGroup", "getGroupsCount", "getParticipants",
  "getContacts", "getContact", "checkContactExists",
  "getChatsOverview", "getChats", "getChatMessages",
  "getProfile", "getLabels", "getChannels",
  "getPresence", "findPhoneByLid", "findLidByPhone", "getAllLids",
  "createGroup", "sendEvent", "sendLocation", "sendContactVcard",
  "sendTextStatus", "sendImageStatus",
  "sendImage", "sendVideo", "sendFile",
  "joinGroup", "followChannel", "unfollowChannel",
  "resolveTarget",
];

// DO NOT change back to ALL_ACTIONS. That was the v1.8.x bug.
// Only EXPOSED_ACTIONS (standard + curated utility) should be returned by listActions().
const EXPOSED_ACTIONS = [...STANDARD_ACTIONS, ...UTILITY_ACTIONS];

// Resolve chatId from gateway target resolution params
function resolveChatId(params: Record<string, unknown>, toolContext?: { currentChannelId?: string }): string {
  if (typeof params.chatId === "string" && params.chatId) {
    return params.chatId;
  }
  if (typeof params.to === "string" && params.to) {
    return params.to;
  }
  return toolContext?.currentChannelId ?? "";
}

// ╔══════════════════════════════════════════════════════════════════════╗
// ║  autoResolveTarget — DO NOT CHANGE / DO NOT REMOVE                 ║
// ║                                                                    ║
// ║  Auto-resolves human-readable names to WhatsApp JIDs.              ║
// ║  Called by standard action handlers (send, poll, etc.) when the    ║
// ║  chatId doesn't look like a JID or phone number.                  ║
// ║  This is what allows "send hello to sammie test group" to work.   ║
// ║                                                                    ║
// ║  Added: 2026-03-10                                                 ║
// ╚══════════════════════════════════════════════════════════════════════╝
const JID_RE = /@(c\.us|g\.us|lid|s\.whatsapp\.net|newsletter|broadcast)$/i;
const PHONE_RE = /^\+?\d{6,}$/;
const AUTO_RESOLVE_MIN_CONFIDENCE = 0.7;

async function autoResolveTarget(chatId: string, cfg: CoreConfig, accountId?: string): Promise<string> {
  // Already a JID or phone number — pass through unchanged
  if (JID_RE.test(chatId) || PHONE_RE.test(chatId)) return chatId;

  // Try to resolve as a human-readable name
  const resolved = await resolveWahaTarget({ cfg, query: chatId, type: "auto", accountId });
  if (resolved.matches.length === 0) {
    throw new Error(`Could not resolve "${chatId}" to a WhatsApp JID. No matches found. Use a JID (e.g. 120363...@g.us) or phone number.`);
  }
  // Single high-confidence match — use it
  if (resolved.matches[0].confidence >= AUTO_RESOLVE_MIN_CONFIDENCE) {
    return resolved.matches[0].jid;
  }
  // Low confidence — report what we found
  const summary = resolved.matches.slice(0, 5).map(m => `${m.name} (${m.jid})`).join(", ");
  throw new Error(`Ambiguous target "${chatId}". Possible matches: ${summary}. Please specify the exact JID.`);
}

const wahaMessageActions: ChannelMessageActionAdapter = {
  listActions: () => EXPOSED_ACTIONS, // !!! DO NOT CHANGE to ALL_ACTIONS -- breaks gateway target resolution
  supportsAction: ({ action }) => EXPOSED_ACTIONS.includes(action) || action in ACTION_HANDLERS,
  handleAction: async ({ action, params, cfg, accountId, toolContext }) => {
    const p = params as Record<string, unknown>;
    const coreCfg = cfg as CoreConfig;
    const aid = accountId ?? undefined;

    // Cache config for outbound adapter (sendText/sendMedia/sendPoll)
    _cachedConfig = coreCfg;

    // Extract target for error formatting — DO NOT CHANGE
    // formatActionError wraps all action errors with LLM-friendly messages.
    // Added Phase 2, Plan 01 (2026-03-11).
    const target = typeof p.to === "string" ? p.to : (typeof p.chatId === "string" ? p.chatId : undefined);

    try {

    // --- Standard targeted actions (gateway-recognized names) ---

    if (action === "react") {
      const messageId = typeof p.messageId === "string" ? p.messageId : "";
      const emojiRaw = typeof p.emoji === "string" ? p.emoji : "";
      const remove = p.remove === true;
      if (!messageId) throw new Error("WAHA react requires messageId");
      if (!emojiRaw && !remove) throw new Error("WAHA react requires emoji");

      await sendWahaReaction({ cfg: coreCfg, messageId, emoji: emojiRaw, remove, accountId: aid });

      return {
        content: [{ type: "text" as const, text: remove ? `Removed reaction from ${messageId}` : `Reacted with ${emojiRaw} on ${messageId}` }],
        details: {},
      };
    }

    // -- VERIFIED WORKING 2026-03-10 (19s response time) ----------
    // Poll uses sendWahaPoll. chatId resolved via 3-source fallback:
    //   1. params.to  2. params.chatId  3. toolContext.currentChannelId
    // The poll:{} wrapper is required by WAHA API.
    if (action === "poll") {
      let chatId = resolveChatId(p, toolContext);
      if (chatId) chatId = await autoResolveTarget(chatId, coreCfg, aid);
      const question = typeof p.pollQuestion === "string" ? p.pollQuestion : (typeof p.name === "string" ? p.name : "");
      const options = Array.isArray(p.pollOption) ? p.pollOption as string[] : (Array.isArray(p.options) ? p.options as string[] : []);
      const multipleAnswers = Boolean(p.multipleAnswers);
      if (!chatId) throw new Error("poll action requires chatId (resolved from target)");
      if (!question) throw new Error("poll action requires pollQuestion");
      if (!options.length) throw new Error("poll action requires pollOption (array of strings)");

      const result = await sendWahaPoll({ cfg: coreCfg, chatId, name: question, options, multipleAnswers, accountId: aid });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} };
    }

    // -- VERIFIED WORKING 2026-03-10 ------------------------------
    // Send DM uses sendWahaText with chatId from target resolution.
    // Target can come from: params.to, params.chatId, or toolContext.currentChannelId
    if (action === "send" || action === "reply") {
      let chatId = resolveChatId(p, toolContext);
      if (chatId) chatId = await autoResolveTarget(chatId, coreCfg, aid);

      // Handle contact card (vcard) when contacts param is present
      // Routes through "send" action to leverage gateway target resolution
      // (sendContactVcard custom action has mode "none" and cannot accept targets)
      // Added 2026-03-10 -- DO NOT REMOVE
      if (p.contacts && Array.isArray(p.contacts)) {
        if (!chatId) throw new Error("send action with contacts requires chatId (resolved from target)");
        const result = await sendWahaContactVcard({
          cfg: coreCfg,
          chatId,
          contacts: p.contacts as any[],
          replyToId: typeof p.replyToId === "string" ? p.replyToId : undefined,
          accountId: aid,
        });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} };
      }

      const text = typeof p.text === "string" ? p.text : (typeof p.message === "string" ? p.message : "");
      const replyToId = typeof p.replyToId === "string" ? p.replyToId : undefined;
      if (!chatId) throw new Error("send action requires chatId (resolved from target)");
      if (!text) throw new Error("send action requires text");

      const result = await sendWahaText({ cfg: coreCfg, to: chatId, text, replyToId, accountId: aid });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} };
    }

    // -- VERIFIED WORKING 2026-03-10 ------------------------------
    // Edit requires full serialized message ID: "true_<chatId>_<shortId>"
    // The LLM gets this from webhook payloads. Don't try to construct it.
    if (action === "edit") {
      let chatId = resolveChatId(p, toolContext);
      if (chatId) chatId = await autoResolveTarget(chatId, coreCfg, aid);
      const messageId = typeof p.messageId === "string" ? p.messageId : "";
      const text = typeof p.text === "string" ? p.text : "";
      if (!chatId || !messageId || !text) throw new Error("edit action requires chatId, messageId, and text");

      const result = await editWahaMessage({ cfg: coreCfg, chatId, messageId, text, accountId: aid });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} };
    }

    // -- VERIFIED WORKING 2026-03-10 ------------------------------
    // Unsend/delete also requires full serialized message ID format.
    // WAHA returns protocolMessage type "REVOKE" on success.
    if (action === "unsend" || action === "delete") {
      let chatId = resolveChatId(p, toolContext);
      if (chatId) chatId = await autoResolveTarget(chatId, coreCfg, aid);
      const messageId = typeof p.messageId === "string" ? p.messageId : "";
      if (!chatId || !messageId) throw new Error("unsend action requires chatId and messageId");

      const result = await deleteWahaMessage({ cfg: coreCfg, chatId, messageId, accountId: aid });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} };
    }

    if (action === "pin") {
      let chatId = resolveChatId(p, toolContext);
      if (chatId) chatId = await autoResolveTarget(chatId, coreCfg, aid);
      const messageId = typeof p.messageId === "string" ? p.messageId : "";
      if (!chatId || !messageId) throw new Error("pin action requires chatId and messageId");

      const result = await pinWahaMessage({ cfg: coreCfg, chatId, messageId, accountId: aid });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} };
    }

    if (action === "unpin") {
      let chatId = resolveChatId(p, toolContext);
      if (chatId) chatId = await autoResolveTarget(chatId, coreCfg, aid);
      const messageId = typeof p.messageId === "string" ? p.messageId : "";
      if (!chatId || !messageId) throw new Error("unpin action requires chatId and messageId");

      const result = await unpinWahaMessage({ cfg: coreCfg, chatId, messageId, accountId: aid });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} };
    }

    if (action === "read") {
      let chatId = resolveChatId(p, toolContext);
      if (chatId) chatId = await autoResolveTarget(chatId, coreCfg, aid);
      if (!chatId) throw new Error("read action requires chatId");

      const result = await readWahaChatMessages({ cfg: coreCfg, chatId, accountId: aid });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} };
    }

    // --- Fallback: custom WAHA action names (utility actions + backward compat) ---
    const handler = ACTION_HANDLERS[action];
    if (!handler) throw new Error(`WAHA action "${action}" not supported`);
    const result = await handler(p, coreCfg, aid);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      details: {},
    };

    } catch (err) {
      // Outer error handler — formats all action errors for LLM consumption.
      // DO NOT CHANGE — all action errors must flow through formatActionError.
      // Added Phase 2, Plan 01 (2026-03-11).
      return {
        content: [{ type: "text" as const, text: formatActionError(err, { action, target }) }],
        isError: true,
      };
    }
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
  messaging: {
    // Strips waha:/whatsapp:/chat: prefixes that OpenClaw may prepend.
    // Without this, targets like "waha:120363@g.us" fail at WAHA API level.
    normalizeTarget: (raw: string) => {
      const trimmed = raw.trim().replace(/^(waha|whatsapp|chat):/i, "");
      return trimmed || undefined;
    },
    // targetResolver is CRITICAL for action routing. Without it, the gateway
    // throws "Unknown target" for JID-format targets (@c.us, @g.us, @lid, etc.)
    // Added in v1.8.0 -- verified working. DO NOT REMOVE.
    targetResolver: {
      looksLikeId: (raw: string) => {
        const trimmed = raw.trim();
        if (!trimmed) return false;
        // Accept JIDs, phone numbers, AND human-readable names
        // Non-JID names will be auto-resolved in handleAction via autoResolveTarget
        // Changed 2026-03-10 — DO NOT revert to JID-only matching
        return true;
      },
      hint: "Use a WhatsApp JID (e.g. 123456@c.us, 120363...@g.us), a phone number, or a group/contact name",
    },
  },
  actions: wahaMessageActions,
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
        cfg: getCachedConfig(),
        to: normalizeWahaMessagingTarget(to),
        text,
        replyToId: replyToId ?? undefined,
        accountId: accountId ?? undefined,
      });
      return { channel: "waha", ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, replyToId }) => {
      await sendWahaMediaBatch({
        cfg: getCachedConfig(),
        to: normalizeWahaMessagingTarget(to),
        mediaUrls: mediaUrl ? [mediaUrl] : [],
        caption: text,
        replyToId: replyToId ?? undefined,
        accountId: accountId ?? undefined,
      });
      return { channel: "waha", ok: true } as const;
    },
    sendPoll: async ({ to, poll, accountId }) => {
      const result = await sendWahaPoll({
        cfg: getCachedConfig(),
        chatId: normalizeWahaMessagingTarget(to),
        name: poll.question,
        options: poll.options,
        multipleAnswers: (poll.maxSelections ?? 1) > 1,
        accountId: accountId ?? undefined,
      });
      return { messageId: (result as any)?.key?.id ?? "", channelId: "waha" };
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

      // Wire reliability config from plugin settings to http-client module.
      // DO NOT REMOVE — configureReliability() sets timeout and rate limiter defaults.
      // Added Phase 1 gap closure (2026-03-11).
      configureReliability({
        timeoutMs: account.config.timeoutMs,
        capacity: account.config.rateLimitCapacity,
        refillRate: account.config.rateLimitRefillRate,
      });

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
