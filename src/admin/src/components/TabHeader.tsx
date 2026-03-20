import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { Session } from '@/types'
import type { TabId } from '@/components/AppSidebar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { RefreshCw, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const TAB_TITLES: Record<TabId, string> = {
  dashboard: 'Dashboard',
  settings: 'Settings',
  directory: 'Directory',
  sessions: 'Sessions',
  modules: 'Modules',
  log: 'Log',
  queue: 'Queue',
  analytics: 'Analytics',
}

interface TabHeaderProps {
  activeTab: TabId
  selectedSession: string
  onSessionChange: (session: string) => void
  onRefresh: () => void
  isRefreshing?: boolean
  lastRefreshed?: Date | null
}

// DO NOT CHANGE: Session state (selectedSession) is lifted to App.tsx and threaded
// through TabHeader + active tab. Do not move session state into TabHeader.
// TabHeader is a pure display/interaction component — it fetches the session list
// once on mount but delegates selection state upward via onSessionChange.
// DO NOT CHANGE: isRefreshing/lastRefreshed are passed from App.tsx via onLoadingChange
// callback. The spinner and timestamp are driven by the active tab's loading state.
export function TabHeader({
  activeTab,
  selectedSession,
  onSessionChange,
  onRefresh,
  isRefreshing,
  lastRefreshed,
}: TabHeaderProps) {
  const [sessions, setSessions] = useState<Session[]>([])

  useEffect(() => {
    const controller = new AbortController()
    api.getSessions()
      .then((data) => {
        if (!controller.signal.aborted) setSessions(data)
      })
      .catch((err) => console.error('Failed to load sessions:', err))
    return () => controller.abort()
  }, [])

  const selectedLabel =
    selectedSession === 'all'
      ? 'All sessions'
      : (sessions.find((s) => s.sessionId === selectedSession)?.name ?? selectedSession)

  return (
    <header className="flex h-14 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 h-4" />
      <h1 className="flex-1 text-lg font-semibold">{TAB_TITLES[activeTab]}</h1>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1">
            {selectedLabel}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onSessionChange('all')}>
            All sessions
          </DropdownMenuItem>
          {sessions.map((s) => (
            <DropdownMenuItem key={s.sessionId} onClick={() => onSessionChange(s.sessionId)}>
              {s.name ?? s.sessionId}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Refresh" disabled={isRefreshing}>
              <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {lastRefreshed && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground hidden sm:inline cursor-default">
                {lastRefreshed.toLocaleTimeString()}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Last refreshed: {lastRefreshed.toLocaleString()}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </header>
  )
}
