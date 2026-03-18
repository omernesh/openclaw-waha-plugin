// Refined types — updated in Phase 20 to match exact API response shapes
// from monitor.ts route handlers (confirmed 2026-03-18)

// Stats response from GET /api/admin/stats
export interface StatsResponse {
  dmFilter: {
    enabled: boolean
    patterns: string[]
    godModeBypass: boolean
    godModeScope: 'all' | 'dm' | 'off'
    godModeSuperUsers: string[]
    tokenEstimate: number
    stats: { allowed: number; dropped: number; tokensEstimatedSaved: number }
    recentEvents: Array<{ ts: number; pass: boolean; reason: string; preview: string }>
  }
  groupFilter: {
    enabled: boolean
    patterns: string[]
    godModeBypass: boolean
    godModeScope: 'all' | 'dm' | 'off'
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
  }>
}

// Config response from GET /api/admin/config
export interface ConfigResponse {
  waha: WahaConfig
}

export interface WahaConfig {
  baseUrl?: string
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
// TabHeader.tsx uses sessionId throughout. Confirmed from monitor.ts lines 4914-4963.
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

// Directory entry from GET /api/admin/directory
export interface DirectoryEntry {
  jid: string;
  name: string;
  type: 'contact' | 'group' | 'newsletter';
  pushName?: string;
  dmAllowed?: boolean;
  lastSeen?: string;
}

export interface DirectoryResponse {
  items: DirectoryEntry[];
  total: number;
  offset: number;
  limit: number;
}

export interface DirectoryParams {
  type?: string;
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
export interface QueueResponse {
  dm: { depth: number; processing: boolean };
  group: { depth: number; processing: boolean };
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

// Log entry from GET /api/admin/logs
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

// Filter response from GET /api/admin/directory/:jid/filter
export interface GroupFilterResponse {
  groupJid: string;
  override: Record<string, unknown> | null;
}

// Participant from GET /api/admin/directory/group/:jid/participants
export interface Participant {
  jid: string;
  name?: string;
  role?: string;
  allowGroup?: boolean;
  allowDm?: boolean;
}

export interface ParticipantsResponse {
  participants: Participant[];
}
