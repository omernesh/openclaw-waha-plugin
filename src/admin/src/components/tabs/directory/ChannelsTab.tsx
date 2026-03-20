// ChannelsTab — paginated DataTable of newsletter/channel directory entries with bulk select.
// DO NOT CHANGE: entityType="newsletter" in BulkEditToolbar — shows Follow/Unfollow actions.
// DO NOT CHANGE: timestamps are Unix seconds — multiply by 1000 for Date constructor.
// Row click opens ContactSettingsSheet for per-channel settings (added 260320-rii).
// Verified working: Phase 21 Plan 02 (2026-03-18)
// Visual overhaul (Avatar, stacked name+JID, Allow DM button, Settings button) — 260320-u7x
// Sortable column headers (Channel, Messages, First Seen, DM Access) — 260320

import { useState } from 'react'
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

interface ChannelsTabProps {
  data: DirectoryContact[]      // channels are also DirectoryContact entries (jid ends with @newsletter)
  total: number
  pagination: { pageIndex: number; pageSize: number }
  onPaginationChange: (p: { pageIndex: number; pageSize: number }) => void
  loading: boolean
  onRefresh: () => void
}

export function ChannelsTab({
  data,
  total,
  pagination,
  onPaginationChange,
  loading,
  onRefresh,
}: ChannelsTabProps) {
  const [bulkMode, setBulkMode] = useState(false)
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  // Per-channel settings sheet (same as ContactsTab pattern)
  const [selectedJid, setSelectedJid] = useState<string | null>(null)
  const selectedChannel = selectedJid ? data.find((d) => d.jid === selectedJid) ?? null : null
  // Double-click protection: tracks which JID's Allow DM toggle is in flight
  const [togglingJid, setTogglingJid] = useState<string | null>(null)

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
    // Channel column: Avatar + stacked name + JID
    {
      id: 'channel',
      header: 'Channel',
      meta: {
        sortable: true,
        sortValue: (row: DirectoryContact) => (row.displayName ?? '').toLowerCase(),
      },
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5">
          <Avatar name={row.original.displayName} size="md" />
          <div className="flex flex-col min-w-0">
            <span className="font-medium leading-tight">
              {row.original.displayName ?? <span className="text-muted-foreground">Unknown</span>}
            </span>
            <span className="text-xs text-muted-foreground font-mono leading-tight truncate">
              {row.original.jid}
            </span>
          </div>
        </div>
      ),
    },
    // Allow DM button — clickable toggle
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
        const isToggling = togglingJid === row.original.jid
        return (
          <Button
            variant="outline"
            size="sm"
            disabled={isToggling}
            className={allowed ? 'text-green-600 border-green-600 hover:bg-green-50' : ''}
            onClick={async (e) => {
              e.stopPropagation()
              setTogglingJid(row.original.jid)
              try {
                await api.toggleAllowDm(row.original.jid, { allowed: !allowed })
                toast.success(allowed ? 'DM access revoked' : 'DM access granted')
                onRefresh()
              } catch (err) {
                toast.error('Failed to update DM access')
                console.error(err)
              } finally {
                setTogglingJid(null)
              }
            }}
          >
            {isToggling ? 'Updating...' : allowed ? 'Allowed' : 'Allow DM'}
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
      id: 'firstSeenAt',
      header: 'First Seen',
      accessorKey: 'firstSeenAt',
      meta: {
        sortable: true,
        sortValue: (row: DirectoryContact) => row.firstSeenAt ?? 0,
      },
      // DO NOT CHANGE: timestamps are Unix seconds — multiply by 1000 for Date constructor
      cell: ({ row }) =>
        row.original.firstSeenAt
          ? new Date(row.original.firstSeenAt * 1000).toLocaleDateString()
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
    // Only follow and unfollow are valid for newsletters — ignore other action types
    if (action !== 'follow' && action !== 'unfollow') return
    if (selectedJids.length === 0) return
    try {
      const result = await api.bulkDirectory({ action, jids: selectedJids })
      toast.success(`${action === 'follow' ? 'Followed' : 'Unfollowed'} ${result.updated} channel(s)`)
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

      {/* Bulk action toolbar — DO NOT CHANGE: entityType="newsletter" for Follow/Unfollow */}
      {bulkMode && (
        <BulkEditToolbar
          selectedCount={selectedJids.length}
          entityType="newsletter"
          onAction={handleBulkAction}
          onCancel={handleCancelBulk}
        />
      )}

      {/* Data table — row click opens settings sheet when not in bulk mode */}
      <DataTable
        columns={columns}
        data={data}
        total={total}
        pagination={pagination}
        onPaginationChange={onPaginationChange}
        rowSelection={bulkMode ? rowSelection : undefined}
        onRowSelectionChange={bulkMode ? setRowSelection : undefined}
        onRowClick={bulkMode ? undefined : (row) => setSelectedJid(row.jid)}
        loading={loading}
      />

      {/* Per-channel settings sheet — identical to ContactsTab pattern */}
      <ContactSettingsSheet
        jid={selectedJid}
        displayName={selectedChannel?.displayName ?? null}
        dmSettings={selectedChannel?.dmSettings}
        allowedDm={selectedChannel?.allowedDm ?? false}
        onClose={() => setSelectedJid(null)}
        onSaved={onRefresh}
      />
    </div>
  )
}
