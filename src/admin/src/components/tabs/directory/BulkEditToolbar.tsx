// BulkEditToolbar — shared toolbar for bulk actions on contacts and channels/newsletters.
// DO NOT CHANGE: entityType determines available actions.
// Contacts: allow-dm / revoke-dm. Newsletters: follow / unfollow.
// Only renders when selectedCount > 0.
// Verified working: Phase 21 Plan 02 (2026-03-18)

import { Button } from '@/components/ui/button'

interface BulkEditToolbarProps {
  selectedCount: number
  entityType: 'contact' | 'newsletter'  // determines available actions
  onAction: (action: string) => void
  onCancel: () => void
}

export function BulkEditToolbar({ selectedCount, entityType, onAction, onCancel }: BulkEditToolbarProps) {
  if (selectedCount === 0) return null

  return (
    <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
      <span className="text-sm text-muted-foreground mr-2">{selectedCount} selected</span>

      {entityType === 'contact' && (
        <>
          <Button variant="outline" size="sm" onClick={() => onAction('allow-dm')}>
            Allow DM
          </Button>
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
