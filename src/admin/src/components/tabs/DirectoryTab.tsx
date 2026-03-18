// DirectoryTab — 3 sub-tabs (Contacts, Groups, Channels) with centralized data fetching,
// debounced search, and server-side pagination.
// DO NOT CHANGE: debounce is 300ms to match TagInput pattern; pageIndex resets on search change.
// DO NOT CHANGE: refreshCounter increments to trigger re-fetch from sub-tab onRefresh callbacks.
// ContactsTab and ChannelsTab wired in Plan 02. GroupsTab wired in Plan 03.

import { useState, useRef, useEffect } from 'react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import { api } from '@/lib/api'
import type { DirectoryResponse } from '@/types'
import { GroupsTab } from './directory/GroupsTab'
import { ContactsTab } from './directory/ContactsTab'
import { ChannelsTab } from './directory/ChannelsTab'

interface DirectoryTabProps {
  selectedSession: string
  refreshKey: number
}

export default function DirectoryTab({ selectedSession: _selectedSession, refreshKey }: DirectoryTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<string>('contacts')
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 50 })
  const [data, setData] = useState<DirectoryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  // DO NOT CHANGE: refreshCounter triggers re-fetch when sub-tabs call onRefresh after bulk/settings changes
  const [refreshCounter, setRefreshCounter] = useState(0)

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

  // Map sub-tab to API type parameter
  const typeMap: Record<string, string> = { contacts: 'contact', groups: 'group', channels: 'newsletter' }

  // DO NOT CHANGE: refreshCounter added to deps so sub-tab onRefresh callbacks trigger re-fetch
  useEffect(() => {
    setLoading(true)
    const offset = pagination.pageIndex * pagination.pageSize
    api.getDirectory({
      type: typeMap[activeSubTab],
      search: searchQuery || undefined,
      limit: String(pagination.pageSize),
      offset: String(offset),
    }).then(r => {
      setData(r)
      setLoading(false)
    }).catch(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSubTab, searchQuery, pagination.pageIndex, pagination.pageSize, refreshKey, refreshCounter])

  // DO NOT CHANGE: refreshData increments refreshCounter to trigger useEffect re-fetch
  function refreshData() {
    setRefreshCounter(c => c + 1)
  }

  // Reset pagination and search on sub-tab change
  function handleSubTabChange(tab: string) {
    setActiveSubTab(tab)
    setSearchInput('')
    setSearchQuery('')
    setPagination({ pageIndex: 0, pageSize: 50 })
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search directory..."
          value={searchInput}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-8"
        />
      </div>

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
