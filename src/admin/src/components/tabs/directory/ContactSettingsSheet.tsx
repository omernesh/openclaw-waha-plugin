// ContactSettingsSheet — side panel for editing contact DM settings.
// DO NOT CHANGE: Sheet stays open after save — locked decision from Plan 02 spec.
// DO NOT CHANGE: customKeywords is comma-separated on the wire; split on load, join on save.
// DO NOT CHANGE: allowedDm toggle calls toggleAllowDm immediately (not part of Save flow).
// DO NOT CHANGE: useEffect watches jid — resets all form fields when contact changes.
// Verified working: Phase 21 Plan 02 (2026-03-18)

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
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
import { CircleHelp } from 'lucide-react'
import { TagInput } from '@/components/shared/TagInput'
import { api } from '@/lib/api'
import type { ContactDmSettings } from '@/types'

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

const SECONDS_PER_HOUR = 3_600
const SECONDS_PER_DAY = 86_400

interface ContactSettingsSheetProps {
  jid: string | null            // null = closed
  displayName: string | null
  dmSettings?: ContactDmSettings
  allowedDm: boolean
  onClose: () => void
  onSaved: () => void           // called after successful save to trigger data refresh — sheet stays open
}

export function ContactSettingsSheet({
  jid,
  displayName,
  dmSettings,
  allowedDm: initialAllowedDm,
  onClose,
  onSaved,
}: ContactSettingsSheetProps) {
  // Form state — all controlled, initialized from props when jid changes
  const [allowedDm, setAllowedDm] = useState(initialAllowedDm)
  const [mode, setMode] = useState<'active' | 'listen_only'>(dmSettings?.mode ?? 'active')
  const [mentionOnly, setMentionOnly] = useState(dmSettings?.mentionOnly ?? false)
  const [canInitiateOverride, setCanInitiateOverride] = useState<'default' | 'allow' | 'block'>(
    dmSettings?.canInitiateOverride ?? 'default'
  )
  // DO NOT CHANGE: customKeywords is comma-separated on wire — split(',').filter(Boolean) on load
  const [keywords, setKeywords] = useState<string[]>(
    (dmSettings?.customKeywords ?? '').split(',').filter(Boolean)
  )
  const [saving, setSaving] = useState(false)
  const [togglingDm, setTogglingDm] = useState(false)

  // DO NOT CHANGE: useEffect watches jid — reset ALL form fields when contact changes
  useEffect(() => {
    if (!jid) return
    setAllowedDm(initialAllowedDm)
    setMode(dmSettings?.mode ?? 'active')
    setMentionOnly(dmSettings?.mentionOnly ?? false)
    setCanInitiateOverride(dmSettings?.canInitiateOverride ?? 'default')
    // DO NOT CHANGE: split(',').filter(Boolean) — customKeywords comes as comma-separated string
    setKeywords((dmSettings?.customKeywords ?? '').split(',').filter(Boolean))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jid])

  async function handleToggleAllowDm(checked: boolean) {
    if (!jid) return
    setTogglingDm(true)
    try {
      await api.toggleAllowDm(jid, { allowed: checked })
      setAllowedDm(checked)
      toast.success(checked ? 'DM access granted' : 'DM access revoked')
    } catch (err) {
      toast.error('Failed to update DM access')
      console.error(err)
    } finally {
      setTogglingDm(false)
    }
  }

  async function handleSave() {
    if (!jid) return
    setSaving(true)
    try {
      await api.updateDirectorySettings(jid, {
        mode,
        mentionOnly,
        // DO NOT CHANGE: join(',') — customKeywords must be comma-separated on the wire
        customKeywords: keywords.join(','),
        canInitiateOverride,
      })
      toast.success('Settings saved')
      // DO NOT CHANGE: onSaved() triggers parent refresh but does NOT close the sheet
      onSaved()
    } catch (err) {
      toast.error('Failed to save settings')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  async function handleSetTtl(expiresAt: number | null) {
    if (!jid) return
    try {
      await api.setDirectoryTtl(jid, { expiresAt })
      toast.success(expiresAt ? 'Access granted' : 'Access revoked')
      onSaved()
    } catch (err) {
      toast.error('Failed to set access expiry')
      console.error(err)
    }
  }

  const title = displayName ?? jid ?? 'Contact'
  const jidDisplay = jid?.replace('@c.us', '') ?? ''

  return (
    // DO NOT CHANGE: open={!!jid} — sheet is open when jid is set
    <Sheet open={!!jid} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{jidDisplay}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Allow DM — immediate toggle, no Save needed */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Allow DM</Label>
              <p className="text-xs text-muted-foreground">Enable direct message access for this contact</p>
            </div>
            <Switch
              checked={allowedDm}
              onCheckedChange={handleToggleAllowDm}
              disabled={togglingDm}
            />
          </div>

          {/* Mode */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Mode <Tip text="Active: bot responds to this contact. Listen Only: messages arrive but bot does not reply." /></Label>
            <Select value={mode} onValueChange={(v) => setMode(v as 'active' | 'listen_only')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="listen_only">Listen Only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Mention Only */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Mention Only <Tip text="When checked, bot only responds if it is explicitly @mentioned in the message." /></Label>
              <p className="text-xs text-muted-foreground">Only respond when mentioned</p>
            </div>
            <Switch
              checked={mentionOnly}
              onCheckedChange={setMentionOnly}
            />
          </div>

          {/* Can Initiate Override */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Can Initiate <Tip text="Override the global Can Initiate setting for this contact. Default: follow the global toggle in Settings. Allow: always allow initiation. Block: never initiate." /></Label>
            <Select
              value={canInitiateOverride}
              onValueChange={(v) => setCanInitiateOverride(v as 'default' | 'allow' | 'block')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="allow">Allow</SelectItem>
                <SelectItem value="block">Block</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Custom Keywords — freeform TagInput */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Custom Keywords <Tip text="Regex patterns. Bot responds only if the message matches one. Overrides global keyword filter for this contact. Press Enter to add each keyword." /></Label>
            {/* DO NOT CHANGE: freeform={true} — arbitrary keyword strings, not JID search */}
            <TagInput
              values={keywords}
              onChange={setKeywords}
              freeform={true}
              placeholder="Add keyword..."
            />
          </div>

          {/* TTL / Access Expiry */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Access Expiry <Tip text="Set how long this contact's DM access lasts. After expiry, access is automatically revoked." /></Label>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSetTtl(Math.floor(Date.now() / 1000) + SECONDS_PER_HOUR)}
              >
                Grant 1h
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSetTtl(Math.floor(Date.now() / 1000) + 5 * SECONDS_PER_HOUR)}
              >
                Grant 5h
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSetTtl(Math.floor(Date.now() / 1000) + SECONDS_PER_DAY)}
              >
                Grant 24h
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSetTtl(Math.floor(Date.now() / 1000) + 7 * SECONDS_PER_DAY)}
              >
                Grant 7d
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleSetTtl(null)}
              >
                Revoke
              </Button>
            </div>
          </div>

          {/* Save */}
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
