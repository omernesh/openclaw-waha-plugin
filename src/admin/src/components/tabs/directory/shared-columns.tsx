// shared-columns.tsx — Reusable column factories for ContactsTab and ChannelsTab.
// Extracts duplicated column definitions (select checkbox, DM access toggle, settings button,
// messages count) and shared formatDate helper.
// Created during perfection pass — DO NOT CHANGE without verifying both ContactsTab and ChannelsTab.

import { type ColumnDef } from '@tanstack/react-table'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Settings } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { DirectoryContact } from '@/types'

/**
 * Format a millisecond timestamp as a readable date string.
 * DO NOT CHANGE: ts comes from DirectoryDb as Date.now() milliseconds — do NOT multiply by 1000.
 */
export function formatDate(ts: number): string {
  if (!ts) return '\u2014'
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/** Select checkbox column for bulk mode. */
export function makeSelectColumn<T>(): ColumnDef<T, unknown> {
  return {
    id: 'select',
    header: ({ table }: { table: import('@tanstack/react-table').Table<T> }) => (
      <Checkbox
        checked={table.getIsAllPageRowsSelected()}
        onCheckedChange={(checked) => table.toggleAllPageRowsSelected(!!checked)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }: { row: import('@tanstack/react-table').Row<T> }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(checked) => row.toggleSelected(!!checked)}
        onClick={(e) => e.stopPropagation()}
        aria-label="Select row"
      />
    ),
  } as ColumnDef<T, unknown>
}

/** Allow DM toggle button column. */
export function makeDmAccessColumn(
  onRefresh: () => void,
  togglingJid: string | null,
  setTogglingJid: (jid: string | null) => void,
): ColumnDef<DirectoryContact, unknown> {
  return {
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
  }
}

/** Settings button column — opens ContactSettingsSheet. */
export function makeSettingsColumn(
  setSelectedJid: (jid: string | null) => void,
): ColumnDef<DirectoryContact, unknown> {
  return {
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
  }
}

/** Messages count column. */
export function makeMessagesColumn(): ColumnDef<DirectoryContact, unknown> {
  return {
    id: 'messageCount',
    header: 'Messages',
    accessorKey: 'messageCount',
    meta: {
      sortable: true,
      sortValue: (row: DirectoryContact) => row.messageCount ?? 0,
    },
  }
}
