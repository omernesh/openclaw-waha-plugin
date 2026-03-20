// GroupsTab — paginated DataTable of groups with expandable participant rows.
// Clicking a group row OR the Participants button expands to show ParticipantRow (lazy-loaded).
// Clicking the same row/button again collapses it.
// DO NOT CHANGE: uses ColumnDef<DirectoryContact>, expandedRowId, renderExpandedRow
// from DataTable — these are the correct props for expandable rows.
// Verified: Phase 21, Plan 03 (2026-03-18)
// Visual overhaul (Avatar, stacked name+JID, Participants button) — 260320-u7x
// Sortable column headers (Group, Members, Messages, Last Message) — 260320

import { useState } from 'react'
import { ChevronDown, Users } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/shared/DataTable'
import { Avatar } from '@/components/shared/Avatar'
import { ParticipantRow } from './ParticipantRow'
import type { DirectoryContact } from '@/types'

interface GroupsTabProps {
  data: DirectoryContact[]
  total: number
  pagination: { pageIndex: number; pageSize: number }
  onPaginationChange: (p: { pageIndex: number; pageSize: number }) => void
  loading: boolean
  onRefresh?: () => void  // reserved — trigger parent data reload after bulk/settings changes (wired but not yet consumed)
}

// Format a timestamp (seconds since epoch) as a readable date string
// DO NOT CHANGE: ts comes from WAHA API as Unix seconds, must multiply by 1000 for JS Date
function formatDate(ts: number): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function GroupsTab({
  data,
  total,
  pagination,
  onPaginationChange,
  loading,
  onRefresh: _onRefresh,
}: GroupsTabProps) {
  const [expandedGroupJid, setExpandedGroupJid] = useState<string | null>(null)

  function toggleGroup(jid: string) {
    setExpandedGroupJid(prev => prev === jid ? null : jid)
  }

  function handleRowClick(row: DirectoryContact) {
    // Toggle: collapse if already expanded, expand otherwise
    toggleGroup(row.jid)
  }

  // Reset expansion when page changes
  function handlePaginationChange(p: { pageIndex: number; pageSize: number }) {
    setExpandedGroupJid(null)
    onPaginationChange(p)
  }

  // Build columns inside component so we have access to expandedGroupJid and toggleGroup
  // meta.sortable + meta.sortValue enable client-side sorting in DataTable
  const columns: ColumnDef<DirectoryContact, unknown>[] = [
    // Group column: Avatar + stacked group name + JID
    {
      id: 'group',
      header: 'Group',
      meta: {
        sortable: true,
        sortValue: (row: DirectoryContact) => (row.displayName ?? '').toLowerCase(),
      },
      cell: ({ row }) => {
        return (
          <div className="flex items-center gap-2.5">
            <Avatar name={row.original.displayName} size="md" />
            <div className="flex flex-col min-w-0">
              <span className="font-medium leading-tight">
                {row.original.displayName ?? 'Unknown Group'}
              </span>
              <span className="text-xs text-muted-foreground font-mono leading-tight truncate">
                {row.original.jid}
              </span>
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'participantCount',
      header: 'Members',
      meta: {
        sortable: true,
        sortValue: (row: DirectoryContact) => row.participantCount ?? 0,
      },
      cell: ({ row }) => (
        <span className="text-sm">{row.original.participantCount ?? '—'}</span>
      ),
    },
    {
      accessorKey: 'messageCount',
      header: 'Messages',
      meta: {
        sortable: true,
        sortValue: (row: DirectoryContact) => row.messageCount ?? 0,
      },
      cell: ({ row }) => (
        <span className="text-sm">{row.original.messageCount}</span>
      ),
    },
    {
      accessorKey: 'lastMessageAt',
      header: 'Last Message',
      meta: {
        sortable: true,
        sortValue: (row: DirectoryContact) => row.lastMessageAt ?? 0,
      },
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {formatDate(row.original.lastMessageAt)}
        </span>
      ),
    },
    // Participants button — explicit expand toggle (also row click works)
    {
      id: 'participants',
      header: '',
      cell: ({ row }) => {
        const isExpanded = expandedGroupJid === row.original.jid
        return (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={(e) => {
              e.stopPropagation()
              toggleGroup(row.original.jid)
            }}
          >
            <Users className="h-3.5 w-3.5" />
            Participants
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            />
          </Button>
        )
      },
    },
  ]

  return (
    <DataTable
      columns={columns}
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
