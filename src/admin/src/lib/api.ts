// Phase 18 scaffold — typed API client for /api/admin/* endpoints
// Route audit performed 2026-03-18 against src/monitor.ts — all methods below
// correspond to routes that exist in monitor.ts.

import type {
  StatsResponse,
  ConfigResponse,
  SessionsResponse,
  DirectoryResponse,
  DirectoryContact,
  DirectoryParams,
  HealthResponse,
  QueueResponse,
  SyncStatusResponse,
  ModulesResponse,
  GroupFilterResponse,
  ParticipantsResponse,
  LogResponse,
  WahaConfig,
  AnalyticsResponse,
  PresenceEntry,
} from '@/types'

const BASE = '/api/admin'

class ApiError extends Error {
  status: number
  data: unknown
  constructor(path: string, status: number, body: string, data?: unknown) {
    super(`API ${path} failed ${status}: ${body}`)
    this.name = 'ApiError'
    this.status = status
    this.data = data ?? null
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!res.ok) {
    // Try to parse structured error body (e.g. { error: 'validation_failed', fields: [...] })
    // Always throw a proper Error instance so err instanceof Error works everywhere.
    // Structured server data is preserved on err.data.
    const text = await res.text().catch(() => res.statusText)
    let parsed: Record<string, unknown> | null = null
    try {
      parsed = JSON.parse(text)
    } catch {
      // not JSON — fall through
    }
    const message = (parsed?.error as string) || (parsed?.message as string) || res.statusText
    const err = new ApiError(path, res.status, message, parsed)
    throw err
  }
  return res.json() as Promise<T>
}

