// Phase 65 (ADMIN-02): Workspace management tab — list, create, delete workspaces.
//
// Operators can:
//   - View all workspaces with status badges (running/starting/stopped)
//   - Create a new workspace (auto-assigns workspaceId via databaseHooks)
//   - Delete a workspace (stops child process + removes DB record)
//
// Fetches from GET /api/admin/workspaces (session-cookie auth, credentials: include).
// DO NOT REMOVE — required for multi-tenant workspace management (ADMIN-02).

import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Copy, Plus, Trash2 } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Workspace {
  id: string
  name: string
  email: string
  workspaceId: string
  status: 'ready' | 'starting' | 'crashed' | 'stopped'
  port: number | null
  createdAt: string
}

interface WorkspacesTabProps {
  selectedSession?: string
  refreshKey?: number
  onLoadingChange?: (loading: boolean) => void
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function statusBadgeVariant(status: Workspace['status']): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ready') return 'default'
  if (status === 'starting') return 'secondary'
  if (status === 'crashed') return 'destructive'
  return 'outline'
}

function statusLabel(status: Workspace['status']): string {
  if (status === 'ready') return 'Running'
  if (status === 'starting') return 'Starting'
  if (status === 'crashed') return 'Crashed'
  return 'Stopped'
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WorkspacesTab({ refreshKey, onLoadingChange }: WorkspacesTabProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createPassword, setCreatePassword] = useState('')
  const [creating, setCreating] = useState(false)

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<Workspace | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Report loading state to parent (drives TabHeader spinner)
  useEffect(() => { onLoadingChange?.(loading) }, [loading, onLoadingChange])

  const fetchWorkspaces = useCallback(() => {
    setLoading(true)
    setError(false)
    fetch('/api/admin/workspaces', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json() as Promise<Workspace[]>
      })
      .then((data) => {
        setWorkspaces(data)
      })
      .catch(() => {
        setError(true)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [])

  useEffect(() => { fetchWorkspaces() }, [fetchWorkspaces, refreshKey])

  // ── Create workspace ────────────────────────────────────────────────────────

  async function handleCreate() {
    if (!createName.trim() || !createEmail.trim() || !createPassword.trim()) {
      toast.error('All fields are required')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/admin/workspaces', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: createName.trim(), email: createEmail.trim(), password: createPassword }),
      })
      if (res.status === 409) {
        toast.error('A user with this email already exists')
        return
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string }
        toast.error(`Failed to create workspace: ${err.error}`)
        return
      }
      toast.success('Workspace created')
      setCreateOpen(false)
      setCreateName('')
      setCreateEmail('')
      setCreatePassword('')
      fetchWorkspaces()
    } catch {
      toast.error('Network error — failed to create workspace')
    } finally {
      setCreating(false)
    }
  }

  // ── Delete workspace ────────────────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/workspaces/${encodeURIComponent(deleteTarget.workspaceId)}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' })) as { error: string }
        toast.error(`Failed to delete workspace: ${err.error}`)
        return
      }
      toast.success(`Workspace "${deleteTarget.name}" deleted`)
      setDeleteTarget(null)
      fetchWorkspaces()
    } catch {
      toast.error('Network error — failed to delete workspace')
    } finally {
      setDeleting(false)
    }
  }

  // ── Copy workspaceId ────────────────────────────────────────────────────────

  function copyWorkspaceId(workspaceId: string) {
    navigator.clipboard.writeText(workspaceId).then(() => {
      toast.success('Workspace ID copied')
    }).catch(() => {
      toast.error('Failed to copy')
    })
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Workspaces</h2>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Create Workspace
        </Button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[160px] w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <p className="text-sm text-destructive">Failed to load workspaces. <Button variant="link" className="p-0 h-auto" onClick={fetchWorkspaces}>Retry</Button></p>
      )}

      {/* Empty state */}
      {!loading && !error && workspaces?.length === 0 && (
        <p className="text-sm text-muted-foreground">No workspaces yet. Create one to get started.</p>
      )}

      {/* Workspace cards */}
      {!loading && !error && workspaces && workspaces.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((ws) => (
            <Card key={ws.workspaceId}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm font-medium leading-tight">{ws.name}</CardTitle>
                  <Badge variant={statusBadgeVariant(ws.status)} className="shrink-0 text-xs">
                    {statusLabel(ws.status)}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{ws.email}</p>
              </CardHeader>
              <CardContent className="pb-2 space-y-1">
                {/* Workspace ID — truncated with copy button */}
                <div className="flex items-center gap-1">
                  <code className="text-xs text-muted-foreground font-mono">
                    {ws.workspaceId.slice(0, 8)}…
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={() => copyWorkspaceId(ws.workspaceId)}
                    aria-label="Copy workspace ID"
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                {ws.port && (
                  <p className="text-xs text-muted-foreground">Port: {ws.port}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Created: {new Date(ws.createdAt).toLocaleDateString()}
                </p>
              </CardContent>
              <CardFooter className="pt-0">
                <Button
                  variant="destructive"
                  size="sm"
                  className="w-full"
                  onClick={() => setDeleteTarget(ws)}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {/* Create Workspace Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Workspace</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ws-name">Name</Label>
              <Input
                id="ws-name"
                placeholder="Acme Corp"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                disabled={creating}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ws-email">Email</Label>
              <Input
                id="ws-email"
                type="email"
                placeholder="admin@acme.com"
                value={createEmail}
                onChange={(e) => setCreateEmail(e.target.value)}
                disabled={creating}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ws-password">Password</Label>
              <Input
                id="ws-password"
                type="password"
                placeholder="Minimum 8 characters"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                disabled={creating}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops the workspace process and removes all data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
