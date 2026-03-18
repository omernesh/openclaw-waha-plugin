import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { QueueResponse } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

interface QueueTabProps {
  selectedSession: string
  refreshKey: number
}

export default function QueueTab({ selectedSession: _selectedSession, refreshKey }: QueueTabProps) {
  const [data, setData] = useState<QueueResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    api.getQueue()
      .then((d) => {
        if (controller.signal.aborted) return
        setData(d)
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
        <div className="grid grid-cols-3 gap-4">
          <Skeleton className="h-[80px] w-full" />
          <Skeleton className="h-[80px] w-full" />
          <Skeleton className="h-[80px] w-full" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p>Failed to load queue data.</p>
      </div>
    )
  }

  // Derive processing state from queue depths — no "Paused" state on the server
  const isProcessing = data.dmDepth > 0 || data.groupDepth > 0

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Processing state badge */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Queue Status:</span>
        <Badge variant={isProcessing ? 'default' : 'secondary'}>
          {isProcessing ? 'Processing' : 'Idle'}
        </Badge>
      </div>

      {/* Row 1: Queue Depths */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">DM Queue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.dmDepth}</div>
            <p className="text-xs text-muted-foreground mt-1">messages pending</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Group Queue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{data.groupDepth}</div>
            <p className="text-xs text-muted-foreground mt-1">messages pending</p>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Total Processed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.totalProcessed.toLocaleString()}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Total Errors
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${data.totalErrors > 0 ? 'text-destructive' : ''}`}>
              {data.totalErrors.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              DM Overflow Drops
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${data.dmOverflowDrops > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
              {data.dmOverflowDrops.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Group Overflow Drops
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${data.groupOverflowDrops > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
              {data.groupOverflowDrops.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
