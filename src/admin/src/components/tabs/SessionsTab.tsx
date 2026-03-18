import { useEffect, useState, useCallback } from 'react'
import { api } from '@/lib/api'
import type { Session } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RestartOverlay } from '@/components/shared/RestartOverlay'
import { Skeleton } from '@/components/ui/skeleton'

interface SessionsTabProps {
  selectedSession: string
  refreshKey: number
  onLoadingChange?: (loading: boolean) => void
}

type RoleOverrides = Record<string, { role: string; subRole: string }>

function healthBadgeVariant(healthy: boolean | null): 'default' | 'destructive' | 'secondary' {
  if (healthy === true) return 'default'
  if (healthy === false) return 'destructive'
  return 'secondary'
}

function healthLabel(healthy: boolean | null): string {
  if (healthy === true) return 'Healthy'
  if (healthy === false) return 'Unhealthy'
  return 'Unknown'
}

function roleDescription(role: string, subRole: string): string {
  const base =
    role === 'bot'
      ? 'This session is controlled by the AI agent. It will process incoming messages and can send outgoing messages.'
      : 'This session belongs to a human user. Messages are monitored but not processed by the AI agent.'
  const listener =
    subRole === 'listener'
      ? ' Listener mode: the agent can receive messages on this session but cannot send.'
      : ''
  return base + listener
}

export default function SessionsTab({ selectedSession: _selectedSession, refreshKey, onLoadingChange }: SessionsTabProps) {
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Report loading state to parent (drives TabHeader spinner)
  useEffect(() => { onLoadingChange?.(loading) }, [loading, onLoadingChange])
  // Local role overrides keyed by sessionId
  const [overrides, setOverrides] = useState<RoleOverrides>({})
  // Snapshot of fetched roles — used to detect pending changes
  const [fetchedRoles, setFetchedRoles] = useState<RoleOverrides>({})
  const [saving, setSaving] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const fetchSessions = useCallback(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(false)
    api.getSessions()
      .then((data) => {
        if (controller.signal.aborted) return
        setSessions(data)
        // Initialize overrides from fetched data
        const initial: RoleOverrides = {}
        for (const s of data) {
          initial[s.sessionId] = { role: s.role, subRole: s.subRole }
        }
        setOverrides(initial)
        setFetchedRoles(initial)
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  useEffect(() => {
    return fetchSessions()
  }, [fetchSessions])

  const pendingChanges =
    sessions !== null &&
    sessions.some((s) => {
      const ov = overrides[s.sessionId]
      const orig = fetchedRoles[s.sessionId]
      return ov && orig && (ov.role !== orig.role || ov.subRole !== orig.subRole)
    })

  async function handleSaveAndRestart() {
    if (!sessions) return
    setSaving(true)
    try {
      // Save all sessions with changed roles
      const changed = sessions.filter((s) => {
        const ov = overrides[s.sessionId]
        const orig = fetchedRoles[s.sessionId]
        return ov && orig && (ov.role !== orig.role || ov.subRole !== orig.subRole)
      })
      await Promise.all(
        changed.map((s) =>
          api.updateSessionRole(s.sessionId, overrides[s.sessionId])
        )
      )
      await api.restart()
      setRestarting(true)
    } finally {
      setSaving(false)
    }
  }

  function handleRestartComplete() {
    setRestarting(false)
    fetchSessions()
  }

  function handleRestartTimeout() {
    setRestarting(false)
  }

  function updateOverride(sessionId: string, field: 'role' | 'subRole', value: string) {
    setOverrides((prev) => ({
      ...prev,
      [sessionId]: { ...prev[sessionId], [field]: value },
    }))
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Skeleton className="h-[140px] w-full" />
          <Skeleton className="h-[140px] w-full" />
        </div>
      </div>
    )
  }

  if (error || !sessions) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <p>Failed to load sessions.</p>
        <Button variant="outline" size="sm" onClick={() => fetchSessions()}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <RestartOverlay
        active={restarting}
        onComplete={handleRestartComplete}
        onTimeout={handleRestartTimeout}
      />

      {/* Pending changes notice + Save & Restart */}
      {pendingChanges && (
        <div className="flex items-center justify-between rounded-md border border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200">
          <span>Changes require a gateway restart to take effect.</span>
          <Button
            size="sm"
            onClick={handleSaveAndRestart}
            disabled={saving}
            className="ml-4"
          >
            {saving ? 'Saving...' : 'Save & Restart'}
          </Button>
        </div>
      )}

      {/* Session cards grid */}
      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No sessions found.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {sessions.map((session) => {
            const ov = overrides[session.sessionId] ?? { role: session.role, subRole: session.subRole }
            return (
              <Card key={session.sessionId}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{session.name || session.sessionId}</CardTitle>
                      {session.name && (
                        <p className="text-xs text-muted-foreground mt-0.5">{session.sessionId}</p>
                      )}
                    </div>
                    <Badge variant={healthBadgeVariant(session.healthy)}>
                      {healthLabel(session.healthy)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Health details */}
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>Status: {session.healthStatus || '—'}</p>
                    {session.consecutiveFailures > 0 && (
                      <p className="text-destructive">
                        {session.consecutiveFailures} consecutive failure{session.consecutiveFailures !== 1 ? 's' : ''}
                      </p>
                    )}
                    <p>WAHA: {session.wahaStatus || '—'}</p>
                  </div>

                  {/* Role dropdown */}
                  <div className="space-y-1.5">
                    <Label htmlFor={`role-${session.sessionId}`}>Role</Label>
                    <Select
                      value={ov.role}
                      onValueChange={(val) => updateOverride(session.sessionId, 'role', val)}
                    >
                      <SelectTrigger id={`role-${session.sessionId}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bot">Bot — AI agent controls this session</SelectItem>
                        <SelectItem value="human">Human — human-controlled session</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* SubRole dropdown */}
                  <div className="space-y-1.5">
                    <Label htmlFor={`subrole-${session.sessionId}`}>Sub-Role</Label>
                    <Select
                      value={ov.subRole}
                      onValueChange={(val) => updateOverride(session.sessionId, 'subRole', val)}
                    >
                      <SelectTrigger id={`subrole-${session.sessionId}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full-access">Full Access — can send and receive</SelectItem>
                        <SelectItem value="listener">Listener — receive only, no sending</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Explanatory text */}
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {roleDescription(ov.role, ov.subRole)}
                  </p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
