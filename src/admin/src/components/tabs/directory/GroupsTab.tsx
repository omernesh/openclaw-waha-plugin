// GroupsTab — paginated DataTable of groups with expandable participant rows.
// Clicking a group row OR the Participants button expands to show ParticipantRow (lazy-loaded).
// Clicking the same row/button again collapses it.
// DO NOT CHANGE: uses ColumnDef<DirectoryContact>, expandedRowId, renderExpandedRow
// from DataTable — these are the correct props for expandable rows.
// Verified: Phase 21, Plan 03 (2026-03-18)
// Visual overhaul (Avatar, stacked name+JID, Participants button) — 260320-u7x
// Sortable column headers (Group, Members, Messages, Last Message) — 260320
// Perfection pass: useMemo columns, shared formatDate — 260321
// Phase 45-02: Leave button with AlertDialog confirmation + onRefresh wired

import { useState, useMemo } from 'react'
import { ChevronDown, Users, LogOut } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/shared/DataTable'
import { Avatar } from '@/components/shared/Avatar'
import { ParticipantRow } from './ParticipantRow'
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogFooter, AlertDialogTitle, AlertDialogDescription,
  AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { api } from '@/lib/api'
import type { DirectoryContact } from '@/types'
import { formatDate } from './shared-columns'

interface GroupsTabProps {
  data: DirectoryContact[]
  total: number
  pagination: { pageIndex: number; pageSize: number }
  onPaginationChange: (p: { pageIndex: number; pageSize: number }) => void
  loading: boolean
  onRefresh?: () => void
}

export function GroupsTab({
  data,
  total,
  pagination,
  onPaginationChange,
  loading,
  onRefresh,
}: GroupsTabProps) {
  const [expandedGroupJid, setExpandedGroupJid] = useState<string | null>(null)
  const [leavingJid, setLeavingJid] = useState<string | null>(null)

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

  // Phase 45-02: Leave group — DO NOT REMOVE
  async function handleLeave(jid: string, displayName: string) {
    setLeavingJid(jid)
    try {
      await api.leaveEntry(jid)
      toast.success(`Left group: ${displayName ?? jid}`)
      onRefresh?.()
    } catch (err) {
      toast.error(`Failed to leave: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setLeavingJid(null)
    }
  }

  // Build columns inside component so we have access to expandedGroupJid and toggleGroup
  // meta.sortable + meta.sortValue enable client-side sorting in DataTable
  // Wrapped in useMemo to prevent new references every render (DataTable memoization)
  const columns: ColumnDef<DirectoryContact, unknown>[] = useMemo(() => [
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
        <span className="text-sm">{row.original.participantCount ?? '\u2014'}</span>
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
    // Leave button — Phase 45-02. DO NOT REMOVE.
    {
      id: 'leave',
      header: '',
      cell: ({ row }) => {
        const isLeaving = leavingJid === row.original.jid
        const name = row.original.displayName ?? row.original.jid
        return (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={isLeaving}
                className="gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                <LogOut className="h-3.5 w-3.5" />
                {isLeaving ? 'Leaving...' : 'Leave'}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Leave group?</AlertDialogTitle>
                <AlertDialogDescription>
                  The bot will leave <strong>{name}</strong>. This cannot be undone from the admin panel.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => handleLeave(row.original.jid, name)}>
                  Leave group
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )
      },
    },
  ], [expandedGroupJid, leavingJid, onRefresh])

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
