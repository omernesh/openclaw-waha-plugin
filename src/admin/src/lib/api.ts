// Phase 18 scaffold — typed API client for /api/admin/* endpoints
// Route audit performed 2026-03-18 against src/monitor.ts — all methods below
// correspond to routes that exist in monitor.ts.

import type {
  StatsResponse,
  ConfigResponse,
  SessionsResponse,
  DirectoryResponse,
  DirectoryParams,
  HealthResponse,
  QueueResponse,
  SyncStatusResponse,
  ModulesResponse,
  GroupFilterResponse,
  ParticipantsResponse,
} from '@/types'

const BASE = '/api/admin'

class ApiError extends Error {
  status: number
  constructor(path: string, status: number, body: string) {
    super(`API ${path} failed ${status}: ${body}`)
    this.name = 'ApiError'
    this.status = status
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
    const text = await res.text().catch(() => res.statusText)
    throw new ApiError(path, res.status, text)
  }
  return res.json() as Promise<T>
}

export const api = {
  // Dashboard
  getStats: () => request<StatsResponse>('/stats'),
  getHealth: () => request<HealthResponse>('/health'),

  // Config
  getConfig: () => request<ConfigResponse>('/config'),
  updateConfig: (body: { waha: Record<string, unknown> }) =>
    request<void>('/config', { method: 'POST', body: JSON.stringify(body) }),

  // Sessions
  getSessions: () => request<SessionsResponse>('/sessions'),
  updateSessionRole: (sessionId: string, body: { role: string; subRole: string }) =>
    request<void>(`/sessions/${encodeURIComponent(sessionId)}/role`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  // Directory
  getDirectory: (params?: DirectoryParams) => {
    const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
    return request<DirectoryResponse>(`/directory${qs}`)
  },
  getDirectoryEntry: (jid: string) =>
    request<unknown>(`/directory/${encodeURIComponent(jid)}`),
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
  resolveNames: (jids: string[]) =>
    request<Record<string, string>>(`/directory/resolve?jids=${encodeURIComponent(jids.join(','))}`),

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
  toggleParticipantAllowGroup: (groupJid: string, participantJid: string) =>
    request<void>(
      `/directory/group/${encodeURIComponent(groupJid)}/participants/${encodeURIComponent(participantJid)}/allow-group`,
      { method: 'POST' },
    ),
  toggleParticipantAllowDm: (groupJid: string, participantJid: string) =>
    request<void>(
      `/directory/group/${encodeURIComponent(groupJid)}/participants/${encodeURIComponent(participantJid)}/allow-dm`,
      { method: 'POST' },
    ),
  updateParticipantRole: (groupJid: string, participantJid: string, body: { role: string }) =>
    request<void>(
      `/directory/group/${encodeURIComponent(groupJid)}/participants/${encodeURIComponent(participantJid)}/role`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  bulkAllowAll: (groupJid: string, body: { allow: boolean }) =>
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
    return request<string>(`/logs${qs}`)
  },

  // Gateway
  restart: () => request<void>('/restart', { method: 'POST' }),

  // Bulk directory operations
  bulkDirectory: (body: { action: string; jids: string[]; value?: unknown; groupJid?: string }) =>
    request<void>('/directory/bulk', { method: 'POST', body: JSON.stringify(body) }),

  // Pairing
  getPairingDeeplink: (jid: string) =>
    request<{ url: string }>(`/pairing/deeplink?jid=${encodeURIComponent(jid)}`),
  revokePairingGrant: (jid: string) =>
    request<void>(`/pairing/grant/${encodeURIComponent(jid)}`, { method: 'DELETE' }),
}

export { ApiError }
