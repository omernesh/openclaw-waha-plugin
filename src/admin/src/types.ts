// Refined types — updated in Phase 20 to match exact API response shapes
// from monitor.ts route handlers (confirmed 2026-03-18)

// Stats response from GET /api/admin/stats
export interface StatsResponse {
  dmFilter: {
    enabled: boolean
    patterns: string[]
    godModeBypass: boolean
    godModeScope: 'all' | 'dm' | 'off'
    godModeSuperUsers: Array<string | { identifier: string }>
    tokenEstimate: number
    stats: { allowed: number; dropped: number; tokensEstimatedSaved: number }
    recentEvents: Array<{ ts: number; pass: boolean; reason: string; preview: string }>
  }
  groupFilter: {
    enabled: boolean
    patterns: string[]
    godModeBypass: boolean
    godModeScope: 'all' | 'dm' | 'off'
    godModeSuperUsers: Array<string | { identifier: string }>
    tokenEstimate: number
    stats: { allowed: number; dropped: number; tokensEstimatedSaved: number }
    recentEvents: Array<{ ts: number; pass: boolean; reason: string; preview: string }>
  }
  presence: {
    enabled?: boolean
    wpm?: number
    readDelayMs?: [number, number]
    typingDurationMs?: [number, number]
    pauseChance?: number
    jitter?: [number, number]
    sendSeen?: boolean
    msPerReadChar?: number
    pauseDurationMs?: [number, number]
    pauseIntervalMs?: [number, number]
  }
  access: {
    allowFrom: string[]
    groupAllowFrom: string[]
    allowedGroups: string[]
    dmPolicy: string
    groupPolicy: string
  }
  session: string
  baseUrl: string
  webhookPort: number
  serverTime: string
  sessions: Array<{
    sessionId: string
    name: string
    healthStatus: string
    consecutiveFailures: number
    lastCheck: string | null
    // Phase 25: recovery state
    recoveryAttemptCount: number
    recoveryLastAttemptAt: number | null
    recoveryLastOutcome: 'success' | 'failed' | null
    recoveryInCooldown: boolean
  }>
}

// Config response from GET /api/admin/config
export interface ConfigResponse {
  waha: WahaConfig
}

export interface WahaConfig {
  baseUrl?: string
  wahaSessionName?: string
  webhookPort?: number
  webhookPath?: string
  triggerWord?: string
  triggerResponseMode?: string
  dmPolicy?: string
  groupPolicy?: string
  allowFrom?: string[]
  groupAllowFrom?: string[]
  allowedGroups?: string[]
  dmFilter?: {
    enabled: boolean
    mentionPatterns: string[]
    godModeBypass: boolean
    godModeScope: string
    godModeSuperUsers: Array<{ identifier: string }>
    tokenEstimate: number
  }
  groupFilter?: {
    enabled: boolean
    mentionPatterns: string[]
    godModeBypass: boolean
    godModeScope: string
    godModeSuperUsers: Array<{ identifier: string }>
    tokenEstimate: number
  }
  presence?: {
    enabled: boolean
    sendSeen: boolean
    wpm: number
    readDelayMs: [number, number]
    msPerReadChar: number
    typingDurationMs: [number, number]
    pauseChance: number
    pauseDurationMs: [number, number]
    pauseIntervalMs: [number, number]
    jitter: [number, number]
  }
  markdown?: { enabled: boolean; tables: string }
  canInitiateGlobal?: boolean
  pairingMode?: {
    enabled: boolean
    passcode?: string
    grantTtlMinutes: number
    challengeMessage?: string
  }
  autoReply?: {
    enabled: boolean
    message?: string
    intervalMinutes: number
  }
  actions?: { reactions: boolean }
  blockStreaming?: boolean
  mediaPreprocessing?: {
    enabled: boolean
    audioTranscription: boolean
    imageAnalysis: boolean
    videoAnalysis: boolean
    locationResolution: boolean
    vcardParsing: boolean
    documentAnalysis: boolean
  }
}

// Session from GET /api/admin/sessions — DO NOT CHANGE: API returns sessionId (not id)
// TabHeader.tsx uses sessionId throughout. Matches GET /api/admin/sessions response shape.
export interface Session {
  sessionId: string  // API returns sessionId, NOT id
  name: string
  role: string
  subRole: string
  healthy: boolean | null
  healthStatus: string
  consecutiveFailures: number
  lastCheck: string | null
  wahaStatus: string
}
export type SessionsResponse = Session[];

