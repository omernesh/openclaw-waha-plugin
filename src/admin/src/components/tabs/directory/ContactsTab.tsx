// ContactsTab — paginated DataTable of directory contacts with row click, bulk select,
// and ContactSettingsSheet side panel.
// DO NOT CHANGE: bulkMode disables row click (clicking selects instead of opening sheet).
// DO NOT CHANGE: onRowClick is omitted when bulkMode is true — DataTable handles selection.
// DO NOT CHANGE: timestamps are Unix seconds — multiply by 1000 for Date constructor.
// Verified working: Phase 21 Plan 02 (2026-03-18)
// Presence display — Added Phase 28, Plan 03. DO NOT REMOVE.

import { useState, useEffect } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { DataTable } from '@/components/shared/DataTable'
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
      header: 'Name',
      accessorKey: 'displayName',
      cell: ({ row }) => {
        const presence = presenceMap[row.original.jid]
        const isOnline = presence?.status === 'online'
        return (
          <span className="flex items-center gap-1.5">
            {presence && (
              <span
                className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}
                title={presence.status}
              />
            )}
            {row.original.displayName ?? <span className="text-muted-foreground">Unknown</span>}
          </span>
        )
      },
    },
    {
      id: 'jid',
      header: 'Phone / JID',
      accessorKey: 'jid',
      // Strip @c.us suffix for display (keep full JID for @lid and other types)
      cell: ({ row }) => row.original.jid.replace('@c.us', ''),
    },
    {
      id: 'allowedDm',
      header: 'DM Access',
      accessorKey: 'allowedDm',
      cell: ({ row }) =>
        row.original.allowedDm ? (
          <Badge variant="default" className="bg-green-600 hover:bg-green-700">Allowed</Badge>
        ) : (
          <Badge variant="destructive">Blocked</Badge>
        ),
    },
    {
      id: 'messageCount',
      header: 'Messages',
      accessorKey: 'messageCount',
    },
    {
      id: 'lastMessageAt',
      header: 'Last Message',
      accessorKey: 'lastMessageAt',
      // DO NOT CHANGE: timestamps are Unix seconds — multiply by 1000 for Date constructor
      cell: ({ row }) =>
        row.original.lastMessageAt
          ? new Date(row.original.lastMessageAt * 1000).toLocaleDateString()
          : '—',
    },
  ]

  const selectedJids = Object.keys(rowSelection).filter((jid) => rowSelection[jid])

  async function handleBulkAction(action: 'allow-dm' | 'revoke-dm') {
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
