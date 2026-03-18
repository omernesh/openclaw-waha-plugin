// GroupsTab — paginated DataTable of groups with expandable participant rows.
// Clicking a group row expands to show ParticipantRow (lazy-loaded participants).
// Clicking the same row again collapses it.
// DO NOT CHANGE: uses ColumnDef<DirectoryContact>, expandedRowId, renderExpandedRow
// from DataTable — these are the correct props for expandable rows.
// Verified: Phase 21, Plan 03 (2026-03-18)

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/shared/DataTable'
import { ParticipantRow } from './ParticipantRow'
import type { DirectoryContact } from '@/types'

interface GroupsTabProps {
  data: DirectoryContact[]
  total: number
  pagination: { pageIndex: number; pageSize: number }
  onPaginationChange: (p: { pageIndex: number; pageSize: number }) => void
  loading: boolean
}

// Format a timestamp (ms since epoch) as a readable date string
function formatDate(ts: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

const columns: ColumnDef<DirectoryContact, unknown>[] = [
  {
    id: 'expand',
    header: '',
    cell: ({ row, table }) => {
      const expandedRowId = (table.options.meta as { expandedRowId?: string | null } | undefined)?.expandedRowId
      const isExpanded = expandedRowId === row.original.jid
      return (
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
        />
      )
    },
  },
  {
    accessorKey: 'displayName',
    header: 'Group Name',
    cell: ({ row }) => (
      <span className="font-medium">
        {row.original.displayName ?? 'Unknown Group'}
      </span>
    ),
  },
  {
    accessorKey: 'jid',
    header: 'JID',
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground font-mono">{row.original.jid}</span>
    ),
  },
  {
    accessorKey: 'messageCount',
    header: 'Messages',
    cell: ({ row }) => (
      <span className="text-sm">{row.original.messageCount}</span>
    ),
  },
  {
    accessorKey: 'lastMessageAt',
    header: 'Last Message',
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {formatDate(row.original.lastMessageAt)}
      </span>
    ),
  },
]

export function GroupsTab({
  data,
  total,
  pagination,
  onPaginationChange,
  loading,
}: GroupsTabProps) {
  const [expandedGroupJid, setExpandedGroupJid] = useState<string | null>(null)

  function handleRowClick(row: DirectoryContact) {
    // Toggle: collapse if already expanded, expand otherwise
    setExpandedGroupJid(prev => prev === row.jid ? null : row.jid)
  }

  // Reset expansion when page changes
  function handlePaginationChange(p: { pageIndex: number; pageSize: number }) {
    setExpandedGroupJid(null)
    onPaginationChange(p)
  }

  // Inject expandedRowId into table meta for the expand indicator column
  const columnsWithMeta = columns.map(col => ({
    ...col,
    meta: { expandedRowId: expandedGroupJid },
  }))

  return (
    <DataTable
      columns={columnsWithMeta}
      data={data}
      total={total}
      pagination={pagination}
      onPaginationChange={handlePaginationChange}
      onRowClick={handleRowClick}
      loading={loading}
      expandedRowId={expandedGroupJid}
      renderExpandedRow={(row) => <ParticipantRow groupJid={row.jid} />}
    />
  )
}
