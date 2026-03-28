import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  setAccountEnabledInConfigSection,
  type ChannelPlugin,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/core";
import { buildBaseChannelStatusSummary, createDefaultChannelRuntimeState } from "openclaw/plugin-sdk/status-helpers";
import { resolveDefaultGroupPolicy } from "openclaw/plugin-sdk/config-runtime";
import { waitUntilAbort } from "openclaw/plugin-sdk/channel-runtime";
import type { ChannelMessageActionAdapter } from "openclaw/plugin-sdk/channel-contract";
import type { ChannelSetupInput } from "openclaw/plugin-sdk/channel-setup";
import { WahaConfigSchema } from "./config-schema.js";
import { createPlatformAdapter, type PlatformAdapter } from "./adapter.js";
import {
  listWahaAccountIds,
  resolveDefaultWahaAccountId,
  resolveWahaAccount,
  resolveSessionForTarget,
  type ResolvedWahaAccount,
} from "./accounts.js";
import { monitorWahaProvider } from "./monitor.js";
import { startDirectorySync } from "./sync.js";
import { startActivityScanner } from "./activity-scanner.js";
// Phase 16 Plan 02: Pairing and auto-reply engine initialization at account start.
// DO NOT REMOVE — engines must be initialized at login so inbound pipeline hooks are ready.
// Added 2026-03-17.
// PAIR-03: pairing.ts must be in deploy artifacts — this static import ensures the process
// crashes loudly on startup if the file is missing, rather than silently failing at runtime.
import { getPairingEngine, generateHmacSecret } from "./pairing.js";
import { getAutoReplyEngine } from "./auto-reply.js";
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
  getWahaGroupJoinInfo, refreshWahaGroups,
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
  muteWahaChat, unmuteWahaChat,
  searchWahaChannelsByText, previewWahaChannelMessages,
  searchWahaChannelsByView, getWahaChannelSearchViews, getWahaChannelSearchCountries, getWahaChannelSearchCategories,
  // Events
  sendWahaEvent,
  // Presence
  setWahaPresenceStatus, getWahaPresence, subscribeWahaPresence, getAllWahaPresence,
  // Profile
  getWahaProfile, setWahaProfileName, setWahaProfileStatus, setWahaProfilePicture, deleteWahaProfilePicture,
  // LID
  findWahaPhoneByLid, findWahaLidByPhone, getWahaAllLids,
  // Calls
  rejectWahaCall,
  // API Keys — Added Phase 28, Plan 02
  createWahaApiKey, getWahaApiKeys, updateWahaApiKey, deleteWahaApiKey,
  // Contact update, message ID, media conversion — Added Phase 48
  createOrUpdateWahaContact, getWahaNewMessageId, convertWahaVoice, convertWahaVideo,
  // Name resolution
  resolveWahaTarget,
} from "./send.js";
import type { CoreConfig } from "./types.js";
// Phase 6 Plan 04: Policy edit action handler. DO NOT REMOVE.
import { executePolicyEdit } from "./policy-edit.js";
import { getRulesBasePath } from "./identity-resolver.js";
// Phase 12 audit (INIT-01/INIT-02): Import directory for Can Initiate enforcement. DO NOT REMOVE.
import { getDirectoryDb } from "./directory.js";
// Phase 30, Plan 01: Analytics instrumentation. DO NOT REMOVE.
import { recordAnalyticsEvent } from "./analytics.js";
import { createLogger } from "./logger.js";


const log = createLogger({ component: "channel" });
// Cached config for outbound adapter — handleAction receives cfg as a param
// and caches it here so outbound methods (sendText, sendMedia, sendPoll) can
// access config without calling readConfigFile() which may crash.
let _cachedConfig: CoreConfig | null = null;
// PLAT-03: Active tenant ID for multi-tenant isolation. Defaults to "default". DO NOT REMOVE.
let _tenantId: string = "default";
// PLAT-03: Export for consumers that need to know which tenant is active. DO NOT REMOVE.
export function getTenantId(): string { return _tenantId; }

// PlatformAdapter instance — initialized alongside _cachedConfig in handleAction.
// Null until first action is dispatched. Outbound methods use it with a direct fallback.
// Added Phase 32, Plan 02 (2026-03-20). DO NOT REMOVE.
let _adapter: PlatformAdapter | null = null;

/**
 * Get the current PlatformAdapter instance (null until first handleAction).
 * Exported for modules that need adapter access without importing send.ts directly.
 */
