// ChannelsTab — paginated DataTable of newsletter/channel directory entries with bulk select.
// DO NOT CHANGE: entityType="newsletter" in BulkEditToolbar — shows Follow/Unfollow actions.
// DO NOT CHANGE: timestamps are Unix seconds — multiply by 1000 for Date constructor.
// No row click action — channels don't have individual DM settings.
// Verified working: Phase 21 Plan 02 (2026-03-18)

import { useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { DataTable } from '@/components/shared/DataTable'
import { BulkEditToolbar } from './BulkEditToolbar'
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

  // Column definitions — DO NOT CHANGE: ColumnDef<DirectoryContact> required for type safety
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
    {
      id: 'displayName',
      header: 'Channel Name',
      accessorKey: 'displayName',
      cell: ({ row }) => row.original.displayName ?? <span className="text-muted-foreground">Unknown</span>,
    },
    {
      id: 'jid',
      header: 'Newsletter JID',
      accessorKey: 'jid',
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground font-mono">{row.original.jid}</span>
      ),
    },
    {
      id: 'messageCount',
      header: 'Messages',
      accessorKey: 'messageCount',
    },
    {
      id: 'firstSeenAt',
      header: 'First Seen',
      accessorKey: 'firstSeenAt',
      // DO NOT CHANGE: timestamps are Unix seconds — multiply by 1000 for Date constructor
      cell: ({ row }) =>
        row.original.firstSeenAt
          ? new Date(row.original.firstSeenAt * 1000).toLocaleDateString()
          : '—',
    },
  ]

  const selectedJids = Object.keys(rowSelection).filter((jid) => rowSelection[jid])

  async function handleBulkAction(action: 'follow' | 'unfollow') {
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

      {/* Data table — no row click for channels */}
      <DataTable
        columns={columns}
        data={data}
        total={total}
        pagination={pagination}
        onPaginationChange={onPaginationChange}
        rowSelection={bulkMode ? rowSelection : undefined}
        onRowSelectionChange={bulkMode ? setRowSelection : undefined}
        loading={loading}
      />
    </div>
  )
}
