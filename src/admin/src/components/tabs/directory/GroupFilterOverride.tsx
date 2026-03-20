// GroupFilterOverride — per-group filter override panel rendered above participant list.
// Fetches override on mount via api.getGroupFilter. Saves via api.updateGroupFilter.
// When override is disabled the group inherits global filter settings.
// DO NOT CHANGE: follows ContactSettingsSheet styling patterns (space-y-4, Tip tooltips).
// DO NOT CHANGE: mentionPatterns sent as null when empty array (server expects null, not []).
// DO NOT CHANGE: godModeScope '' (empty string in Select) maps to null on save.
// Verified: quick task 260320-k2e (2026-03-20)
// Perfection pass: disable save after load failure, retry button — 260321

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CircleHelp, RefreshCw } from 'lucide-react'
import { TagInput } from '@/components/shared/TagInput'
import { api } from '@/lib/api'
import type { GroupFilterOverrideData } from '@/types'

function Tip({ text }: { text: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <CircleHelp className="inline h-3.5 w-3.5 ml-1 text-muted-foreground cursor-help" />
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px]">
          <p className="text-xs">{text}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

interface GroupFilterOverrideProps {
  groupJid: string
}

export function GroupFilterOverride({ groupJid }: GroupFilterOverrideProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)

  // Override toggle — when false, group inherits global settings
  const [enabled, setEnabled] = useState(false)
  const [filterEnabled, setFilterEnabled] = useState(true)
  const [mentionPatterns, setMentionPatterns] = useState<string[]>([])
  // DO NOT CHANGE: godModeScope '' = null on save (Select can't hold null directly)
  const [godModeScope, setGodModeScope] = useState<string>('')
  const [triggerOperator, setTriggerOperator] = useState<'OR' | 'AND'>('OR')

  function fetchFilter() {
    setLoading(true)
    setLoadError(false)
    api.getGroupFilter(groupJid)
      .then((res) => {
        if (res.override) {
          const o = res.override as unknown as GroupFilterOverrideData
          setEnabled(o.enabled ?? false)
          setFilterEnabled(o.filterEnabled ?? true)
          setMentionPatterns(o.mentionPatterns ?? [])
          // DO NOT CHANGE: null/undefined godModeScope maps to '' for Select value
          setGodModeScope(o.godModeScope ?? '')
          setTriggerOperator(o.triggerOperator ?? 'OR')
        } else {
          // No override yet — use defaults
          setEnabled(false)
          setFilterEnabled(true)
          setMentionPatterns([])
          setGodModeScope('')
          setTriggerOperator('OR')
        }
      })
      .catch((err) => {
        console.error('Failed to load group filter:', err)
        toast.error('Failed to load group filter settings')
        setLoadError(true)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchFilter()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupJid])

  async function handleSave() {
    setSaving(true)
    try {
      await api.updateGroupFilter(groupJid, {
        enabled,
        filterEnabled,
        // DO NOT CHANGE: send null when empty — server treats [] and null differently
        mentionPatterns: mentionPatterns.length > 0 ? mentionPatterns : null,
        // DO NOT CHANGE: map '' back to null for the wire
        godModeScope: godModeScope || null,
        triggerOperator,
      })
      toast.success('Group filter override saved')
    } catch (err) {
      console.error('Failed to save group filter:', err)
      toast.error('Failed to save group filter settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="border rounded-md p-4 mb-3">
        <p className="text-sm text-muted-foreground">Loading filter settings...</p>
      </div>
    )
  }

  return (
    <div className="border rounded-md p-4 mb-3">
      {/* Header */}
      <div className="mb-3">
        <p className="text-sm font-semibold">Group Filter Override</p>
        <p className="text-xs text-muted-foreground">Override global filter settings for this group</p>
      </div>

      {/* Load error banner */}
      {loadError && (
        <div className="flex items-center justify-between rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 mb-3">
          <p className="text-xs text-destructive">Failed to load — cannot save</p>
          <Button variant="outline" size="sm" className="gap-1.5 h-7" onClick={fetchFilter}>
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      <div className="space-y-4">
        {/* Override Enabled toggle */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Override Enabled</Label>
            {!enabled && (
              <p className="text-xs text-muted-foreground">Inheriting global filter settings</p>
            )}
          </div>
          <Switch
            id={`filter-override-enabled-${groupJid}`}
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={loadError}
          />
        </div>

        {/* Settings fields — only visible when override is enabled */}
        {enabled && (
          <>
            {/* Filter Enabled */}
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">
                  Filter Enabled
                  <Tip text="When off, keyword filtering is disabled for this group (all messages pass through)" />
                </Label>
                <p className="text-xs text-muted-foreground">Enable keyword filtering for this group</p>
              </div>
              <Switch
                id={`filter-enabled-${groupJid}`}
                checked={filterEnabled}
                onCheckedChange={setFilterEnabled}
                disabled={loadError}
              />
            </div>

            {/* Trigger Operator */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Trigger Operator
                <Tip text="OR: match any pattern. AND: match all patterns" />
              </Label>
              <Select
                value={triggerOperator}
                onValueChange={(v) => setTriggerOperator(v as 'OR' | 'AND')}
                disabled={loadError}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OR">OR</SelectItem>
                  <SelectItem value="AND">AND</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Mention Patterns */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Mention Patterns
                <Tip text="Regex patterns. Message must match for the bot to respond. Press Enter to add each pattern." />
              </Label>
              {/* DO NOT CHANGE: freeform={true} — arbitrary regex strings, not JID search */}
              <TagInput
                values={mentionPatterns}
                onChange={setMentionPatterns}
                freeform={true}
                placeholder="Add pattern..."
              />
            </div>

            {/* God Mode Scope */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                God Mode Scope
                <Tip text="Override god mode scope for this group. Inherit Global follows the global setting." />
              </Label>
              {/* DO NOT CHANGE: '' value means null/inherit — mapped to null on save */}
              <Select
                value={godModeScope}
                onValueChange={setGodModeScope}
                disabled={loadError}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Inherit Global" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Inherit Global</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="dm">DM Only</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {/* Save button — disabled when load failed to prevent overwriting server data with defaults */}
        <Button onClick={handleSave} disabled={saving || loadError} size="sm" className="w-full">
          {saving ? 'Saving...' : 'Save Override'}
        </Button>
      </div>
    </div>
  )
}
