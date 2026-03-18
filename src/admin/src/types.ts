// Phase 18 scaffold — types are initial approximations, refine when wiring actual tabs

// Stats response from GET /api/admin/stats
export interface StatsResponse {
  dmFilter: Record<string, unknown>;
  groupFilter: Record<string, unknown>;
  access: {
    groupAllowFrom: Array<{ jid: string; name?: string }>;
    dmAllowFrom: Array<{ jid: string; name?: string }>;
    globalBlock: Array<{ jid: string; name?: string }>;
  };
  messageCounts: Record<string, number>;
  webhookCounts: Record<string, number>;
}

// Config response from GET /api/admin/config
export interface ConfigResponse {
  waha: Record<string, unknown>;
}

// Session from GET /api/admin/sessions
export interface Session {
  id: string;
  name: string;
  status: string;
  role?: string;
  subRole?: string;
  health?: {
    status: string;
    lastSuccessAt: string | null;
    lastCheckAt: string | null;
  };
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
