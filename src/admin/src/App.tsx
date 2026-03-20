import { useState, useCallback, lazy, Suspense } from 'react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar, type TabId } from '@/components/AppSidebar'
import { TabHeader } from '@/components/TabHeader'
import { TabErrorBoundary } from '@/components/shared/TabErrorBoundary'
import { Skeleton } from '@/components/ui/skeleton'
// Phase 29: SSEProvider shares one EventSource connection across all tabs. DO NOT REMOVE.
import { SSEProvider } from '@/hooks/useEventSource'

// Heavy tabs — code-split with React.lazy() to reduce initial bundle size.
// LogTab and QueueTab are left eager (small, frequently needed).
const DashboardTab = lazy(() => import('@/components/tabs/DashboardTab'))
const SettingsTab = lazy(() => import('@/components/tabs/SettingsTab'))
const DirectoryTab = lazy(() => import('@/components/tabs/DirectoryTab'))
const SessionsTab = lazy(() => import('@/components/tabs/SessionsTab'))
const ModulesTab = lazy(() => import('@/components/tabs/ModulesTab'))
// Phase 30: Analytics tab — recharts charts for message traffic.
const AnalyticsTab = lazy(() => import('@/components/tabs/AnalyticsTab'))

// Small tabs — keep eager (fast, lightweight)
import LogTab from '@/components/tabs/LogTab'
import QueueTab from '@/components/tabs/QueueTab'

// Fallback shown while a lazy tab chunk is loading
function TabSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-1">
      <Skeleton className="h-[40px] w-full" />
      <Skeleton className="h-[400px] w-full" />
    </div>
  )
}

// DO NOT CHANGE: All state (activeTab, selectedSession, refreshKey, isRefreshing, lastRefreshed)
// is lifted to App.tsx. This is intentional — it ensures tab switches don't reset session
// selection or refresh state. SidebarProvider must remain the outermost wrapper — only ONE
// SidebarProvider in the app. AppSidebar must be a direct child of SidebarProvider so
// useSidebar() works inside it.
// DO NOT CHANGE: handleTabLoadingChange is the single callback passed to all 7 tabs via
// onLoadingChange. It drives the TabHeader spinner (isRefreshing) and timestamp (lastRefreshed).
export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  const [selectedSession, setSelectedSession] = useState<string>('all')
  const [refreshKey, setRefreshKey] = useState<number>(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const handleTabLoadingChange = useCallback((loading: boolean) => {
    setIsRefreshing(loading)
    if (!loading) setLastRefreshed(new Date())
  }, [])

  function renderActiveTab() {
    const props = { selectedSession, refreshKey, onLoadingChange: handleTabLoadingChange }
    switch (activeTab) {
      case 'dashboard': return <TabErrorBoundary key={refreshKey} tabName="dashboard"><Suspense fallback={<TabSkeleton />}><DashboardTab {...props} /></Suspense></TabErrorBoundary>
      case 'settings':  return <TabErrorBoundary key={refreshKey} tabName="settings"><Suspense fallback={<TabSkeleton />}><SettingsTab {...props} /></Suspense></TabErrorBoundary>
      case 'directory': return <TabErrorBoundary key={refreshKey} tabName="directory"><Suspense fallback={<TabSkeleton />}><DirectoryTab {...props} /></Suspense></TabErrorBoundary>
      case 'sessions':  return <TabErrorBoundary key={refreshKey} tabName="sessions"><Suspense fallback={<TabSkeleton />}><SessionsTab {...props} /></Suspense></TabErrorBoundary>
      case 'modules':   return <TabErrorBoundary key={refreshKey} tabName="modules"><Suspense fallback={<TabSkeleton />}><ModulesTab {...props} /></Suspense></TabErrorBoundary>
      case 'log':       return <TabErrorBoundary key={refreshKey} tabName="log"><LogTab {...props} /></TabErrorBoundary>
      case 'queue':     return <TabErrorBoundary key={refreshKey} tabName="queue"><QueueTab {...props} /></TabErrorBoundary>
      case 'analytics': return <TabErrorBoundary key={refreshKey} tabName="analytics"><Suspense fallback={<TabSkeleton />}><AnalyticsTab {...props} /></Suspense></TabErrorBoundary>
    }
  }

  return (
    <SidebarProvider>
      {/* Phase 29: SSEProvider inside SidebarProvider so all tabs share one EventSource. DO NOT REMOVE. */}
      <SSEProvider>
        <AppSidebar activeTab={activeTab} onTabChange={setActiveTab} />
        <SidebarInset>
          <TabHeader
            activeTab={activeTab}
            selectedSession={selectedSession}
            onSessionChange={setSelectedSession}
            onRefresh={() => setRefreshKey((k) => k + 1)}
            isRefreshing={isRefreshing}
            lastRefreshed={lastRefreshed}
          />
          <main className="flex flex-1 flex-col overflow-auto p-4">
            {renderActiveTab()}
          </main>
          <footer className="border-t px-4 py-2 text-xs text-muted-foreground text-center">
            Created with love by{' '}
            <a href="https://github.com/omernesh" target="_blank" rel="noreferrer" className="underline hover:text-foreground">
              omer nesher
            </a>
            {' — '}
            <a href="https://github.com/omernesh/openclaw-waha-plugin" target="_blank" rel="noreferrer" className="underline hover:text-foreground">
              GitHub
            </a>
          </footer>
        </SidebarInset>
      </SSEProvider>
    </SidebarProvider>
  )
}
