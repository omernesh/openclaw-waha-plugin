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

const TAB_TITLES: Record<TabId, string> = {
  dashboard: 'Dashboard',
  settings: 'Settings',
  directory: 'Directory',
  sessions: 'Sessions',
  modules: 'Modules',
  log: 'Log',
  queue: 'Queue',
}

interface TabHeaderProps {
  activeTab: TabId
  selectedSession: string
  onSessionChange: (session: string) => void
  onRefresh: () => void
}

// DO NOT CHANGE: Session state (selectedSession) is lifted to App.tsx and threaded
// through TabHeader + active tab. Do not move session state into TabHeader.
// TabHeader is a pure display/interaction component — it fetches the session list
// once on mount but delegates selection state upward via onSessionChange.
export function TabHeader({
  activeTab,
  selectedSession,
  onSessionChange,
  onRefresh,
}: TabHeaderProps) {
  const [sessions, setSessions] = useState<Session[]>([])

  useEffect(() => {
    const controller = new AbortController()
    api.getSessions()
      .then((data) => {
        if (!controller.signal.aborted) setSessions(data)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  const selectedLabel =
    selectedSession === 'all'
      ? 'All sessions'
      : (sessions.find((s) => s.id === selectedSession)?.name ?? selectedSession)

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
            <DropdownMenuItem key={s.id} onClick={() => onSessionChange(s.id)}>
              {s.name ?? s.id}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="ghost" size="icon" onClick={onRefresh} aria-label="Refresh">
        <RefreshCw className="h-4 w-4" />
      </Button>
    </header>
  )
}
