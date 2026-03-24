// Phase 30: Analytics tab — recharts charts for message traffic and response time.
// DO NOT CHANGE: getAnalytics() is called with the selected range on every refreshKey change.
// DO NOT CHANGE: direct color values (#22c55e green, #3b82f6 blue, #f59e0b amber) used instead of
// CSS vars — shadcn chart theme vars may not be configured in all deployments.
import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import type { AnalyticsResponse } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

const MAX_CHAT_ID_DISPLAY_LEN = 25

const RANGE_OPTIONS = [
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
]

function formatPeriod(period: string, groupBy: 'minute' | 'hour' | 'day'): string {
  try {
    if (groupBy === 'day') {
      // period is "YYYY-MM-DD"
      const [, month, day] = period.split('-')
      return `${month}/${day}`
    }
    // period is "YYYY-MM-DDTHH:MM" or "YYYY-MM-DDTHH:00"
    const timePart = period.includes('T') ? period.split('T')[1] : period
    if (groupBy === 'hour') return timePart.substring(0, 5) // "HH:00"
    return timePart.substring(0, 5) // "HH:MM"
  } catch (err) {
    console.warn('formatPeriod:', period, err)
    return period
  }
}

function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

interface AnalyticsTabProps {
  selectedSession: string
  refreshKey: number
  onLoadingChange?: (loading: boolean) => void
}

// DO NOT CHANGE: AnalyticsTab — Phase 30 Analytics tab component.
// Fetches /api/admin/analytics on range change or refreshKey change.
// Uses recharts BarChart (stacked inbound/outbound) + LineChart (avg response time).
export default function AnalyticsTab({ refreshKey, onLoadingChange }: AnalyticsTabProps) {
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [range, setRange] = useState('24h')
  // Chat ID -> display name cache. Resolved via /api/admin/directory/resolve after analytics load.
  const [chatNames, setChatNames] = useState<Record<string, string>>({})
  const resolvedJidsRef = useRef<Set<string>>(new Set())

  // Report loading state to parent (drives TabHeader spinner)
  useEffect(() => { onLoadingChange?.(loading) }, [loading, onLoadingChange])

  // Resolve chat JIDs to display names after data loads. DO NOT REMOVE.
  const resolveTopChatNames = useCallback((topChats: AnalyticsResponse['topChats']) => {
    const jids = topChats.map((c) => c.chat_id).filter((jid) => !resolvedJidsRef.current.has(jid))
    if (jids.length === 0) return
    api.resolveNames(jids)
      .then(({ resolved }) => {
        jids.forEach((jid) => resolvedJidsRef.current.add(jid))
        setChatNames((prev) => ({ ...prev, ...resolved }))
      })
      .catch((err) => console.warn('Name resolution failed:', err))
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    api.getAnalytics(range)
      .then((d) => {
        if (controller.signal.aborted) return
        setData(d)
        if (d.topChats.length > 0) resolveTopChatNames(d.topChats)
      })
      .catch((err) => {
        console.error('Analytics fetch failed:', err)
        if (!controller.signal.aborted) setData(null)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, range])

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Skeleton className="h-[40px] w-[200px]" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[80px] w-full" />)}
        </div>
        <Skeleton className="h-[300px] w-full" />
        <Skeleton className="h-[250px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p>Failed to load analytics data.</p>
      </div>
    )
  }

  const chartData = data.timeseries.map((point) => ({
    ...point,
    label: formatPeriod(point.period, data.groupBy),
  }))

  const noData = data.summary.total === 0

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Range selector */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Range:</span>
        <div className="flex gap-1">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                range === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Messages</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.summary.total.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Inbound</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">{data.summary.inbound.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Outbound</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{data.summary.outbound.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Avg Response</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.summary.avg_duration_ms > 0 ? formatDuration(data.summary.avg_duration_ms) : '—'}</div>
          </CardContent>
        </Card>
      </div>

      {noData ? (
        <div className="flex flex-1 items-center justify-center py-16 text-muted-foreground">
          <p>No analytics data yet for this range. Send some messages and refresh.</p>
        </div>
      ) : (
        <>
          {/* Messages per period bar chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Messages</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12 }}
                    formatter={(value: unknown, name: unknown) => [Number(value).toLocaleString(), name as string]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="inbound" name="Inbound" stackId="a" fill="#22c55e" />
                  <Bar dataKey="outbound" name="Outbound" stackId="a" fill="#3b82f6" />
                  <Bar dataKey="errors" name="Errors" stackId="a" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Response time line chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Avg Response Time (ms)</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ fontSize: 12 }}
                    formatter={(value: unknown) => [`${Math.round(Number(value))}ms`, 'Avg Response']}
                  />
                  <Line
                    type="monotone"
                    dataKey="avg_duration_ms"
                    name="Avg Response"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Top chats table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Top Active Chats</CardTitle>
            </CardHeader>
            <CardContent>
              {data.topChats.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="pb-2 text-left font-medium text-muted-foreground">Chat</th>
                      <th className="pb-2 text-right font-medium text-muted-foreground">Total</th>
                      <th className="pb-2 text-right font-medium text-muted-foreground">Inbound</th>
                      <th className="pb-2 text-right font-medium text-muted-foreground">Outbound</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topChats.map((chat) => {
                      const name = chatNames[chat.chat_id]
                      const isGroup = chat.chat_id.endsWith('@g.us')
                      return (
                        <tr key={chat.chat_id} className="border-b last:border-0">
                          <td className="py-2" title={chat.chat_id}>
                            {name ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground">{isGroup ? '👥' : '💬'}</span>
                                <span className="text-sm font-medium truncate max-w-[200px]">{name}</span>
                              </div>
                            ) : (
                              <span className="font-mono text-xs text-muted-foreground">
                                {chat.chat_id.length > MAX_CHAT_ID_DISPLAY_LEN ? chat.chat_id.slice(0, MAX_CHAT_ID_DISPLAY_LEN) + '...' : chat.chat_id}
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right font-medium">{chat.total.toLocaleString()}</td>
                          <td className="py-2 text-right text-green-600 dark:text-green-400">{chat.inbound.toLocaleString()}</td>
                          <td className="py-2 text-right text-blue-600 dark:text-blue-400">{chat.outbound.toLocaleString()}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
