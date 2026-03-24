// BulkEditToolbar — shared toolbar for bulk actions on contacts and channels/newsletters.
// DO NOT CHANGE: entityType determines available actions.
// Contacts: allow-dm (with duration options) / revoke-dm. Newsletters: follow / unfollow.
// Only renders when selectedCount > 0.
// FEAT-timed-dm (260324-mbd): onAction now passes optional expiresAt for allow-dm. DO NOT REVERT.
// Verified working: Phase 21 Plan 02 (2026-03-18)

import { Button } from '@/components/ui/button'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** Duration options for timed DM access. seconds=null means permanent. */
const DM_DURATION_OPTIONS: { label: string; seconds: number | null }[] = [
  { label: 'Allow (1 hour)', seconds: 3600 },
  { label: 'Allow (24 hours)', seconds: 86400 },
  { label: 'Allow (7 days)', seconds: 604800 },
  { label: 'Allow (30 days)', seconds: 2592000 },
  { label: 'Allow (permanent)', seconds: null },
]

interface BulkEditToolbarProps {
  selectedCount: number
  entityType: 'contact' | 'newsletter'  // determines available actions
  // FEAT-timed-dm: expiresAt is Unix seconds (null = permanent, undefined = action doesn't use it). DO NOT CHANGE.
  onAction: (action: 'allow-dm' | 'revoke-dm' | 'follow' | 'unfollow', expiresAt?: number | null) => void
  onCancel: () => void
}

export function BulkEditToolbar({ selectedCount, entityType, onAction, onCancel }: BulkEditToolbarProps) {
  if (selectedCount === 0) return null

  function handleGrantDm(seconds: number | null) {
    const expiresAt = seconds !== null ? Math.floor(Date.now() / 1000) + seconds : null
    onAction('allow-dm', expiresAt)
  }

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
      <span className="text-sm text-muted-foreground mr-2">{selectedCount} selected</span>

      {entityType === 'contact' && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                Allow DM
                <ChevronDown className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {DM_DURATION_OPTIONS.map((opt) => (
                <DropdownMenuItem key={opt.label} onClick={() => handleGrantDm(opt.seconds)}>
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => onAction('revoke-dm')}>
            Revoke DM
          </Button>
        </>
      )}

      {entityType === 'newsletter' && (
        <>
          <Button variant="outline" size="sm" onClick={() => onAction('follow')}>
            Follow
          </Button>
          <Button variant="outline" size="sm" onClick={() => onAction('unfollow')}>
            Unfollow
          </Button>
        </>
      )}

      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  )
}
