// Phase 63 (AUTH-04, AUTH-05): ApiKeysTab — API key management with show-once and rotation.
//
// - List: shows existing keys masked as ctl_...xxxx
// - Create: name field → authClient.apiKey.create() → show full plaintext ONCE with copy button
// - Rotate: delete old key + create new one → show new plaintext ONCE
// - Delete: confirm dialog → authClient.apiKey.delete()
//
// DO NOT CHANGE: key is only shown in the post-create/post-rotate dialog, never again
// DO NOT CHANGE: masking pattern is ctl_...{last4} — do NOT show more chars
// DO NOT CHANGE: authClient.apiKey.create/list/delete calls — these are better-auth endpoints

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Copy, Key, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { authClient } from '@/lib/auth-client'

interface ApiKey {
  id: string
  name: string | null
  start: string | null
  createdAt: string | Date
}

interface ApiKeysTabProps {
  selectedSession: string
  refreshKey: number
  onLoadingChange: (loading: boolean) => void
}

function maskKey(start: string | null): string {
  if (!start) return 'ctl_...????'
  // start field from better-auth is the first N chars of the key (e.g. "ctl_abcd")
  return `${start}...????`
}

function formatDate(d: string | Date): string {
  try {
    return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return String(d)
  }
}

export default function ApiKeysTab({ onLoadingChange }: ApiKeysTabProps) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(false)
  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [creating, setCreating] = useState(false)
  // Show-once key dialog
  const [newKeyValue, setNewKeyValue] = useState<string | null>(null)
  const [newKeyName, setNewKeyName] = useState('')
  const [showKeyOpen, setShowKeyOpen] = useState(false)
  // Delete confirm dialog
  const [deleteTarget, setDeleteTarget] = useState<ApiKey | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Rotate state
  const [rotatingId, setRotatingId] = useState<string | null>(null)

  async function loadKeys() {
    setLoading(true)
    onLoadingChange(true)
    try {
      const result = await authClient.apiKey.list()
      if (result.error) {
        toast.error(result.error.message ?? 'Failed to load API keys')
        return
      }
      setKeys((result.data as ApiKey[] | null) ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load API keys')
    } finally {
      setLoading(false)
      onLoadingChange(false)
    }
  }

  useEffect(() => {
    loadKeys()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleCreate() {
    const name = createName.trim()
    if (!name) {
      toast.error('Please enter a key name')
      return
    }
    setCreating(true)
    try {
      const result = await authClient.apiKey.create({ name })
      if (result.error) {
        toast.error(result.error.message ?? 'Failed to create API key')
        return
      }
      const created = result.data as { key: string; name: string | null } | null
      if (created?.key) {
        setNewKeyValue(created.key)
        setNewKeyName(name)
        setShowKeyOpen(true)
      }
      setCreateOpen(false)
      setCreateName('')
      await loadKeys()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create API key')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(key: ApiKey) {
    setDeleting(true)
    try {
      const result = await authClient.apiKey.delete({ keyId: key.id })
      if (result.error) {
        toast.error(result.error.message ?? 'Failed to delete API key')
        return
      }
      toast.success(`Key "${key.name ?? key.id}" deleted`)
      setDeleteOpen(false)
      setDeleteTarget(null)
      await loadKeys()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete API key')
    } finally {
      setDeleting(false)
    }
  }

  async function handleRotate(key: ApiKey) {
    setRotatingId(key.id)
    try {
      // Delete old key
      const deleteResult = await authClient.apiKey.delete({ keyId: key.id })
      if (deleteResult.error) {
        toast.error(deleteResult.error.message ?? 'Failed to delete old key')
        return
      }
      // Create new key with same name
      const createResult = await authClient.apiKey.create({ name: key.name ?? 'rotated-key' })
      if (createResult.error) {
        toast.error(createResult.error.message ?? 'Failed to create replacement key')
        return
      }
      const created = createResult.data as { key: string; name: string | null } | null
      if (created?.key) {
        setNewKeyValue(created.key)
        setNewKeyName(key.name ?? 'rotated-key')
        setShowKeyOpen(true)
      }
      await loadKeys()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rotate API key')
    } finally {
      setRotatingId(null)
    }
  }

  async function copyToClipboard(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Copied to clipboard')
    } catch {
      toast.error('Failed to copy — please copy manually')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">API Keys</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Manage API keys for programmatic access to Chatlytics.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Key
        </Button>
      </div>

      {loading && keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading keys...</p>
      ) : keys.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <Key className="h-10 w-10 text-muted-foreground opacity-40" />
          <p className="text-sm text-muted-foreground">No API keys yet. Create one to get started.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="font-medium">{key.name ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="font-mono text-xs">
                    {maskKey(key.start)}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(key.createdAt)}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRotate(key)}
                      disabled={rotatingId === key.id}
                    >
                      {rotatingId === key.id ? (
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      <span className="ml-1.5">Rotate</span>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                      onClick={() => { setDeleteTarget(key); setDeleteOpen(true) }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="ml-1.5">Delete</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Create Key Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              Give your key a descriptive name. The key value will be shown once after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="key-name">Key name</Label>
            <Input
              id="key-name"
              placeholder="e.g. production-integration"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              disabled={creating}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating || !createName.trim()}>
              {creating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show-once Key Dialog */}
      <Dialog open={showKeyOpen} onOpenChange={(open) => { if (!open) { setNewKeyValue(null); setShowKeyOpen(false) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save your API key</DialogTitle>
            <DialogDescription>
              This is the only time the full key will be shown. Copy it now — it cannot be retrieved again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Key name: <span className="font-semibold">{newKeyName}</span></Label>
            <div className="flex gap-2">
              <code className="flex-1 rounded-md bg-muted px-3 py-2 text-sm font-mono break-all">
                {newKeyValue}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={() => newKeyValue && copyToClipboard(newKeyValue)}
                title="Copy to clipboard"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => { setNewKeyValue(null); setShowKeyOpen(false) }}>
              I've saved it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete API key</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This key will stop working immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
