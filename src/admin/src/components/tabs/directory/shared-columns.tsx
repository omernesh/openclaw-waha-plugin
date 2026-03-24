// shared-columns.tsx — Reusable column factories for ContactsTab and ChannelsTab.
// Extracts duplicated column definitions (select checkbox, DM access toggle, settings button,
// messages count) and shared formatDate helper.
// Created during perfection pass — DO NOT CHANGE without verifying both ContactsTab and ChannelsTab.
// FEAT-timed-dm (260324-mbd): DM Access column now shows duration dropdown + expiry badges. DO NOT REVERT.

import { type ColumnDef } from '@tanstack/react-table'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Settings, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

/**
 * FEAT-timed-dm: Format remaining time until expiresAt (Unix seconds).
 * Returns human-friendly string like "23h left", "6d left", "2m left".
 * DO NOT CHANGE — used by DM Access column expiry display.
 */
export function formatTimeRemaining(expiresAt: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = expiresAt - now
  if (diff <= 0) return 'Expired'
  if (diff < 3600) {
    const mins = Math.ceil(diff / 60)
    return `${mins}m left`
  }
  if (diff < 86400) {
    const hours = Math.floor(diff / 3600)
    return `${hours}h left`
  }
  const days = Math.floor(diff / 86400)
  return `${days}d left`
}

/** Duration options for timed DM access. expiresAt = null means permanent. */
const DM_DURATION_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: 'Allow (1 hour)', seconds: 3600 },
  { label: 'Allow (24 hours)', seconds: 86400 },
  { label: 'Allow (7 days)', seconds: 604800 },
  { label: 'Allow (30 days)', seconds: 2592000 },
  { label: 'Allow (permanent)', seconds: null },
]

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

/**
 * DM Access column with timed grant dropdown and expiry badge.
 * FEAT-timed-dm (260324-mbd): Replaces single toggle button with:
 *   - When not allowed: dropdown with 5 duration options
 *   - When allowed: expiry badge (time remaining / Permanent / Expired) + Revoke button
 * All expiresAt values are Unix seconds. DO NOT CHANGE.
 */
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
      const contact = row.original
      const allowed = contact.allowedDm
      const isToggling = togglingJid === contact.jid

      async function handleGrant(seconds: number | null) {
        setTogglingJid(contact.jid)
        const expiresAt = seconds !== null ? Math.floor(Date.now() / 1000) + seconds : null
        try {
          await api.toggleAllowDm(contact.jid, { allowed: true, expiresAt })
          const label = seconds === null ? 'permanently' : DM_DURATION_OPTIONS.find((o) => o.seconds === seconds)?.label.replace('Allow (', '').replace(')', '') ?? ''
          toast.success(`DM access granted${label ? ` for ${label}` : ''}`)
          onRefresh()
        } catch (err) {
          toast.error('Failed to grant DM access')
          console.error(err)
        } finally {
          setTogglingJid(null)
        }
      }

      async function handleRevoke(e: React.MouseEvent) {
        e.stopPropagation()
        setTogglingJid(contact.jid)
        try {
          await api.toggleAllowDm(contact.jid, { allowed: false })
          toast.success('DM access revoked')
          onRefresh()
        } catch (err) {
          toast.error('Failed to revoke DM access')
          console.error(err)
        } finally {
          setTogglingJid(null)
        }
      }

      if (!allowed) {
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={isToggling}
                onClick={(e) => e.stopPropagation()}
                className="gap-1"
              >
                {isToggling ? 'Updating...' : 'Allow DM'}
                {!isToggling && <ChevronDown className="h-3 w-3" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
              {DM_DURATION_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.label}
                  onClick={() => handleGrant(opt.seconds)}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      }

      // Allowed — show expiry badge + revoke
      const expiresAt = contact.expiresAt
      const expired = contact.expired

      let badgeVariant: 'default' | 'secondary' | 'destructive' | 'outline' = 'default'
      let badgeClass = 'bg-green-100 text-green-800 border-green-200'
      let badgeText = 'Permanent'
      let subText: string | null = null

      if (expiresAt !== null) {
        if (expired) {
          badgeVariant = 'outline'
          badgeClass = 'bg-amber-100 text-amber-800 border-amber-200'
          badgeText = 'Expired'
        } else {
          subText = formatTimeRemaining(expiresAt)
        }
      }

      return (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col gap-0.5">
            <Badge variant={badgeVariant} className={`text-xs px-1.5 py-0 ${badgeClass}`}>
              {badgeText}
            </Badge>
            {subText && (
              <span className="text-xs text-muted-foreground leading-none">{subText}</span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={isToggling}
            className="h-6 px-1.5 text-xs text-muted-foreground hover:text-destructive"
            onClick={handleRevoke}
          >
            {isToggling ? '...' : 'Revoke'}
          </Button>
        </div>
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
