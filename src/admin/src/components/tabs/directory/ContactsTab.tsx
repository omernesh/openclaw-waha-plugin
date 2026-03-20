// ContactsTab — paginated DataTable of directory contacts with row click, bulk select,
// and ContactSettingsSheet side panel.
// DO NOT CHANGE: bulkMode disables row click (clicking selects instead of opening sheet).
// DO NOT CHANGE: onRowClick is omitted when bulkMode is true — DataTable handles selection.
// DO NOT CHANGE: timestamps are Unix seconds — multiply by 1000 for Date constructor.
// Verified working: Phase 21 Plan 02 (2026-03-18)
// Presence display — Added Phase 28, Plan 03. DO NOT REMOVE.
// Visual overhaul (Avatar, stacked name+JID, Allow DM button, Settings button) — 260320-u7x
// Sortable column headers (Name, Messages, Last Message, DM Access) — 260320

import { useState, useEffect } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import { toast } from 'sonner'
import { DataTable } from '@/components/shared/DataTable'
import { Avatar } from '@/components/shared/Avatar'
import { BulkEditToolbar } from './BulkEditToolbar'
import { ContactSettingsSheet } from './ContactSettingsSheet'
import { api } from '@/lib/api'
import type { DirectoryContact } from '@/types'

interface ContactsTabProps {
  data: DirectoryContact[]
  total: number
  pagination: { pageIndex: number; pageSize: number }
  onPaginationChange: (p: { pageIndex: number; pageSize: number }) => void
  loading: boolean
  onRefresh: () => void         // trigger data reload after settings change
}