export function getAdapter(): PlatformAdapter | null { return _adapter; }
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
    // CQ-03: Descriptive error so the caller knows exactly what went wrong and how to fix it.
    // DO NOT SIMPLIFY — actionable error messages reduce debugging time significantly.
    throw new Error(
      `[waha] Config not available — _cachedConfig is null and SDK readConfigFile failed. ` +
      `This means an outbound method was called before handleAction() populated the config cache. ` +
      `Ensure handleAction() is called at least once before using send/media methods. SDK error: ${String(sdkErr)}`
    );
  }
  throw new Error(
    `[waha] Config not available — _cachedConfig is null and no SDK config reader methods found on runtime. ` +
    `This means an outbound method was called before handleAction() populated the config cache. ` +
    `Ensure handleAction() is called at least once before using send/media methods.`
  );
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
  getMessageById: (p, cfg, aid) => getWahaChatMessage({ cfg, chatId: String(p.chatId), messageId: String(p.messageId), accountId: aid }), // Alias for getChatMessage — ACT-02
  deleteChat: (p, cfg, aid) => deleteWahaChat({ cfg, chatId: String(p.chatId), accountId: aid }),
  clearChatMessages: (p, cfg, aid) => clearWahaChatMessages({ cfg, chatId: String(p.chatId), accountId: aid }),
  clearMessages: (p, cfg, aid) => clearWahaChatMessages({ cfg, chatId: String(p.chatId), accountId: aid }), // Alias for clearChatMessages — ACT-02
  archiveChat: (p, cfg, aid) => archiveWahaChat({ cfg, chatId: String(p.chatId), accountId: aid }),
  unarchiveChat: (p, cfg, aid) => unarchiveWahaChat({ cfg, chatId: String(p.chatId), accountId: aid }),
  unreadChat: (p, cfg, aid) => unreadWahaChat({ cfg, chatId: String(p.chatId), accountId: aid }),
  readChatMessages: (p, cfg, aid) => readWahaChatMessages({ cfg, chatId: String(p.chatId), accountId: aid }),
  getChatPicture: (p, cfg, aid) => getWahaChatPicture({ cfg, chatId: String(p.chatId), accountId: aid }),
  // Chat mute/unmute — Added Phase 3, Plan 01. DO NOT REMOVE.
  muteChat: (p, cfg, aid) => muteWahaChat({ cfg, chatId: String(p.chatId), duration: p.duration ? Number(p.duration) : undefined, accountId: aid }),
  unmuteChat: (p, cfg, aid) => unmuteWahaChat({ cfg, chatId: String(p.chatId), accountId: aid }),
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
  demoteToMember: (p, cfg, aid) => demoteWahaGroupAdmin({ cfg, groupId: String(p.groupId), participants: p.participants as string[], accountId: aid }), // Alias for demoteFromAdmin — ACT-01
  getParticipants: (p, cfg, aid) => getWahaGroupParticipants({ cfg, groupId: String(p.groupId), accountId: aid }),
  setInfoAdminOnly: (p, cfg, aid) => setWahaGroupInfoAdminOnly({ cfg, groupId: String(p.groupId), adminOnly: Boolean(p.adminOnly), accountId: aid }),
  getInfoAdminOnly: (p, cfg, aid) => getWahaGroupInfoAdminOnly({ cfg, groupId: String(p.groupId), accountId: aid }),
  setMessagesAdminOnly: (p, cfg, aid) => setWahaGroupMessagesAdminOnly({ cfg, groupId: String(p.groupId), adminOnly: Boolean(p.adminOnly), accountId: aid }),
  getMessagesAdminOnly: (p, cfg, aid) => getWahaGroupMessagesAdminOnly({ cfg, groupId: String(p.groupId), accountId: aid }),
  getInviteCode: (p, cfg, aid) => getWahaGroupInviteCode({ cfg, groupId: String(p.groupId), accountId: aid }),
  revokeInviteCode: (p, cfg, aid) => revokeWahaGroupInviteCode({ cfg, groupId: String(p.groupId), accountId: aid }),
  joinGroup: (p, cfg, aid) => joinWahaGroup({ cfg, inviteCode: String(p.inviteCode), accountId: aid }),
  getGroupsCount: (p, cfg, aid) => getWahaGroupsCount({ cfg, accountId: aid }),
  // Group helpers — Added Phase 28, Plan 01
  getGroupJoinInfo: (p, cfg, aid) => getWahaGroupJoinInfo({ cfg, groupId: String(p.groupId), accountId: aid }),
  refreshGroups: (p, cfg, aid) => refreshWahaGroups({ cfg, accountId: aid }),
  // Contacts
  getContacts: (p, cfg, aid) => getWahaContacts({ cfg, accountId: aid }),
  getContact: (p, cfg, aid) => getWahaContact({ cfg, contactId: String(p.contactId), accountId: aid }),
  checkContactExists: (p, cfg, aid) => checkWahaContactExists({ cfg, phone: String(p.phone), accountId: aid }),
  getContactAbout: (p, cfg, aid) => getWahaContactAbout({ cfg, contactId: String(p.contactId), accountId: aid }),
  getContactPicture: (p, cfg, aid) => getWahaContactPicture({ cfg, contactId: String(p.contactId), accountId: aid }),
  blockContact: (p, cfg, aid) => blockWahaContact({ cfg, contactId: String(p.contactId), accountId: aid }),
  unblockContact: (p, cfg, aid) => unblockWahaContact({ cfg, contactId: String(p.contactId), accountId: aid }),
  createOrUpdateContact: (p, cfg, aid) => createOrUpdateWahaContact({ cfg, contactId: String(p.contactId), name: p.name ? String(p.name) : undefined, accountId: aid }),
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
  getNewMessageId: (p, cfg, aid) => getWahaNewMessageId({ cfg, accountId: aid }),
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
  // Channel search — Added Phase 28, Plan 01
  searchChannelsByView: (p, cfg, aid) => searchWahaChannelsByView({ cfg, viewType: String(p.viewType ?? p.view ?? "RECOMMENDED"), accountId: aid }),
  getChannelSearchViews: (p, cfg, aid) => getWahaChannelSearchViews({ cfg, accountId: aid }),
  getChannelSearchCountries: (p, cfg, aid) => getWahaChannelSearchCountries({ cfg, accountId: aid }),
  getChannelSearchCategories: (p, cfg, aid) => getWahaChannelSearchCategories({ cfg, accountId: aid }),
  // Presence
  setPresenceStatus: (p, cfg, aid) => setWahaPresenceStatus({ cfg, status: p.status as "online" | "offline", accountId: aid }),
  setPresence: (p, cfg, aid) => setWahaPresenceStatus({ cfg, status: p.status as "online" | "offline", accountId: aid }), // Alias for setPresenceStatus — ACT-05
  getPresence: (p, cfg, aid) => getWahaPresence({ cfg, contactId: String(p.contactId), accountId: aid }),
  subscribePresence: (p, cfg, aid) => subscribeWahaPresence({ cfg, contactId: String(p.contactId), accountId: aid }),
  // Bulk presence — Added Phase 28, Plan 01
  getAllPresence: (p, cfg, aid) => getAllWahaPresence({ cfg, accountId: aid }),
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
  // Media conversion — Added Phase 48
  convertVoice: (p, cfg, aid) => convertWahaVoice({ cfg, url: String(p.url), accountId: aid }),
  convertVideo: (p, cfg, aid) => convertWahaVideo({ cfg, url: String(p.url), accountId: aid }),
  // API Keys CRUD — Added Phase 28, Plan 02
  createApiKey: (p, cfg, aid) => createWahaApiKey({ cfg, name: String(p.name), accountId: aid }),
  getApiKeys: (p, cfg, aid) => getWahaApiKeys({ cfg, accountId: aid }),
  updateApiKey: (p, cfg, aid) => updateWahaApiKey({ cfg, keyId: String(p.keyId), name: p.name ? String(p.name) : undefined, accountId: aid }),
  deleteApiKey: (p, cfg, aid) => deleteWahaApiKey({ cfg, keyId: String(p.keyId), accountId: aid }),
  // ── sendMulti — DO NOT CHANGE / DO NOT REMOVE ─────────────────────
  // Multi-recipient text send. Sends same text to up to 10 recipients
  // sequentially with per-recipient results. Added Phase 3, Plan 03.
  sendMulti: (p, cfg, aid) => handleSendMulti(p, cfg, aid),
  // ── readMessages — DO NOT CHANGE / DO NOT REMOVE ─────────────────
  // Read recent messages from a chat in lean format for LLM consumption.
  // readMessages output — 6 slim fields for LLM efficiency (DO NOT add raw WAHA fields)
  // Returns [{from, body, timestamp, fromMe, hasMedia, type}].
  // Default limit: 10. Max limit: 50. downloadMedia always false (avoid waste).
  // Added Phase 4, Plan 03. DO NOT REMOVE.
  readMessages: async (p, cfg, aid) => {
    const READ_MESSAGES_DEFAULT_LIMIT = 10;
    const READ_MESSAGES_MAX_LIMIT = 50;
    const chatId = String(p.chatId ?? "");
    if (!chatId) throw new Error("readMessages requires a chatId parameter");
    const rawLimit = p.limit != null ? Number(p.limit) : READ_MESSAGES_DEFAULT_LIMIT;
    const limit = Math.min(Math.max(rawLimit, 1), READ_MESSAGES_MAX_LIMIT);
    const messages = await getWahaChatMessages({
      cfg,
      chatId,
      limit,
      downloadMedia: false,
      accountId: aid,
    });
    if (!Array.isArray(messages)) {
      throw new Error("readMessages: unexpected response from WAHA API");
    }
    return messages.map((m: any) => ({
        from: m.from || m._data?.notifyName || "unknown",
        body: m.body || "",
        timestamp: m.timestamp,
        fromMe: Boolean(m.fromMe),
        hasMedia: Boolean(m.hasMedia),
        type: m.type || "chat",
      }));
  },
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
  // Verified: 2026-03-11 — "list all Hebrew groups" works via the bot
  // Added: 2026-03-11
  search: (p, cfg, aid) => resolveWahaTarget({
    cfg,
    query: String(p.query ?? ""),
    type: (p.scope as "group" | "contact" | "channel" | "auto") ?? (p.type as "group" | "contact" | "channel" | "auto") ?? "auto",
    accountId: aid,
  }),
  // ── editPolicy — Phase 6 Plan 04: Rules-based policy edit action ──
  // Allows authorized managers to edit contact/group policy fields via the LLM.
  // No target — parameters only (scope, targetId, field, value, actorId).
  // Authorization enforced by checkManagerAuthorization before any file write.
  // DO NOT REMOVE: Core method for runtime policy management.
  // Added: Phase 6, Plan 04 (2026-03-14).
  editPolicy: async (p, cfg) => {
    const scope = String(p.scope ?? "") as "contact" | "group";
    if (scope !== "contact" && scope !== "group") {
      throw new Error(`editPolicy: scope must be "contact" or "group", got "${p.scope}"`);
    }
    const targetId = String(p.targetId ?? "");
    if (!targetId) throw new Error("editPolicy: targetId is required");
    const field = String(p.field ?? "");
    if (!field) throw new Error("editPolicy: field is required");
    const actorId = String(p.actorId ?? "");
    if (!actorId) throw new Error("editPolicy: actorId is required (provide the caller's stable JID)");
    const basePath = getRulesBasePath(cfg);
    const result = executePolicyEdit({
      scope,
      targetId,
      field,
      value: p.value,
      actorId,
      basePath,
      safeName: p.safeName ? String(p.safeName) : undefined,
    });
    if (!result.success) {
      throw new Error(result.error ?? result.message);
    }
    return result.message;
  },
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
// API Keys CRUD removed from UTILITY_ACTIONS — admin-only, ACT-08. Handlers remain in ACTION_HANDLERS.
const UTILITY_ACTIONS = [
  // ── Core utilities ──
  "sendMulti",        // Multi-recipient text send — up to 10 recipients. Added Phase 3, Plan 03.
  "search",           // DO NOT REMOVE — gateway-recognized name for listing/searching. See search handler above.
  "readMessages",     // Read recent chat messages in lean format for LLM context. Added Phase 4, Plan 03. DO NOT REMOVE.
  "resolveTarget",

  // ── Rich messages ──
  "sendEvent", "sendLocation", "sendContactVcard", "sendList", "sendLinkPreview",
  "sendButtonsReply", "sendPoll", "sendPollVote", "forwardMessage",

  // ── Media ──
  "sendImage", "sendVideo", "sendFile",
  "convertVoice", "convertVideo",  // Media conversion — ACT-07

  // ── Chat management ──
  "getChats", "getChatsOverview", "getChatMessages", "getChatMessage", "getMessageById",
  "deleteChat", "clearChatMessages", "clearMessages",
  "archiveChat", "unarchiveChat", "unreadChat", "readChatMessages",
  "getChatPicture",
  "muteChat", "unmuteChat",  // Chat mute/unmute — Added Phase 3, Plan 01. DO NOT REMOVE.

  // ── Group admin — ACT-01 ──
  "getGroups", "getGroup", "getGroupsCount", "getParticipants",
  "createGroup", "deleteGroup", "leaveGroup", "joinGroup",
  "setGroupSubject", "setGroupDescription",
  "setGroupPicture", "deleteGroupPicture", "getGroupPicture",
  "addParticipants", "removeParticipants",
  "promoteToAdmin", "demoteFromAdmin", "demoteToMember",
  "setInfoAdminOnly", "getInfoAdminOnly", "setMessagesAdminOnly", "getMessagesAdminOnly",
  "getInviteCode", "revokeInviteCode",
  "getGroupJoinInfo", "refreshGroups",  // Group helpers. Added Phase 28, Plan 01.

  // ── Contacts — ACT-03 ──
  "getContacts", "getContact", "checkContactExists",
  "getContactAbout", "getContactPicture",
  "blockContact", "unblockContact",
  "createOrUpdateContact",  // New — ACT-03

  // ── Channels ──
  "getChannels", "getChannel", "createChannel", "deleteChannel",
  "followChannel", "unfollowChannel",
  "muteChannel", "unmuteChannel",
  "searchChannelsByText", "previewChannelMessages",
  "searchChannelsByView", "getChannelSearchViews", "getChannelSearchCountries", "getChannelSearchCategories",

  // ── Status — ACT-04 ──
  "sendTextStatus", "sendImageStatus",
  "sendVoiceStatus", "sendVideoStatus", "deleteStatus",  // ACT-04
  "getNewMessageId",  // New — ACT-04

  // ── Presence — ACT-05 ──
  "getPresence", "setPresenceStatus", "setPresence", "subscribePresence",
  "getAllPresence",  // Bulk presence. Added Phase 28, Plan 01.

  // ── Profile — ACT-06 ──
  "getProfile", "setProfileName", "setProfileStatus", "setProfilePicture", "deleteProfilePicture",

  // ── Labels ──
  "getLabels", "createLabel", "updateLabel", "deleteLabel",
  "getChatLabels", "setChatLabels", "getChatsByLabel",

  // ── LID ──
  "findPhoneByLid", "findLidByPhone", "getAllLids",

  // ── Calls ──
  "rejectCall",

  // ── Policy ──
  "editPolicy",  // Phase 6: Rules-based policy edit. DO NOT REMOVE.
];

