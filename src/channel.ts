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
import {
  sendWahaMediaBatch, sendWahaReaction, sendWahaText,
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
} from "./send.js";
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
};

const ALL_ACTIONS = ["react", ...Object.keys(ACTION_HANDLERS)];

const wahaMessageActions: ChannelMessageActionAdapter = {
  listActions: () => ALL_ACTIONS,
  supportsAction: ({ action }) => ALL_ACTIONS.includes(action),
  handleAction: async ({ action, params, cfg, accountId }) => {
    if (action === "react") {
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
    }
    const handler = ACTION_HANDLERS[action];
    if (!handler) throw new Error(`WAHA action "${action}" not supported`);
    const result = await handler(params as Record<string, unknown>, cfg as CoreConfig, accountId ?? undefined);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