export function ContactsTab({
  data,
  total,
  pagination,
  onPaginationChange,
  loading,
  onRefresh,
}: ContactsTabProps) {
  const [bulkMode, setBulkMode] = useState(false)
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [selectedJid, setSelectedJid] = useState<string | null>(null)
  // Presence display — Added Phase 28, Plan 03. DO NOT REMOVE.
  // Fetched once on mount from GET /api/admin/presence. Keyed by contact JID.
  const [presenceMap, setPresenceMap] = useState<Record<string, { status: string; lastSeen?: number }>>({})

  useEffect(() => {
    fetch('/api/admin/presence')
      .then((r) => r.json())
      .then((data: { presence?: Array<{ id: string; status?: string; lastSeen?: number }> }) => {
        if (!Array.isArray(data.presence)) return
        const map: Record<string, { status: string; lastSeen?: number }> = {}
        for (const p of data.presence) {
          if (p.id) map[p.id] = { status: p.status ?? 'offline', lastSeen: p.lastSeen }
        }
        setPresenceMap(map)
      })
      .catch((err) => console.error('[waha] presence fetch failed:', err))
  }, [])

  // Find the currently selected contact for the sheet
  const selectedContact = selectedJid ? data.find((c) => c.jid === selectedJid) ?? null : null

  // Column definitions — DO NOT CHANGE: ColumnDef<DirectoryContact> required for type safety
  // meta.sortable + meta.sortValue enable client-side sorting in DataTable
  const columns: ColumnDef<DirectoryContact, unknown>[] = [
    // Select column — only visible in bulk mode
    ...(bulkMode
      ? [
          {
            id: 'select',
            header: ({ table }: { table: import('@tanstack/react-table').Table<DirectoryContact> }) => (
              <Checkbox
                checked={table.getIsAllPageRowsSelected()}
                onCheckedChange={(checked) => table.toggleAllPageRowsSelected(!!checked)}
                aria-label="Select all"
              />
            ),
            cell: ({ row }: { row: import('@tanstack/react-table').Row<DirectoryContact> }) => (
              <Checkbox
                checked={row.getIsSelected()}
                onCheckedChange={(checked) => row.toggleSelected(!!checked)}
                onClick={(e) => e.stopPropagation()}
                aria-label="Select row"
              />
            ),
          } as ColumnDef<DirectoryContact, unknown>,
        ]
      : []),
    // Name column: Avatar + stacked displayName / JID (with presence dot overlay on name)
    {
      id: 'name',
      header: 'Name',
      meta: {
        sortable: true,
        sortValue: (row: DirectoryContact) => (row.displayName ?? '').toLowerCase(),
      },
      cell: ({ row }) => {
        const presence = presenceMap[row.original.jid]
        const isOnline = presence?.status === 'online'
        const displayJid = row.original.jid.replace('@c.us', '')
        return (
          <div className="flex items-center gap-2.5">
            <Avatar name={row.original.displayName} size="md" />
            <div className="flex flex-col min-w-0">
              <span className="flex items-center gap-1.5 font-medium leading-tight">
                {/* DO NOT REMOVE: presence dot — Added Phase 28, Plan 03 */}
                {presence && (
                  <span
                    className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}
                    title={presence.status}
                  />
                )}
                {row.original.displayName ?? <span className="text-muted-foreground">Unknown</span>}
              </span>
              <span className="text-xs text-muted-foreground font-mono leading-tight truncate">{displayJid}</span>
            </div>
          </div>
        )
      },
    },
    // Allow DM button — clickable toggle (replaces read-only Badge)
    {
      id: 'allowedDm',
      header: 'DM Access',
      accessorKey: 'allowedDm',
      meta: {
        sortable: true,
        sortValue: (row: DirectoryContact) => row.allowedDm ? 1 : 0,
      },
      cell: ({ row }) => {
        const allowed = row.original.allowedDm
        return (
          <Button
            variant="outline"
            size="sm"
            className={allowed ? 'text-green-600 border-green-600 hover:bg-green-50' : ''}
            onClick={async (e) => {
              e.stopPropagation()
              try {
                await api.toggleAllowDm(row.original.jid, { allowed: !allowed })
                toast.success(allowed ? 'DM access revoked' : 'DM access granted')
                onRefresh()
              } catch (err) {
                toast.error('Failed to update DM access')
                console.error(err)
              }
            }}
          >
            {allowed ? 'Allowed' : 'Allow DM'}
          </Button>
        )
      },
    },
    {
      id: 'messageCount',
      header: 'Messages',
      accessorKey: 'messageCount',
      meta: {
        sortable: true,
        sortValue: (row: DirectoryContact) => row.messageCount ?? 0,
      },
    },
    {
      id: 'lastMessageAt',
      header: 'Last Message',
      accessorKey: 'lastMessageAt',
      meta: {
        sortable: true,
        sortValue: (row: DirectoryContact) => row.lastMessageAt ?? 0,
      },
      // DO NOT CHANGE: timestamps are Unix seconds — multiply by 1000 for Date constructor
      cell: ({ row }) =>
        row.original.lastMessageAt
          ? new Date(row.original.lastMessageAt * 1000).toLocaleDateString()
          : '—',
    },
    // Settings button — opens ContactSettingsSheet
    {
      id: 'settings',
      header: '',
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={(e) => {
            e.stopPropagation()
            setSelectedJid(row.original.jid)
          }}
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </Button>
      ),
    },
  ]

  const selectedJids = Object.keys(rowSelection).filter((jid) => rowSelection[jid])

  async function handleBulkAction(action: 'allow-dm' | 'revoke-dm' | 'follow' | 'unfollow') {
    // Only allow-dm and revoke-dm are valid for contacts — ignore other action types
    if (action !== 'allow-dm' && action !== 'revoke-dm') return
    if (selectedJids.length === 0) return
    try {
      const result = await api.bulkDirectory({ action, jids: selectedJids })
      toast.success(`${action === 'allow-dm' ? 'Granted' : 'Revoked'} DM access for ${result.updated} contact(s)`)
      setRowSelection({})
      onRefresh()
    } catch (err) {
      toast.error('Bulk action failed')
      console.error(err)
    }
  }

  function handleCancelBulk() {
    setBulkMode(false)
    setRowSelection({})
  }

  function handleToggleBulkMode() {
    if (bulkMode) {
      handleCancelBulk()
    } else {
      setBulkMode(true)
      setRowSelection({})
    }
  }

  return (
    <div className="space-y-3">
      {/* Top bar: bulk mode toggle */}
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleToggleBulkMode}>
          {bulkMode ? 'Cancel Select' : 'Select'}
        </Button>
      </div>

      {/* Bulk action toolbar — only visible when bulk mode is on and rows are selected */}
      {bulkMode && (
        <BulkEditToolbar
          selectedCount={selectedJids.length}
          entityType="contact"
          onAction={handleBulkAction}
          onCancel={handleCancelBulk}
        />
      )}

      {/* Data table */}
      <DataTable
        columns={columns}
        data={data}
        total={total}
        pagination={pagination}
        onPaginationChange={onPaginationChange}
        rowSelection={bulkMode ? rowSelection : undefined}
        onRowSelectionChange={bulkMode ? setRowSelection : undefined}
        // DO NOT CHANGE: row click opens sheet only when bulk mode is OFF
        onRowClick={bulkMode ? undefined : (row) => setSelectedJid(row.jid)}
        loading={loading}
      />

      {/* Contact settings sheet — open when selectedJid is set */}
      <ContactSettingsSheet
        jid={selectedJid}
        displayName={selectedContact?.displayName ?? null}
        dmSettings={selectedContact?.dmSettings}
        allowedDm={selectedContact?.allowedDm ?? false}
        onClose={() => setSelectedJid(null)}
        // DO NOT CHANGE: onSaved refreshes data but does NOT close the sheet
        onSaved={() => { onRefresh() }}
      />
    </div>
  )
}