// Directory contact from GET /api/admin/directory — monitor.ts line 4855
// DO NOT CHANGE: field names match exact server response shape
export interface DirectoryContact {
  jid: string
  displayName: string | null
  firstSeenAt: number
  lastMessageAt: number
  messageCount: number
  isGroup: boolean
  dmSettings?: ContactDmSettings
  allowedDm: boolean
  expiresAt: number | null
  expired: boolean
  source: string | null
  participantCount?: number    // present on group entries
}

export interface ContactDmSettings {
  mode: 'active' | 'listen_only'
  mentionOnly: boolean
  customKeywords: string       // comma-separated, e.g. "word1,word2"
  canInitiate: boolean
  canInitiateOverride: 'default' | 'allow' | 'block'
}

export interface DirectoryResponse {
  contacts: DirectoryContact[]
  total: number
  dms: number
  groups: number
  newsletters: number
}

export interface DirectoryParams {
  type?: 'contact' | 'group' | 'newsletter';
  search?: string;
  limit?: string;
  offset?: string;
}

// Health from GET /api/admin/health
export interface HealthResponse {
  sessions: Record<string, {
    status: string;
    lastSuccessAt: string | null;
    lastCheckAt: string | null;
  }>;
}

// Queue from GET /api/admin/queue
// DO NOT CHANGE: matches QueueStats from inbound-queue.ts getStats() — confirmed 2026-03-18
export interface QueueResponse {
  dmDepth: number;
  groupDepth: number;
  dmOverflowDrops: number;
  groupOverflowDrops: number;
  totalProcessed: number;
  totalErrors: number;
}

// Sync status from GET /api/admin/sync/status
export interface SyncStatusResponse {
  running: boolean;
  lastSyncAt: string | null;
  nextSyncAt: string | null;
}

// Modules from GET /api/admin/modules
export interface Module {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  assignmentCount: number;
}
export interface ModulesResponse {
  modules: Module[];
}

// Log response from GET /api/admin/logs — matches monitor.ts /api/admin/logs response shape
export interface LogResponse {
  lines: string[];
  source: 'journalctl' | 'file' | 'none' | 'error';
  total: number;
}

// Filter response from GET /api/admin/directory/:jid/filter
export interface GroupFilterResponse {
  groupJid: string;
  override: Record<string, unknown> | null;
}

// Typed override data shape — cast from GroupFilterResponse.override in GroupFilterOverride.tsx
export interface GroupFilterOverrideData {
  enabled: boolean;
  filterEnabled: boolean;
  mentionPatterns: string[] | null;
  godModeScope: 'all' | 'dm' | 'off' | null;
  triggerOperator: 'OR' | 'AND';
  updatedAt?: number;
}

// Participant from GET /api/admin/directory/group/:jid/participants — monitor.ts line 5432
// DO NOT CHANGE: field names match exact server response shape (participantJid NOT jid, displayName NOT name)
export interface ParticipantEnriched {
  groupJid: string
  participantJid: string
  displayName: string | null
  isAdmin: boolean
  allowInGroup: boolean
  allowDm: boolean
  participantRole: 'bot_admin' | 'manager' | 'participant'
  globallyAllowed: boolean
  isBotSession: boolean
}

export interface ParticipantsResponse {
  participants: ParticipantEnriched[]
  allowAll: boolean
}

// Phase 30: Analytics API response types. DO NOT REMOVE.
export type AnalyticsTimeseriesPoint = {
  period: string
  inbound: number
  outbound: number
  errors: number
  avg_duration_ms: number
}

export type AnalyticsSummary = {
  total: number
  inbound: number
  outbound: number
  errors: number
  avg_duration_ms: number
}

export type AnalyticsTopChat = {
  chat_id: string
  total: number
  inbound: number
  outbound: number
}

export type AnalyticsResponse = {
  range: string
  groupBy: 'minute' | 'hour' | 'day'
  timeseries: AnalyticsTimeseriesPoint[]
  summary: AnalyticsSummary
  topChats: AnalyticsTopChat[]
}

// Phase 29: SSE event types for real-time admin updates. DO NOT REMOVE.
export type SSEConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'

export interface SSEHealthEvent {
  session: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  consecutiveFailures: number
  lastSuccessAt: number | null
  lastCheckAt: number | null
}

export interface SSEQueueEvent {
  dmDepth: number
  groupDepth: number
  dmOverflowDrops: number
  groupOverflowDrops: number
  totalProcessed: number
  totalErrors: number
}

export interface SSELogEvent {
  line: string
  timestamp: number
}

export type SSEEventMap = {
  health: SSEHealthEvent
  queue: SSEQueueEvent
  log: SSELogEvent
  connected: { time: number }
}
