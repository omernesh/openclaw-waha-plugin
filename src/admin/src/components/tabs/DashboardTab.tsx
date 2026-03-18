import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { StatsResponse, ConfigResponse } from '@/types'
import { labelFor } from '@/lib/labels'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { TagInput } from '@/components/shared/TagInput'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

interface DashboardTabProps {
  selectedSession: string
  refreshKey: number
}

function formatRange(val: [number, number] | undefined): string {
  if (!val) return '—'
  return `${val[0]} - ${val[1]}`
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString()
}

function healthBadgeVariant(status: string): 'default' | 'destructive' | 'secondary' | 'outline' {
  const s = status?.toLowerCase() ?? ''
  if (s === 'healthy' || s === 'ok') return 'default'
  if (s === 'unhealthy' || s === 'error' || s === 'disconnected') return 'destructive'
  return 'secondary'
}

// DO NOT CHANGE: DashboardTab fetches stats + config in parallel, resolves JIDs
// for access control once per mount (guarded by resolvedJidsRef to avoid re-fetch
// flicker on every refreshKey tick). Pattern confirmed from RESEARCH.md anti-patterns.
export default function DashboardTab({ selectedSession, refreshKey }: DashboardTabProps) {
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [config, setConfig] = useState<ConfigResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [resolvedNames, setResolvedNames] = useState<Record<string, string>>({})
  const resolvedJidsRef = useRef<Set<string>>(new Set())

  // Fetch stats + config in parallel
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    Promise.all([api.getStats(), api.getConfig()])
      .then(([s, c]) => {
        if (controller.signal.aborted) return
        setStats(s)
        setConfig(c)

        // Batch-resolve JIDs from access control — only ones not already resolved
        const jids = [
          ...(s.access?.allowFrom ?? []),
          ...(s.access?.groupAllowFrom ?? []),
          ...(s.access?.allowedGroups ?? []),
        ]
          .filter((j) => j !== '*' && !resolvedJidsRef.current.has(j))

        if (jids.length > 0) {
          const deduped = [...new Set(jids)]
          api.resolveNames(deduped)
            .then((r) => {
              if (controller.signal.aborted) return
              deduped.forEach((j) => resolvedJidsRef.current.add(j))
              setResolvedNames((prev) => ({ ...prev, ...r.resolved }))
            })
            .catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-[120px] w-full" />
        <div className="flex gap-4">
          <Skeleton className="h-[80px] flex-1" />
          <Skeleton className="h-[80px] flex-1" />
        </div>
        <Skeleton className="h-[100px] w-full" />
        <Skeleton className="h-[100px] w-full" />
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p>Failed to load dashboard data.</p>
      </div>
    )
  }

  // Filter sessions if a specific one is selected
  const visibleSessions = selectedSession === 'all'
    ? stats.sessions
    : stats.sessions.filter((s) => s.sessionId === selectedSession)

  const dmFilter = stats.dmFilter
  const groupFilter = stats.groupFilter
  const presence = stats.presence
  const access = stats.access

  return (
    <div className="flex flex-col gap-4 p-4">

      {/* Section 1: Session Health */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Session Health</CardTitle>
        </CardHeader>
        <CardContent>
          {visibleSessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sessions found.</p>
          ) : (
            <div className="space-y-2">
              {visibleSessions.map((session) => (
                <div
                  key={session.sessionId}
                  className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="font-medium min-w-[120px]">
                    {session.name || session.sessionId}
                  </span>
                  <Badge variant={healthBadgeVariant(session.healthStatus)}>
                    {session.healthStatus || 'unknown'}
                  </Badge>
                  {session.consecutiveFailures > 0 && (
                    <span className="text-muted-foreground text-xs">
                      {session.consecutiveFailures} failure{session.consecutiveFailures !== 1 ? 's' : ''}
                    </span>
                  )}
                  {session.lastCheck && (
                    <span className="text-muted-foreground text-xs ml-auto">
                      Last check: {new Date(session.lastCheck).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2: DM Keyword Filter (collapsible) */}
      <Collapsible defaultOpen={false}>
        <Card>
          <CollapsibleTrigger className="w-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle>DM Keyword Filter</CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {dmFilter.stats.allowed} allowed / {dmFilter.stats.dropped} dropped
                  </span>
                  <Badge variant={dmFilter.enabled ? 'default' : 'secondary'}>
                    {dmFilter.enabled ? 'On' : 'Off'}
                  </Badge>
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Patterns
                </p>
                {dmFilter.patterns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No patterns configured.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {dmFilter.patterns.map((p) => (
                      <Badge key={p} variant="outline">{p}</Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  God Mode
                </p>
                <div className="flex flex-wrap gap-2 text-sm">
                  <span>
                    Bypass:{' '}
                    <Badge variant={dmFilter.godModeBypass ? 'default' : 'secondary'}>
                      {dmFilter.godModeBypass ? 'On' : 'Off'}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground">
                    Scope: <span className="text-foreground">{dmFilter.godModeScope}</span>
                  </span>
                </div>
                {dmFilter.godModeSuperUsers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {dmFilter.godModeSuperUsers.map((u) => (
                      <Badge key={u} variant="outline">{resolvedNames[u] ?? u}</Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Stats
                </p>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded border px-2 py-1 text-center">
                    <div className="font-semibold">{dmFilter.stats.allowed}</div>
                    <div className="text-xs text-muted-foreground">Allowed</div>
                  </div>
                  <div className="rounded border px-2 py-1 text-center">
                    <div className="font-semibold">{dmFilter.stats.dropped}</div>
                    <div className="text-xs text-muted-foreground">Dropped</div>
                  </div>
                  <div className="rounded border px-2 py-1 text-center">
                    <div className="font-semibold">{dmFilter.stats.tokensEstimatedSaved.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Tokens Saved</div>
                  </div>
                </div>
              </div>

              {dmFilter.recentEvents.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Recent Events
                  </p>
                  <div className="space-y-1">
                    {dmFilter.recentEvents.slice(0, 5).map((ev, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">{formatTs(ev.ts)}</span>
                        <Badge variant={ev.pass ? 'default' : 'destructive'} className="text-[10px] px-1.5 py-0">
                          {ev.pass ? 'pass' : 'drop'}
                        </Badge>
                        <span className="text-muted-foreground truncate max-w-[200px]" title={ev.reason}>
                          {ev.reason}
                        </span>
                        {ev.preview && (
                          <span className="text-muted-foreground truncate max-w-[150px]" title={ev.preview}>
                            — {ev.preview.slice(0, 60)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Section 3: Group Keyword Filter (collapsible) */}
      <Collapsible defaultOpen={false}>
        <Card>
          <CollapsibleTrigger className="w-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle>Group Keyword Filter</CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {groupFilter.stats.allowed} allowed / {groupFilter.stats.dropped} dropped
                  </span>
                  <Badge variant={groupFilter.enabled ? 'default' : 'secondary'}>
                    {groupFilter.enabled ? 'On' : 'Off'}
                  </Badge>
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Patterns
                </p>
                {groupFilter.patterns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No patterns configured.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {groupFilter.patterns.map((p) => (
                      <Badge key={p} variant="outline">{p}</Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  God Mode
                </p>
                <div className="flex flex-wrap gap-2 text-sm">
                  <span>
                    Bypass:{' '}
                    <Badge variant={groupFilter.godModeBypass ? 'default' : 'secondary'}>
                      {groupFilter.godModeBypass ? 'On' : 'Off'}
                    </Badge>
                  </span>
                  <span className="text-muted-foreground">
                    Scope: <span className="text-foreground">{groupFilter.godModeScope}</span>
                  </span>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Stats
                </p>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="rounded border px-2 py-1 text-center">
                    <div className="font-semibold">{groupFilter.stats.allowed}</div>
                    <div className="text-xs text-muted-foreground">Allowed</div>
                  </div>
                  <div className="rounded border px-2 py-1 text-center">
                    <div className="font-semibold">{groupFilter.stats.dropped}</div>
                    <div className="text-xs text-muted-foreground">Dropped</div>
                  </div>
                  <div className="rounded border px-2 py-1 text-center">
                    <div className="font-semibold">{groupFilter.stats.tokensEstimatedSaved.toLocaleString()}</div>
                    <div className="text-xs text-muted-foreground">Tokens Saved</div>
                  </div>
                </div>
              </div>

              {groupFilter.recentEvents.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Recent Events
                  </p>
                  <div className="space-y-1">
                    {groupFilter.recentEvents.slice(0, 5).map((ev, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">{formatTs(ev.ts)}</span>
                        <Badge variant={ev.pass ? 'default' : 'destructive'} className="text-[10px] px-1.5 py-0">
                          {ev.pass ? 'pass' : 'drop'}
                        </Badge>
                        <span className="text-muted-foreground truncate max-w-[200px]" title={ev.reason}>
                          {ev.reason}
                        </span>
                        {ev.preview && (
                          <span className="text-muted-foreground truncate max-w-[150px]" title={ev.preview}>
                            — {ev.preview.slice(0, 60)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Section 4: Presence System */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Presence System</CardTitle>
            <Badge variant={presence?.enabled ? 'default' : 'secondary'}>
              {presence?.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {[
              { key: 'wpm', value: presence?.wpm != null ? String(presence.wpm) : '—' },
              { key: 'readDelayMs', value: formatRange(presence?.readDelayMs) },
              { key: 'typingDurationMs', value: formatRange(presence?.typingDurationMs) },
              { key: 'pauseChance', value: presence?.pauseChance != null ? `${Math.round(presence.pauseChance * 100)}%` : '—' },
              { key: 'jitter', value: formatRange(presence?.jitter) },
            ].map(({ key, value }) => (
              <div key={key} className="rounded border px-3 py-2">
                <div className="text-xs text-muted-foreground">{labelFor(key)}</div>
                <div className="font-medium mt-0.5">{value}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Section 5: Access Control */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Access Control</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3 text-sm">
            <div>
              <span className="text-muted-foreground">{labelFor('dmPolicy')}: </span>
              <Badge variant="outline">{access.dmPolicy || '—'}</Badge>
            </div>
            <div>
              <span className="text-muted-foreground">{labelFor('groupPolicy')}: </span>
              <Badge variant="outline">{access.groupPolicy || '—'}</Badge>
            </div>
          </div>

          <AccessListField
            label={labelFor('allowFrom')}
            values={access.allowFrom}
            resolvedNames={resolvedNames}
          />
          <AccessListField
            label={labelFor('groupAllowFrom')}
            values={access.groupAllowFrom}
            resolvedNames={resolvedNames}
          />
          <AccessListField
            label={labelFor('allowedGroups')}
            values={access.allowedGroups}
            resolvedNames={resolvedNames}
          />
        </CardContent>
      </Card>

      {/* Server info footer */}
      <div className={cn('text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 px-1')}>
        <span>{labelFor('baseUrl')}: {stats.baseUrl}</span>
        <span>{labelFor('webhookPort')}: {stats.webhookPort}</span>
        <span>{labelFor('serverTime')}: {stats.serverTime}</span>
        {config && (
          <span className="opacity-60">Config loaded</span>
        )}
      </div>
    </div>
  )
}

// Sub-component for access control list fields
function AccessListField({
  label,
  values,
  resolvedNames,
}: {
  label: string
  values: string[]
  resolvedNames: Record<string, string>
}) {
  const hasWildcard = values.includes('*')
  const nonWildcard = values.filter((v) => v !== '*')

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      {values.length === 0 ? (
        <p className="text-sm text-muted-foreground">None</p>
      ) : (
        <div className="space-y-1.5">
          {hasWildcard && (
            <Badge variant="destructive" className="gap-1">
              Open to everyone (*)
            </Badge>
          )}
          {nonWildcard.length > 0 && (
            <TagInput
              values={nonWildcard}
              resolvedNames={resolvedNames}
              readOnly
            />
          )}
        </div>
      )}
    </div>
  )
}
