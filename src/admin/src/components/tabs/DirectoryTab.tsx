// DirectoryTab — 3 sub-tabs (Contacts, Groups, Channels) with centralized data fetching,
// debounced search, and server-side pagination.
// DO NOT CHANGE: debounce is 300ms to match TagInput pattern; pageIndex resets on search change.
// DO NOT CHANGE: refreshCounter increments to trigger re-fetch from sub-tab onRefresh callbacks.
// ContactsTab and ChannelsTab wired in Plan 02. GroupsTab wired in Plan 03.

import { useState, useRef, useEffect } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Search, RefreshCw, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { DirectoryResponse } from '@/types'
import { GroupsTab } from './directory/GroupsTab'
import { ContactsTab } from './directory/ContactsTab'
import { ChannelsTab } from './directory/ChannelsTab'
import { Skeleton } from '@/components/ui/skeleton'

// Map sub-tab name to API type parameter — hoisted to module scope to avoid recreating on every render
const typeMap: Record<string, string> = { contacts: 'contact', groups: 'group', channels: 'newsletter' }

interface DirectoryTabProps {
  selectedSession: string
  refreshKey: number
  onLoadingChange?: (loading: boolean) => void
}

export default function DirectoryTab({ selectedSession: _selectedSession, refreshKey, onLoadingChange }: DirectoryTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<string>('contacts')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 })
  const [data, setData] = useState<DirectoryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // DO NOT CHANGE: refreshCounter triggers re-fetch when sub-tabs call onRefresh after bulk/settings changes
  const [refreshCounter, setRefreshCounter] = useState(0)

  // Report loading state to parent (drives TabHeader spinner)
  useEffect(() => { onLoadingChange?.(loading) }, [loading, onLoadingChange])

  // Debounced search — 300ms (matches TagInput pattern)
  function handleSearchChange(val: string) {
    setSearchInput(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearchQuery(val)
      // DO NOT REMOVE: reset to first page on new search (prevents empty page 3 of new results)
      setPagination(p => ({ ...p, pageIndex: 0 }))
    }, 300)
  }

  // typeMap hoisted to module scope (see top of file)

  // DO NOT CHANGE: refreshCounter added to deps so sub-tab onRefresh callbacks trigger re-fetch
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const offset = pagination.pageIndex * pagination.pageSize
    api.getDirectory({
      type: typeMap[activeSubTab],
      search: searchQuery || undefined,
      limit: String(pagination.pageSize),
      offset: String(offset),
    }).then(r => {
      if (controller.signal.aborted) return
      setData(r)
    }).catch((err) => {
      if (controller.signal.aborted) return
      console.error('Directory data fetch failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load directory')
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubTab, searchQuery, pagination.pageIndex, pagination.pageSize, refreshKey, refreshCounter])

  // DO NOT CHANGE: refreshData increments refreshCounter to trigger useEffect re-fetch
  function refreshData() {
    setRefreshCounter(c => c + 1)
  }

  // Refresh All: call API to resync directory from WAHA, then reload data
  async function handleRefreshAll() {
    try {
      await api.refreshDirectory()
      toast.success('Directory refreshed')
      refreshData()
    } catch (err) {
      toast.error('Refresh failed')
      console.error(err)
    }
  }

  // Reset pagination and search on sub-tab change
  function handleSubTabChange(tab: string) {
    setActiveSubTab(tab)
    setSearchInput('')
    setSearchQuery('')
    setPagination({ pageIndex: 0, pageSize: 25 })
  }

  // Show skeleton on initial load (no data yet)
  if (loading && data === null) {
    return (
      <div className="flex flex-col gap-4 p-1">
        <Skeleton className="h-[40px] w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    )
  }

  if (error && data === null) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p>Failed to load directory: {error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Sync status + Search bar + Refresh All toolbar */}
      <div className="flex items-center gap-2">
        {/* Sync status indicator */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground shrink-0">
          <CheckCircle className="h-3.5 w-3.5 text-green-500" />
          <span>Ready</span>
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search directory..."
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button variant="outline" size="sm" onClick={handleRefreshAll} className="shrink-0 gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh All
        </Button>
      </div>

      {/* Summary counts row */}
      {data && (
        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 px-1">
          <span>Contacts <span className="font-medium text-foreground">{data.dms}</span></span>
          <span>Groups <span className="font-medium text-foreground">{data.groups}</span></span>
          <span>Newsletters <span className="font-medium text-foreground">{data.newsletters}</span></span>
          <span className="text-muted-foreground/70">
            Showing {pagination.pageIndex * pagination.pageSize + 1}–{pagination.pageIndex * pagination.pageSize + data.contacts.length} of {data.total}
          </span>
        </div>
      )}

      {/* Sub-tabs — counts shown from API response totals */}
      <Tabs value={activeSubTab} onValueChange={handleSubTabChange}>
        <TabsList>
          <TabsTrigger value="contacts">
            Contacts{data ? ` (${data.dms})` : ''}
          </TabsTrigger>
          <TabsTrigger value="groups">
            Groups{data ? ` (${data.groups})` : ''}
          </TabsTrigger>
          <TabsTrigger value="channels">
            Channels{data ? ` (${data.newsletters})` : ''}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="contacts">
          {/* ContactsTab — wired in Plan 02 */}
          <ContactsTab
            data={data?.contacts ?? []}
            total={data?.total ?? 0}
            pagination={pagination}
            onPaginationChange={setPagination}
            loading={loading}
            onRefresh={refreshData}
          />
        </TabsContent>
        <TabsContent value="groups">
          {/* GroupsTab — wired in Plan 03 */}
          <GroupsTab
            data={data?.contacts ?? []}
            total={data?.total ?? 0}
            pagination={pagination}
            onPaginationChange={setPagination}
            loading={loading}
            onRefresh={refreshData}
          />
        </TabsContent>
        <TabsContent value="channels">
          {/* ChannelsTab — wired in Plan 02 */}
          <ChannelsTab
            data={data?.contacts ?? []}
            total={data?.total ?? 0}
            pagination={pagination}
            onPaginationChange={setPagination}
            loading={loading}
            onRefresh={refreshData}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
