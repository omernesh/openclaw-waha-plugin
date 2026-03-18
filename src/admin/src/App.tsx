import { useState } from 'react'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar, type TabId } from '@/components/AppSidebar'
import { TabHeader } from '@/components/TabHeader'
import { TabErrorBoundary } from '@/components/shared/TabErrorBoundary'

// Import all 7 tab placeholder components
import DashboardTab from '@/components/tabs/DashboardTab'
import SettingsTab from '@/components/tabs/SettingsTab'
import DirectoryTab from '@/components/tabs/DirectoryTab'
import SessionsTab from '@/components/tabs/SessionsTab'
import ModulesTab from '@/components/tabs/ModulesTab'
import LogTab from '@/components/tabs/LogTab'
import QueueTab from '@/components/tabs/QueueTab'

// DO NOT CHANGE: All state (activeTab, selectedSession, refreshKey) is lifted to App.tsx.
// This is intentional — it ensures tab switches don't reset session selection or refresh state.
// SidebarProvider must remain the outermost wrapper — only ONE SidebarProvider in the app.
// AppSidebar must be a direct child of SidebarProvider so useSidebar() works inside it.
export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard')
  const [selectedSession, setSelectedSession] = useState<string>('all')
  const [refreshKey, setRefreshKey] = useState<number>(0)

  function renderActiveTab() {
    const props = { selectedSession, refreshKey }
    switch (activeTab) {
      case 'dashboard': return <TabErrorBoundary key={refreshKey} tabName="dashboard"><DashboardTab {...props} /></TabErrorBoundary>
      case 'settings':  return <TabErrorBoundary key={refreshKey} tabName="settings"><SettingsTab {...props} /></TabErrorBoundary>
      case 'directory': return <TabErrorBoundary key={refreshKey} tabName="directory"><DirectoryTab {...props} /></TabErrorBoundary>
      case 'sessions':  return <TabErrorBoundary key={refreshKey} tabName="sessions"><SessionsTab {...props} /></TabErrorBoundary>
      case 'modules':   return <TabErrorBoundary key={refreshKey} tabName="modules"><ModulesTab {...props} /></TabErrorBoundary>
      case 'log':       return <TabErrorBoundary key={refreshKey} tabName="log"><LogTab {...props} /></TabErrorBoundary>
      case 'queue':     return <TabErrorBoundary key={refreshKey} tabName="queue"><QueueTab {...props} /></TabErrorBoundary>
    }
  }

  return (
    <SidebarProvider>
      <AppSidebar activeTab={activeTab} onTabChange={setActiveTab} />
      <SidebarInset>
        <TabHeader
          activeTab={activeTab}
          selectedSession={selectedSession}
          onSessionChange={setSelectedSession}
          onRefresh={() => setRefreshKey((k) => k + 1)}
        />
        <main className="flex flex-1 flex-col overflow-auto p-4">
          {renderActiveTab()}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