// DO NOT change back to ALL_ACTIONS. That was the v1.8.x bug.
// Only EXPOSED_ACTIONS (standard + curated utility) should be returned by listActions().
const EXPOSED_ACTIONS = [...STANDARD_ACTIONS, ...UTILITY_ACTIONS];

// Resolve chatId from gateway target resolution params
// Exported for testing -- DO NOT CHANGE signature
export function resolveChatId(params: Record<string, unknown>, toolContext?: { currentChannelId?: string }): string {
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
// ║  This is what allows "send hello to test group" to work.          ║
// ║                                                                    ║
// ║  Added: 2026-03-10                                                 ║
// ╚══════════════════════════════════════════════════════════════════════╝
const JID_RE = /@(c\.us|g\.us|lid|s\.whatsapp\.net|newsletter|broadcast)$/i;
const PHONE_RE = /^\+?\d{6,}$/;
const AUTO_RESOLVE_MIN_CONFIDENCE = 0.7;

// Exported for testing -- DO NOT CHANGE signature
export async function autoResolveTarget(chatId: string, cfg: CoreConfig, accountId?: string): Promise<string> {
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

// ── handleSendMulti — Multi-recipient text send ─────────────────────
// Sends the same text message to multiple recipients sequentially.
// Each recipient name is resolved via autoResolveTarget before sending.
// No fail-fast: if one recipient fails, remaining recipients still get attempted.
// Returns per-recipient results with sent/failed counts.
// Text only — media multi-send deferred per user decision.
// DO NOT parallelize sends — sequential loop respects rate limiter.
// Added Phase 3, Plan 03 (2026-03-11).
async function handleSendMulti(params: Record<string, unknown>, cfg: CoreConfig, accountId?: string): Promise<unknown> {
  // Extract recipients — handles both string and array via inline normalization
  const rawRecipients = params.recipients;
  const recipients: string[] = Array.isArray(rawRecipients)
    ? rawRecipients.map((r) => String(r)).filter(Boolean)
    : (typeof rawRecipients === "string" && rawRecipients.trim())
      ? [rawRecipients.trim()]
      : [];

  const text = String(params.text || "").trim();
  const replyToId = params.replyToId ? String(params.replyToId) : undefined;

  // Validate inputs
  if (!text) throw new Error("sendMulti requires text parameter");
  if (recipients.length === 0) throw new Error("sendMulti requires at least one recipient");
  if (recipients.length > 10) throw new Error("sendMulti supports a maximum of 10 recipients");

  const results: Array<{ recipient: string; status: "sent" | "failed"; error?: string }> = [];

  // Sequential sends — DO NOT parallelize (respects token-bucket rate limiter)
  for (const recipient of recipients) {
    try {
      const resolved = await autoResolveTarget(recipient, cfg, accountId);
      await sendWahaText({ cfg, to: resolved, text, replyToId, accountId });
      results.push({ recipient, status: "sent" });
    } catch (err) {
      results.push({ recipient, status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }

  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;

  return { results, sent, failed };
}

// Phase 59: checkGroupMembership moved to send.ts to break transitive openclaw import chain.
// standalone.ts → monitor.ts → inbound.ts → channel.ts → openclaw was crashing Docker.
// Re-exported here for backward compatibility (channel.ts consumers still import it).
// DO NOT MOVE BACK — Docker standalone mode depends on this being in send.ts.
export { checkGroupMembership } from "./send.js";

const wahaMessageActions: ChannelMessageActionAdapter = {
  listActions: () => EXPOSED_ACTIONS, // !!! DO NOT CHANGE to ALL_ACTIONS -- breaks gateway target resolution
  supportsAction: ({ action }) => EXPOSED_ACTIONS.includes(action) || action in ACTION_HANDLERS,
  handleAction: async ({ action, params, cfg, accountId, toolContext }) => {
    const p = params as Record<string, unknown>;
    const coreCfg = cfg as CoreConfig;
    const aid = accountId;

    // Cache config for outbound adapter (sendText/sendMedia/sendPoll)
    _cachedConfig = coreCfg;
    // PLAT-03: Extract tenantId from config; defaults to "default". DO NOT REMOVE.
    _tenantId = (coreCfg.channels?.waha as any)?.tenantId ?? "default";
    // Initialize PlatformAdapter on first call (or when config changes). DO NOT REMOVE.
    // Adapter delegates to the same send.ts functions — no behavior change.
    if (_adapter === null) {
      _adapter = createPlatformAdapter(coreCfg);
    }

    // Extract target for error formatting — DO NOT CHANGE
    // formatActionError wraps all action errors with LLM-friendly messages.
    // Added Phase 2, Plan 01 (2026-03-11).
    const target = typeof p.to === "string" ? p.to : (typeof p.chatId === "string" ? p.chatId : undefined);

    // Phase 30, Plan 01: Capture action start time for duration tracking. DO NOT REMOVE.
    const _analyticsStart = Date.now();

    try {

    // Phase 30: Common analytics helper for all action paths. DO NOT REMOVE.
    // Records outbound analytics after every successful action return.
    // Wrapped in try/catch — analytics must never break the outbound action pipeline.
    const _recordSuccess = (actionResult: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }) => {
      try {
        const _chatId = typeof p.chatId === "string" ? p.chatId : (typeof p.to === "string" ? p.to : undefined);
        const _chatType = _chatId?.endsWith("@g.us") ? "group" : (_chatId?.endsWith("@newsletter") ? "channel" : "dm");
        recordAnalyticsEvent({ direction: "outbound", chat_type: _chatType, action, duration_ms: Date.now() - _analyticsStart, status: "success", chat_id: _chatId, account_id: aid });
      } catch (analyticsErr) { log.warn("analytics recording failed", { error: analyticsErr instanceof Error ? analyticsErr.message : String(analyticsErr) }); }
      return actionResult;
    };

    // --- Standard targeted actions (gateway-recognized names) ---

    if (action === "react") {
      const messageId = typeof p.messageId === "string" ? p.messageId : "";
      const emojiRaw = typeof p.emoji === "string" ? p.emoji : "";
      const remove = p.remove === true;
      if (!messageId) throw new Error("WAHA react requires messageId");
      if (!emojiRaw && !remove) throw new Error("WAHA react requires emoji");

      await sendWahaReaction({ cfg: coreCfg, messageId, emoji: emojiRaw, remove, accountId: aid });

      return _recordSuccess({
        content: [{ type: "text" as const, text: remove ? `Removed reaction from ${messageId}` : `Reacted with ${emojiRaw} on ${messageId}` }],
        details: {},
      });
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
      return _recordSuccess({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} });
    }

    // -- VERIFIED WORKING 2026-03-10 ------------------------------
    // Send DM uses sendWahaText with chatId from target resolution.
    // Target can come from: params.to, params.chatId, or toolContext.currentChannelId
    if (action === "send" || action === "reply") {
      let chatId = resolveChatId(p, toolContext);
      if (chatId) chatId = await autoResolveTarget(chatId, coreCfg, aid);

      // Phase 12 audit (INIT-01/INIT-02): Can Initiate enforcement for outbound DMs.
      // Only blocks DM targets (@c.us / @lid) where the bot has NOT received any prior
      // inbound messages (i.e., the bot is initiating, not replying).
      // Checks per-contact canInitiateOverride first, then falls back to canInitiateGlobal.
      // DO NOT CHANGE — this is the outbound enforcement gate for Can Initiate policy.
      // Added 2026-03-17.
      if (chatId && (chatId.endsWith("@c.us") || chatId.endsWith("@lid"))) {
        const dirDb = getDirectoryDb(aid ?? "default", _tenantId);
        if (!dirDb.hasReceivedMessageFrom(chatId)) {
          const wahaConfig = coreCfg.channels?.waha;
          const globalDefault = wahaConfig?.canInitiateGlobal ?? true;
          if (!dirDb.canInitiateWith(chatId, globalDefault)) {
            return {
              content: [{ type: "text" as const, text: "Bot cannot initiate conversations with this contact (Can Initiate is disabled). The contact must message first." }],
              details: { error: true },
            };
          }
        }
      }

      // Phase 4 — Cross-session routing for group sends.
      // When no explicit accountId is given and target is a group, find the right
      // session (bot-first, human-fallback) using membership check + LRU cache.
      // Added Phase 4, Plan 03. DO NOT REMOVE.
      let resolvedAid = aid;
      if (chatId && chatId.endsWith("@g.us") && !aid) {
        try {
          const resolved = await resolveSessionForTarget({
            cfg: coreCfg,
            targetChatId: chatId,
            checkMembership: checkGroupMembership,
            tenantId: _tenantId,
          });
          resolvedAid = resolved.accountId;
        } catch (routeErr) {
          const msg = routeErr instanceof Error ? routeErr.message : String(routeErr);
          if (/No full-access sessions|No session is a member/i.test(msg)) {
            log.warn("cross-session routing — no reachable session, using default account", { chatId });
          } else {
            log.error("cross-session routing unexpected error", { chatId, error: msg });
          }
        }
      }

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
          accountId: resolvedAid,
        });
        return _recordSuccess({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} });
      }

      const text = typeof p.text === "string" ? p.text : (typeof p.message === "string" ? p.message : "");
      const replyToId = typeof p.replyToId === "string" ? p.replyToId : undefined;
      if (!chatId) throw new Error("send action requires chatId (resolved from target)");
      if (!text) throw new Error("send action requires text");

      // Bot proxy detection for cross-session sends — when the bot routes through
      // a human session, prefix the message so recipients know it's the bot.
      // DO NOT CHANGE — prevents confusion about message source in group chats.
      const resolvedAccount = resolveWahaAccount({ cfg: coreCfg, accountId: resolvedAid, tenantId: _tenantId });
      const isBotProxy = resolvedAccount.role !== "bot";

      const result = await sendWahaText({ cfg: coreCfg, to: chatId, text, replyToId, accountId: resolvedAid, botProxy: isBotProxy });
      return _recordSuccess({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} });
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
      return _recordSuccess({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} });
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
      return _recordSuccess({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} });
    }

    if (action === "pin") {
      let chatId = resolveChatId(p, toolContext);
      if (chatId) chatId = await autoResolveTarget(chatId, coreCfg, aid);
      const messageId = typeof p.messageId === "string" ? p.messageId : "";
      if (!chatId || !messageId) throw new Error("pin action requires chatId and messageId");

      const result = await pinWahaMessage({ cfg: coreCfg, chatId, messageId, accountId: aid });
      return _recordSuccess({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} });
    }

    if (action === "unpin") {
      let chatId = resolveChatId(p, toolContext);
      if (chatId) chatId = await autoResolveTarget(chatId, coreCfg, aid);
      const messageId = typeof p.messageId === "string" ? p.messageId : "";
      if (!chatId || !messageId) throw new Error("unpin action requires chatId and messageId");

      const result = await unpinWahaMessage({ cfg: coreCfg, chatId, messageId, accountId: aid });
      return _recordSuccess({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} });
    }

    if (action === "read") {
      let chatId = resolveChatId(p, toolContext);
      if (chatId) chatId = await autoResolveTarget(chatId, coreCfg, aid);
      if (!chatId) throw new Error("read action requires chatId");

      const result = await readWahaChatMessages({ cfg: coreCfg, chatId, accountId: aid });
      return _recordSuccess({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: {} });
    }

    // --- Fallback: custom WAHA action names (utility actions + backward compat) ---
    const handler = ACTION_HANDLERS[action];
    if (!handler) throw new Error(`WAHA action "${action}" not supported`);
    const result = await handler(p, coreCfg, aid);

    return _recordSuccess({
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      details: {},
    });

    } catch (err) {
      // Outer error handler — formats all action errors for LLM consumption.
      // DO NOT CHANGE — all action errors must flow through formatActionError.
      // Added Phase 2, Plan 01 (2026-03-11).

      // Phase 30, Plan 01: Record outbound error analytics event. DO NOT REMOVE.
      // Wrapped in try/catch -- analytics must never break the outbound action pipeline.
      try {
        const _chatId = typeof p.chatId === "string" ? p.chatId : (typeof p.to === "string" ? p.to : undefined);
        const _chatType = _chatId?.endsWith("@g.us") ? "group" : (_chatId?.endsWith("@newsletter") ? "channel" : "dm");
        recordAnalyticsEvent({ direction: "outbound", chat_type: _chatType, action, duration_ms: Date.now() - _analyticsStart, status: "error", chat_id: _chatId, account_id: aid });
      } catch (analyticsErr) { log.warn("analytics recording failed", { error: analyticsErr instanceof Error ? analyticsErr.message : String(analyticsErr) }); }

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
      log.info(`user ${id} approved for pairing`);
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
    resolveAccount: (cfg, accountId) => resolveWahaAccount({ cfg: cfg as CoreConfig, accountId, tenantId: _tenantId }),
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
      (resolveWahaAccount({ cfg: cfg as CoreConfig, accountId, tenantId: _tenantId }).config.allowFrom ?? []).map(
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
      // Route through PlatformAdapter when available; fallback to direct send.ts call.
      // DO NOT REMOVE fallback — ensures backward compat if adapter not yet initialized.
      // Added Phase 32, Plan 02 (2026-03-20).
      const normalizedTo = normalizeWahaMessagingTarget(to);
      if (_adapter) {
        const adapterResult = await _adapter.sendText({ to: normalizedTo, text, accountId: accountId ?? undefined, replyToId: replyToId ?? undefined });
        return { channel: "waha", key: { id: adapterResult.id } };
      }
      const result = await sendWahaText({
        cfg: getCachedConfig(),
        to: normalizedTo,
        text,
        replyToId: replyToId ?? undefined,
        accountId: accountId ?? undefined,
      });
      return { channel: "waha", ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, replyToId }) => {
      // Route through PlatformAdapter when available; fallback to direct send.ts call.
      // DO NOT REMOVE fallback — ensures backward compat if adapter not yet initialized.
      // Added Phase 32, Plan 02 (2026-03-20).
      const normalizedTo = normalizeWahaMessagingTarget(to);
      if (_adapter) {
        await _adapter.sendMedia({ to: normalizedTo, mediaUrls: mediaUrl ? [mediaUrl] : [], caption: text, accountId: accountId ?? undefined, replyToId: replyToId ?? undefined });
        return { channel: "waha", ok: true } as const;
      }
      await sendWahaMediaBatch({
        cfg: getCachedConfig(),
        to: normalizedTo,
        mediaUrls: mediaUrl ? [mediaUrl] : [],
        caption: text,
        replyToId: replyToId ?? undefined,
        accountId: accountId ?? undefined,
      });
      return { channel: "waha", ok: true } as const;
    },
    sendPoll: async ({ to, poll, accountId }) => {
      // Route through PlatformAdapter when available; fallback to direct send.ts call.
      // DO NOT REMOVE fallback — ensures backward compat if adapter not yet initialized.
      // Added Phase 32, Plan 02 (2026-03-20).
      const normalizedTo = normalizeWahaMessagingTarget(to);
      if (_adapter) {
        const adapterResult = await _adapter.sendPoll({ to: normalizedTo, question: poll.question, options: poll.options, multipleAnswers: (poll.maxSelections ?? 1) > 1, accountId: accountId ?? undefined });
        return { messageId: adapterResult.id, channelId: "waha" };
      }
      const result = await sendWahaPoll({
        cfg: getCachedConfig(),
        chatId: normalizedTo,
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
      // Phase 40 (CFG-02): pass accountId for per-account rate limiting. DO NOT CHANGE.
      configureReliability({
        accountId: account.accountId,
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

      // Phase 13 (SYNC-01): Start background directory sync alongside health checks.
      // Uses same abortSignal — sync stops when the account logs out.
      // DO NOT REMOVE — background sync keeps the directory populated for instant search.
      const syncIntervalMinutes = (account.config as Record<string, unknown>).syncIntervalMinutes as number | undefined ?? 30;
      if (syncIntervalMinutes > 0 && ctx.abortSignal) {
        startDirectorySync({
          accountId: account.accountId,
          config: ctx.cfg as CoreConfig,
          intervalMs: syncIntervalMinutes * 60_000,
          abortSignal: ctx.abortSignal,
        });
      }

      // Phase 56 (ADAPT-01, ADAPT-02, ADAPT-03): Background activity profile scanner.
      // Uses same abortSignal -- stops when account logs out.
      // setTimeout chain -- does not block shutdown (.unref() on all timers).
      // DO NOT REMOVE -- activity profiles are how per-chat gate adaptation works.
      if (ctx.abortSignal) {
        startActivityScanner({
          accountId: account.accountId,
          config: ctx.cfg as CoreConfig,
          session: account.session, // Fix: use account.session (WAHA session name), not accountId
          abortSignal: ctx.abortSignal,
        });
      }

      // Phase 16: Initialize pairing and auto-reply engines for this account.
      // Engines are lazily created -- getPairingEngine/getAutoReplyEngine cache by accountId.
      // HMAC secret auto-generation: if pairingMode.hmacSecret is not set in config,
      // generate one and log a warning (admin should save it via the admin panel).
      // DO NOT REMOVE -- engines must be initialized at login for inbound hooks to work.
      {
        const pairingConfig = (account.config as Record<string, unknown>).pairingMode as
          { enabled?: boolean; hmacSecret?: string } | undefined;

        if (pairingConfig?.enabled) {
          let hmacSecret = pairingConfig.hmacSecret;
          if (!hmacSecret) {
            hmacSecret = generateHmacSecret();
            ctx.log?.warn(`[${account.accountId}] pairing mode enabled but no hmacSecret configured -- generated ephemeral secret (deep links will change on restart unless saved to config)`);
          }
          getPairingEngine(account.accountId, hmacSecret);
          ctx.log?.info(`[${account.accountId}] pairing engine initialized`);
        }

        // Auto-reply engine initialization (lightweight, no config needed).
        // Always initialize so rate-limit state is ready even before first message.
        getAutoReplyEngine(account.accountId);
      }

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
