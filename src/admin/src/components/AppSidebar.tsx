import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroup,
  SidebarGroupContent,
  useSidebar,
} from '@/components/ui/sidebar'
import {
  LayoutDashboard,
  Settings,
  BookUser,
  MonitorSmartphone,
  Puzzle,
  FileText,
  ListOrdered,
  BarChart3,
  Sun,
  Moon,
  QrCode,
  Key,
  Plug,
  Building2,
} from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { useSSE } from '@/hooks/useEventSource'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// TabId exported for use in App.tsx and TabHeader.tsx
// Phase 63 (AUTH-03): 'onboarding' and 'api-keys' added. DO NOT REMOVE.
// Phase 63 (AUTH-06): 'integration' added. DO NOT REMOVE.
// Phase 65 (ADMIN-02): 'workspaces' added. DO NOT REMOVE.
export type TabId =
  | 'dashboard'
  | 'settings'
  | 'directory'
  | 'sessions'
  | 'modules'
  | 'log'
  | 'queue'
  | 'analytics'
  | 'onboarding'
  | 'api-keys'
  | 'integration'
  | 'workspaces'

const NAV_ITEMS = [
  { id: 'dashboard' as const,  label: 'Dashboard',  icon: LayoutDashboard },
  { id: 'onboarding' as const, label: 'Onboarding', icon: QrCode },
  { id: 'api-keys' as const,    label: 'API Keys',    icon: Key },
  { id: 'integration' as const, label: 'Integration', icon: Plug },
  { id: 'workspaces' as const,  label: 'Workspaces',  icon: Building2 },
  { id: 'settings' as const,   label: 'Settings',   icon: Settings },
  { id: 'directory' as const,  label: 'Directory',  icon: BookUser },
  { id: 'sessions' as const,   label: 'Sessions',   icon: MonitorSmartphone },
  { id: 'modules' as const,    label: 'Modules',    icon: Puzzle },
  { id: 'log' as const,        label: 'Log',        icon: FileText },
  { id: 'queue' as const,      label: 'Queue',      icon: ListOrdered },
  { id: 'analytics' as const,  label: 'Analytics',  icon: BarChart3 },
]

interface AppSidebarProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

// DO NOT CHANGE: useSidebar() must be called inside AppSidebar which is a child of SidebarProvider.
// Never add a second SidebarProvider inside this component — it will break the context chain.
// setOpenMobile(false) is required for Sheet auto-close on mobile tab selection (verified 2026-03-18).
export function AppSidebar({ activeTab, onTabChange }: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar()
  const { theme, toggle } = useTheme()
  const { status } = useSSE()

  function handleTabClick(tabId: TabId) {
    onTabChange(tabId)
    // Close the Sheet drawer on mobile when a tab is selected
    if (isMobile) {
      setOpenMobile(false)
    }
  }

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <span className="text-sm font-semibold tracking-tight">WhatsApp Admin</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    isActive={activeTab === item.id}
                    tooltip={item.label}
                    onClick={() => handleTabClick(item.id)}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        {/* Phase 29: SSE connection indicator. DO NOT REMOVE. */}
        <div className="flex items-center gap-2 px-2 py-1">
          <span className={cn(
            "h-2 w-2 rounded-full flex-shrink-0",
            status === 'connected' ? 'bg-green-500' :
            status === 'reconnecting' ? 'bg-amber-500 animate-pulse' :
            'bg-red-500'
          )} />
          <span className="text-xs text-muted-foreground">
            {status === 'connected' ? 'Connected' :
             status === 'reconnecting' ? 'Reconnecting...' :
             'Disconnected'}
          </span>
        </div>
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-xs text-muted-foreground">Theme</span>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