export const api = {
  // Dashboard
  getStats: () => request<StatsResponse>('/stats'),
  getHealth: () => request<HealthResponse>('/health'),

  // Config
  getConfig: () => request<ConfigResponse>('/config'),
  updateConfig: (body: { waha: Partial<WahaConfig> }) =>
    request<void>('/config', { method: 'POST', body: JSON.stringify(body) }),
  exportConfig: (): Promise<Blob> => {
    // Direct fetch to trigger download — bypasses request() since we need a Blob, not JSON
    return fetch(`${BASE}/config/export`).then((r) => {
      if (!r.ok) throw new Error('Export failed')
      return r.blob()
    })
  },
  importConfig: (body: Record<string, unknown>) =>
    request<{ ok: boolean }>('/config/import', { method: 'POST', body: JSON.stringify(body) }),

  // Sessions
  getSessions: () => request<SessionsResponse>('/sessions'),
  updateSessionRole: (sessionId: string, body: { role: string; subRole: string }) =>
    request<void>(`/sessions/${encodeURIComponent(sessionId)}/role`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  // Directory
  getDirectory: (params?: DirectoryParams) => {
    const filtered = params ? Object.fromEntries(Object.entries(params as Record<string, string>).filter(([, v]) => v !== undefined)) : undefined
    const qs = filtered && Object.keys(filtered).length > 0 ? '?' + new URLSearchParams(filtered).toString() : ''
    return request<DirectoryResponse>(`/directory${qs}`)
  },
  getDirectoryEntry: (jid: string) =>
    request<DirectoryContact>(`/directory/${encodeURIComponent(jid)}`),
  updateDirectorySettings: (jid: string, body: Record<string, unknown>) =>
    request<void>(`/directory/${encodeURIComponent(jid)}/settings`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  toggleAllowDm: (jid: string, body: { allowed: boolean }) =>
    request<void>(`/directory/${encodeURIComponent(jid)}/allow-dm`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setDirectoryTtl: (jid: string, body: { expiresAt: number | null }) =>
    request<void>(`/directory/${encodeURIComponent(jid)}/ttl`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  refreshDirectory: () =>
    request<void>('/directory/refresh', { method: 'POST' }),
  // Server returns { resolved: Record<string, string> } — use response.resolved to access names.
  resolveNames: (jids: string[]) =>
    request<{ resolved: Record<string, string> }>(`/directory/resolve?jids=${encodeURIComponent(jids.join(','))}`),

  // Per-group filter overrides
  getGroupFilter: (groupJid: string) =>
    request<GroupFilterResponse>(`/directory/${encodeURIComponent(groupJid)}/filter`),
  updateGroupFilter: (groupJid: string, body: Record<string, unknown>) =>
    request<void>(`/directory/${encodeURIComponent(groupJid)}/filter`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  // Group participants
  getGroupParticipants: (groupJid: string) =>
    request<ParticipantsResponse>(`/directory/group/${encodeURIComponent(groupJid)}/participants`),
  // allowed: the NEW desired state (true = allow, false = revoke). Server is a set operation, not a toggle.
  toggleParticipantAllowGroup: (groupJid: string, participantJid: string, allowed: boolean) =>
    request<void>(
      `/directory/group/${encodeURIComponent(groupJid)}/participants/${encodeURIComponent(participantJid)}/allow-group`,
      { method: 'POST', body: JSON.stringify({ allowed }) },
    ),
  // allowed: the NEW desired state (true = allow, false = revoke). Server is a set operation, not a toggle.
  toggleParticipantAllowDm: (groupJid: string, participantJid: string, allowed: boolean) =>
    request<void>(
      `/directory/group/${encodeURIComponent(groupJid)}/participants/${encodeURIComponent(participantJid)}/allow-dm`,
      { method: 'POST', body: JSON.stringify({ allowed }) },
    ),
  updateParticipantRole: (groupJid: string, participantJid: string, body: { role: string }) =>
    request<void>(
      `/directory/group/${encodeURIComponent(groupJid)}/participants/${encodeURIComponent(participantJid)}/role`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  // DO NOT CHANGE: server reads { allowed: boolean } (not { allow: boolean }) — monitor.ts line 5537
  bulkAllowAll: (groupJid: string, body: { allowed: boolean }) =>
    request<void>(`/directory/group/${encodeURIComponent(groupJid)}/allow-all`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Queue
  getQueue: () => request<QueueResponse>('/queue'),

  // Sync
  getSyncStatus: () => request<SyncStatusResponse>('/sync/status'),

  // Modules
  getModules: () => request<ModulesResponse>('/modules'),
  enableModule: (id: string) =>
    request<void>(`/modules/${encodeURIComponent(id)}/enable`, { method: 'PUT' }),
  disableModule: (id: string) =>
    request<void>(`/modules/${encodeURIComponent(id)}/disable`, { method: 'PUT' }),
  getModuleAssignments: (id: string) =>
    request<{ assignments: Array<{ jid: string }> }>(`/modules/${encodeURIComponent(id)}/assignments`),
  addModuleAssignment: (id: string, body: { jid: string }) =>
    request<void>(`/modules/${encodeURIComponent(id)}/assignments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removeModuleAssignment: (id: string, jid: string) =>
    request<void>(`/modules/${encodeURIComponent(id)}/assignments/${encodeURIComponent(jid)}`, {
      method: 'DELETE',
    }),

  // Logs
  getLogs: (params?: { lines?: number; level?: string; search?: string }) => {
    const qs = params ? '?' + new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]))
    ).toString() : ''
    return request<LogResponse>(`/logs${qs}`)
  },

  // Gateway
  restart: () => request<void>('/restart', { method: 'POST' }),

  // Bulk directory operations — returns { ok: true, updated: number }
  bulkDirectory: (body: { action: 'allow-dm' | 'revoke-dm' | 'set-role' | 'follow' | 'unfollow'; jids: string[]; value?: unknown; groupJid?: string }) =>
    request<{ ok: boolean; updated: number }>('/directory/bulk', { method: 'POST', body: JSON.stringify(body) }),

  // Analytics — Phase 30
  getAnalytics: (range = '24h', groupBy?: string): Promise<AnalyticsResponse> => {
    const params = new URLSearchParams({ range })
    if (groupBy) params.set('groupBy', groupBy)
    return request<AnalyticsResponse>(`/analytics?${params}`)
  },

  // Presence — returns array of presence entries for all tracked contacts
  getPresence: () => request<{ presence?: PresenceEntry[] }>('/presence'),

  // Pairing
  revokePairingGrant: (jid: string) =>
    request<void>(`/pairing/grant/${encodeURIComponent(jid)}`, { method: 'DELETE' }),
}

export { ApiError }
