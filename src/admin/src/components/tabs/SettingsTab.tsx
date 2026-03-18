import * as React from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { WahaConfig } from '@/types'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { TagInput } from '@/components/shared/TagInput'
import { RestartOverlay } from '@/components/shared/RestartOverlay'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { CircleHelp } from 'lucide-react'

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

interface SettingsTabProps {
  selectedSession: string
  refreshKey: number
  onLoadingChange?: (loading: boolean) => void
}

// Immutably set a nested path like "dmFilter.enabled" in a WahaConfig
function setNestedValue(obj: WahaConfig, path: string, value: unknown): WahaConfig {
  const keys = path.split('.')
  if (keys.length === 1) {
    return { ...obj, [keys[0]]: value }
  }
  const [first, ...rest] = keys
  const nested = (obj as Record<string, unknown>)[first] ?? {}
  return {
    ...obj,
    [first]: setNestedValue(nested as WahaConfig, rest.join('.'), value),
  }
}

export default function SettingsTab({ selectedSession: _selectedSession, refreshKey, onLoadingChange }: SettingsTabProps) {
  const [config, setConfig] = React.useState<WahaConfig | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  // Report loading state to parent (drives TabHeader spinner)
  React.useEffect(() => { onLoadingChange?.(loading) }, [loading, onLoadingChange])
  const [restarting, setRestarting] = React.useState(false)
  const [dirty, setDirty] = React.useState(false)
  const [resolvedNames, setResolvedNames] = React.useState<Record<string, string>>({})

  // Load config on mount and refreshKey change
  React.useEffect(() => {
    const controller = new AbortController()
    setLoading(true)

    api.getConfig()
      .then((resp) => {
        if (controller.signal.aborted) return
        setConfig(resp.waha)
        setDirty(false)
      })
      .catch((err) => console.error('Settings config fetch failed:', err))
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [refreshKey])

  // Stable key derived from JIDs in config — avoids re-firing on every keystroke
  const jidKey = React.useMemo(() => {
    if (!config) return ''
    const allJids: string[] = [
      ...(config.allowFrom ?? []),
      ...(config.groupAllowFrom ?? []),
      ...(config.allowedGroups ?? []),
      ...(config.dmFilter?.godModeSuperUsers?.map(u => typeof u === 'string' ? u : u.identifier) ?? []),
      ...(config.groupFilter?.godModeSuperUsers?.map(u => typeof u === 'string' ? u : u.identifier) ?? []),
    ]
    return allJids.sort().join(',')
  }, [config])

  // Resolve JID names whenever the JID list changes (not on every config keystroke)
  React.useEffect(() => {
    if (!jidKey) return

    const allJids = jidKey.split(',').filter((jid) => jid && jid !== '*')
    if (allJids.length === 0) return

    api.resolveNames(allJids)
      .then((resp) => {
        setResolvedNames((prev) => ({ ...prev, ...resp.resolved }))
      })
      .catch((err) => console.error('Settings name resolution failed:', err))
  }, [jidKey])

  // Immutable nested config update — sets dirty flag
  function updateConfig(path: string, value: unknown) {
    setConfig((prev) => {
      if (!prev) return prev
      return setNestedValue(prev, path, value)
    })
    setDirty(true)
  }

  // Directory search for TagInput
  async function searchDirectory(query: string): Promise<Array<{ value: string; label: string }>> {
    const result = await api.getDirectory({ search: query, limit: '10' })
    return result.contacts.map((item) => ({ value: item.jid, label: item.displayName || item.jid }))
  }

  // Extract JIDs from godModeSuperUsers for TagInput display
  function godModeJids(filter: 'dm' | 'group'): string[] {
    const users =
      filter === 'dm'
        ? config?.dmFilter?.godModeSuperUsers
        : config?.groupFilter?.godModeSuperUsers
    return (users ?? []).map((u) => u.identifier)
  }

  // Convert TagInput string[] back to API format
  function updateGodModeUsers(filter: 'dm' | 'group', jids: string[]) {
    const key = filter === 'dm' ? 'dmFilter' : 'groupFilter'
    updateConfig(`${key}.godModeSuperUsers`, jids.map((jid) => ({ identifier: jid })))
  }

  // Build complete payload for POST /api/admin/config
  function buildPayload(): { waha: Record<string, unknown> } {
    if (!config) return { waha: {} }

    const waha: Record<string, unknown> = {}

    // Simple top-level fields
    if (config.baseUrl !== undefined) waha.baseUrl = config.baseUrl
    if (config.webhookPort !== undefined) waha.webhookPort = config.webhookPort
    if (config.webhookPath !== undefined) waha.webhookPath = config.webhookPath
    if (config.triggerWord !== undefined) waha.triggerWord = config.triggerWord
    if (config.triggerResponseMode !== undefined) waha.triggerResponseMode = config.triggerResponseMode
    if (config.dmPolicy !== undefined) waha.dmPolicy = config.dmPolicy
    if (config.groupPolicy !== undefined) waha.groupPolicy = config.groupPolicy
    if (config.canInitiateGlobal !== undefined) waha.canInitiateGlobal = config.canInitiateGlobal
    if (config.blockStreaming !== undefined) waha.blockStreaming = config.blockStreaming

    // Array fields — MUST send explicit [] when empty (never omit)
    waha.allowFrom = config.allowFrom ?? []
    waha.groupAllowFrom = config.groupAllowFrom ?? []
    waha.allowedGroups = config.allowedGroups ?? []

    // Complete sub-objects — always send complete (Pitfall 5)
    if (config.dmFilter) {
      waha.dmFilter = {
        enabled: config.dmFilter.enabled,
        mentionPatterns: config.dmFilter.mentionPatterns ?? [],
        godModeBypass: config.dmFilter.godModeBypass,
        godModeScope: config.dmFilter.godModeScope,
        // CRITICAL: godModeSuperUsers must be Array<{identifier}> NOT string[]
        godModeSuperUsers: (config.dmFilter.godModeSuperUsers ?? []).map((u) =>
          typeof u === 'string' ? { identifier: u } : u
        ),
        tokenEstimate: config.dmFilter.tokenEstimate,
      }
    }

    if (config.groupFilter) {
      waha.groupFilter = {
        enabled: config.groupFilter.enabled,
        mentionPatterns: config.groupFilter.mentionPatterns ?? [],
        godModeBypass: config.groupFilter.godModeBypass,
        godModeScope: config.groupFilter.godModeScope,
        godModeSuperUsers: (config.groupFilter.godModeSuperUsers ?? []).map((u) =>
          typeof u === 'string' ? { identifier: u } : u
        ),
        tokenEstimate: config.groupFilter.tokenEstimate,
      }
    }

    if (config.presence) {
      waha.presence = {
        enabled: config.presence.enabled,
        sendSeen: config.presence.sendSeen,
        wpm: config.presence.wpm,
        readDelayMs: config.presence.readDelayMs,
        msPerReadChar: config.presence.msPerReadChar,
        typingDurationMs: config.presence.typingDurationMs,
        pauseChance: config.presence.pauseChance,
        pauseDurationMs: config.presence.pauseDurationMs,
        pauseIntervalMs: config.presence.pauseIntervalMs,
        jitter: config.presence.jitter,
      }
    }

    if (config.pairingMode) {
      waha.pairingMode = {
        enabled: config.pairingMode.enabled,
        passcode: config.pairingMode.passcode,
        grantTtlMinutes: config.pairingMode.grantTtlMinutes,
        challengeMessage: config.pairingMode.challengeMessage,
      }
    }

    if (config.autoReply) {
      waha.autoReply = {
        enabled: config.autoReply.enabled,
        message: config.autoReply.message,
        intervalMinutes: config.autoReply.intervalMinutes,
      }
    }

    if (config.mediaPreprocessing) {
      waha.mediaPreprocessing = {
        enabled: config.mediaPreprocessing.enabled,
        audioTranscription: config.mediaPreprocessing.audioTranscription,
        imageAnalysis: config.mediaPreprocessing.imageAnalysis,
        videoAnalysis: config.mediaPreprocessing.videoAnalysis,
        locationResolution: config.mediaPreprocessing.locationResolution,
        vcardParsing: config.mediaPreprocessing.vcardParsing,
        documentAnalysis: config.mediaPreprocessing.documentAnalysis,
      }
    }

    if (config.markdown) {
      waha.markdown = {
        enabled: config.markdown.enabled,
        tables: config.markdown.tables,
      }
    }

    if (config.actions) {
      waha.actions = { reactions: config.actions.reactions }
    }

    return { waha }
  }

  async function handleSave() {
    setSaving(true)
    try {
      await api.updateConfig(buildPayload())
      setDirty(false)
      toast.success('Settings saved')
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveAndRestart() {
    setSaving(true)
    try {
      await api.updateConfig(buildPayload())
      setDirty(false)
      toast.success('Restarting gateway...')
      setSaving(false)
      await api.restart()
      setRestarting(true)
    } catch (err) {
      setSaving(false)
      toast.error(`Save & Restart failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    )
  }

  if (!config) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <p>Failed to load settings.</p>
      </div>
    )
  }

  return (
    <>
      <RestartOverlay
        active={restarting}
        onComplete={() => window.location.reload()}
        onTimeout={() => {
          setRestarting(false)
          toast.error('Gateway did not respond after 60s. Check logs.')
        }}
      />

      <div className="flex-1 overflow-auto p-6 space-y-6">

        {/* Section 1: General Settings */}
        <Card>
          <CardHeader>
            <CardTitle>General Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="baseUrl">Base URL<Tip text="WAHA server URL. Must be accessible from this host. Example: http://127.0.0.1:3004" /></Label>
                <Input
                  id="baseUrl"
                  value={config.baseUrl ?? ''}
                  onChange={(e) => updateConfig('baseUrl', e.target.value)}
                  placeholder="http://localhost:3000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="webhookPort">Webhook Port<Tip text="Port the webhook HTTP server listens on. Default: 8050. Restart required after change." /></Label>
                <Input
                  id="webhookPort"
                  type="number"
                  value={config.webhookPort ?? ''}
                  onChange={(e) => updateConfig('webhookPort', Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="webhookPath">Webhook Path<Tip text="URL path WAHA sends events to. Default: /webhook/waha" /></Label>
                <Input
                  id="webhookPath"
                  value={config.webhookPath ?? ''}
                  onChange={(e) => updateConfig('webhookPath', e.target.value)}
                  placeholder="/webhook"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="triggerWord">Trigger Word<Tip text="Prefix that activates the bot (e.g. '!' or '!bot'). Messages must start with this to pass through filters. Used for human sessions where all messages are filtered by default. Leave empty to disable trigger-based filtering." /></Label>
                <Input
                  id="triggerWord"
                  value={config.triggerWord ?? ''}
                  onChange={(e) => updateConfig('triggerWord', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="triggerResponseMode">Trigger Response Mode<Tip text="Where the bot responds when triggered in a group. 'dm' = respond via DM to the sender. 'reply-in-chat' = respond in the same group. For DM triggers, the bot always responds in the same DM." /></Label>
                <Select
                  value={config.triggerResponseMode ?? ''}
                  onValueChange={(v) => updateConfig('triggerResponseMode', v)}
                >
                  <SelectTrigger id="triggerResponseMode">
                    <SelectValue placeholder="Select mode..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="reply">reply</SelectItem>
                    <SelectItem value="send">send</SelectItem>
                    <SelectItem value="off">off</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-3">
                <Switch
                  id="canInitiateGlobal"
                  checked={config.canInitiateGlobal ?? false}
                  onCheckedChange={(v) => updateConfig('canInitiateGlobal', v)}
                />
                <Label htmlFor="canInitiateGlobal">Can Initiate (Global Default)<Tip text="When enabled, the bot can start new conversations with any contact. When disabled, the bot can only respond to incoming messages unless a per-contact override allows initiation." /></Label>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  id="blockStreaming"
                  checked={config.blockStreaming ?? false}
                  onCheckedChange={(v) => updateConfig('blockStreaming', v)}
                />
                <Label htmlFor="blockStreaming">Single Message Mode<Tip text="Send responses as a single message instead of streaming chunks. Reduces message spam for long responses." /></Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Access Control */}
        <Card>
          <CardHeader>
            <CardTitle>Access Control</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="dmPolicy">DM Policy<Tip text="How to handle DMs from unknown senders. open: accept all. closed: block all. allowlist: only contacts in Allow From list." /></Label>
                <Select
                  value={config.dmPolicy ?? ''}
                  onValueChange={(v) => updateConfig('dmPolicy', v)}
                >
                  <SelectTrigger id="dmPolicy">
                    <SelectValue placeholder="Select policy..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allowlist">allowlist</SelectItem>
                    <SelectItem value="blocklist">blocklist</SelectItem>
                    <SelectItem value="open">open</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="groupPolicy">Group Policy<Tip text="How to handle group messages. allowlist=only allowedGroups, open=all groups, closed=no groups." /></Label>
                <Select
                  value={config.groupPolicy ?? ''}
                  onValueChange={(v) => updateConfig('groupPolicy', v)}
                >
                  <SelectTrigger id="groupPolicy">
                    <SelectValue placeholder="Select policy..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allowlist">allowlist</SelectItem>
                    <SelectItem value="blocklist">blocklist</SelectItem>
                    <SelectItem value="open">open</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Allow From (DMs)<Tip text="JIDs allowed to send DMs. Press Enter or comma to add. Supports @c.us and @lid formats." /></Label>
              <TagInput
                values={config.allowFrom ?? []}
                onChange={(v) => updateConfig('allowFrom', v)}
                searchFn={searchDirectory}
                resolvedNames={resolvedNames}
                placeholder="Search contacts..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>Group Allow From<Tip text="JIDs allowed to trigger the bot in groups. Press Enter or comma to add. Include both @c.us and @lid for the same person (NOWEB sends @lid)." /></Label>
              <TagInput
                values={config.groupAllowFrom ?? []}
                onChange={(v) => updateConfig('groupAllowFrom', v)}
                searchFn={searchDirectory}
                resolvedNames={resolvedNames}
                placeholder="Search contacts..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>Allowed Groups<Tip text="Group JIDs the bot will respond in. Press Enter or comma to add. Leave empty to allow all groups (with open policy)." /></Label>
              <TagInput
                values={config.allowedGroups ?? []}
                onChange={(v) => updateConfig('allowedGroups', v)}
                searchFn={searchDirectory}
                resolvedNames={resolvedNames}
                placeholder="Search groups..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Section 3: DM Keyword Filter */}
        <Card>
          <CardHeader>
            <CardTitle>DM Keyword Filter</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                id="dmFilter.enabled"
                checked={config.dmFilter?.enabled ?? false}
                onCheckedChange={(v) => updateConfig('dmFilter.enabled', v)}
              />
              <Label htmlFor="dmFilter.enabled">Enabled<Tip text="When on, DMs must contain at least one mention pattern to get a response. Reduces noise and token usage." /></Label>
            </div>

            <div className="space-y-1.5">
              <Label>Mention Patterns<Tip text="Regex patterns (case-insensitive). DMs must match at least one. Press Enter or comma to add each pattern." /></Label>
              <TagInput
                values={config.dmFilter?.mentionPatterns ?? []}
                onChange={(v) => updateConfig('dmFilter.mentionPatterns', v)}
                freeform={true}
                placeholder="Type pattern and press Enter"
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="dmFilter.godModeBypass"
                checked={config.dmFilter?.godModeBypass ?? false}
                onCheckedChange={(v) => updateConfig('dmFilter.godModeBypass', v)}
              />
              <Label htmlFor="dmFilter.godModeBypass">God Mode Bypass<Tip text="When on, super-users bypass the keyword filter entirely (their messages always get a response)." /></Label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dmFilter.godModeScope">God Mode Scope<Tip text="Controls which filters god mode bypass applies to. 'All' = bypass both DM and group filters. 'DM Only' = bypass DM filter only, NOT group filter. 'Off' = never bypass." /></Label>
              <Select
                value={config.dmFilter?.godModeScope ?? 'off'}
                onValueChange={(v) => updateConfig('dmFilter.godModeScope', v)}
              >
                <SelectTrigger id="dmFilter.godModeScope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="dm">dm</SelectItem>
                  <SelectItem value="off">off</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>God Mode Users<Tip text="JIDs that bypass the DM keyword filter entirely. Search and select contacts. Include both @c.us and @lid formats for NOWEB compatibility." /></Label>
              <TagInput
                values={godModeJids('dm')}
                onChange={(v) => updateGodModeUsers('dm', v)}
                searchFn={searchDirectory}
                freeform={true}
                resolvedNames={resolvedNames}
                placeholder="Search contacts or type JID..."
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dmFilter.tokenEstimate">Token Estimate<Tip text="Estimated tokens saved per dropped DM. Used for stats display only. Default: 2500." /></Label>
              <Input
                id="dmFilter.tokenEstimate"
                type="number"
                value={config.dmFilter?.tokenEstimate ?? ''}
                onChange={(e) => updateConfig('dmFilter.tokenEstimate', Number(e.target.value))}
                className="w-40"
              />
            </div>
          </CardContent>
        </Card>

        {/* Section 4: Group Keyword Filter */}
        <Card>
          <CardHeader>
            <CardTitle>Group Keyword Filter</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                id="groupFilter.enabled"
                checked={config.groupFilter?.enabled ?? false}
                onCheckedChange={(v) => updateConfig('groupFilter.enabled', v)}
              />
              <Label htmlFor="groupFilter.enabled">Enabled<Tip text="When on, group messages must contain at least one mention pattern to get a response. Saves tokens by filtering irrelevant group chatter." /></Label>
            </div>

            <div className="space-y-1.5">
              <Label>Mention Patterns<Tip text="Regex patterns (case-insensitive). Group messages must match at least one. Press Enter or comma to add each pattern." /></Label>
              <TagInput
                values={config.groupFilter?.mentionPatterns ?? []}
                onChange={(v) => updateConfig('groupFilter.mentionPatterns', v)}
                freeform={true}
                placeholder="Type pattern and press Enter"
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="groupFilter.godModeBypass"
                checked={config.groupFilter?.godModeBypass ?? false}
                onCheckedChange={(v) => updateConfig('groupFilter.godModeBypass', v)}
              />
              <Label htmlFor="groupFilter.godModeBypass">God Mode Bypass<Tip text="When on, super-users bypass the group keyword filter entirely." /></Label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="groupFilter.godModeScope">God Mode Scope<Tip text="Controls which filters god mode bypass applies to. 'All' = bypass both DM and group filters. 'DM Only' = bypass DM filter only. 'Off' = never bypass." /></Label>
              <Select
                value={config.groupFilter?.godModeScope ?? 'off'}
                onValueChange={(v) => updateConfig('groupFilter.godModeScope', v)}
              >
                <SelectTrigger id="groupFilter.godModeScope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all</SelectItem>
                  <SelectItem value="dm">dm</SelectItem>
                  <SelectItem value="off">off</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>God Mode Users<Tip text="JIDs that bypass the group keyword filter entirely. Search and select contacts. Supports @c.us and @lid formats." /></Label>
              <TagInput
                values={godModeJids('group')}
                onChange={(v) => updateGodModeUsers('group', v)}
                searchFn={searchDirectory}
                freeform={true}
                resolvedNames={resolvedNames}
                placeholder="Search contacts or type JID..."
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="groupFilter.tokenEstimate">Token Estimate<Tip text="Estimated tokens saved per dropped group message. Default: 2500." /></Label>
              <Input
                id="groupFilter.tokenEstimate"
                type="number"
                value={config.groupFilter?.tokenEstimate ?? ''}
                onChange={(e) => updateConfig('groupFilter.tokenEstimate', Number(e.target.value))}
                className="w-40"
              />
            </div>
          </CardContent>
        </Card>

        {/* Section 5: Presence Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Presence Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                id="presence.enabled"
                checked={config.presence?.enabled ?? false}
                onCheckedChange={(v) => updateConfig('presence.enabled', v)}
              />
              <Label htmlFor="presence.enabled">Enabled<Tip text="Simulate human typing: read delays, typing indicators, pause breaks. Makes responses feel natural." /></Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="presence.sendSeen"
                checked={config.presence?.sendSeen ?? false}
                onCheckedChange={(v) => updateConfig('presence.sendSeen', v)}
              />
              <Label htmlFor="presence.sendSeen">Read Receipts<Tip text="Send read receipts (blue ticks) when reading incoming messages." /></Label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="presence.wpm">Words Per Minute<Tip text="Typing speed for calculating typing duration. Default: 42. Range: 20-120." /></Label>
                <Input
                  id="presence.wpm"
                  type="number"
                  value={config.presence?.wpm ?? ''}
                  onChange={(e) => updateConfig('presence.wpm', Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="presence.msPerReadChar">Read Delay Per Char<Tip text="Extra read delay per character in the message. Longer messages = longer read time. Default: 30." /></Label>
                <Input
                  id="presence.msPerReadChar"
                  type="number"
                  value={config.presence?.msPerReadChar ?? ''}
                  onChange={(e) => updateConfig('presence.msPerReadChar', Number(e.target.value))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Read Delay (ms)<Tip text="Simulated message reading time range [min, max] before starting to type. Default: [500, 4000]." /></Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={config.presence?.readDelayMs?.[0] ?? ''}
                  onChange={(e) => {
                    const cur = config.presence?.readDelayMs ?? [0, 0]
                    updateConfig('presence.readDelayMs', [Number(e.target.value), cur[1]])
                  }}
                  placeholder="min"
                />
                <Input
                  type="number"
                  value={config.presence?.readDelayMs?.[1] ?? ''}
                  onChange={(e) => {
                    const cur = config.presence?.readDelayMs ?? [0, 0]
                    updateConfig('presence.readDelayMs', [cur[0], Number(e.target.value)])
                  }}
                  placeholder="max"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Typing Duration (ms)<Tip text="Min/max clamp for typing indicator duration. Actual duration is derived from WPM + message length. Default: [1500, 15000]." /></Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={config.presence?.typingDurationMs?.[0] ?? ''}
                  onChange={(e) => {
                    const cur = config.presence?.typingDurationMs ?? [0, 0]
                    updateConfig('presence.typingDurationMs', [Number(e.target.value), cur[1]])
                  }}
                  placeholder="min"
                />
                <Input
                  type="number"
                  value={config.presence?.typingDurationMs?.[1] ?? ''}
                  onChange={(e) => {
                    const cur = config.presence?.typingDurationMs ?? [0, 0]
                    updateConfig('presence.typingDurationMs', [cur[0], Number(e.target.value)])
                  }}
                  placeholder="max"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="presence.pauseChance">Pause Chance<Tip text="Probability of a mid-typing pause (0.0 = never, 1.0 = always). Default: 0.3 (30% chance)." /></Label>
              <Input
                id="presence.pauseChance"
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={config.presence?.pauseChance ?? ''}
                onChange={(e) => updateConfig('presence.pauseChance', Number(e.target.value))}
                className="w-40"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Pause Duration (ms)<Tip text="Duration of a typing pause [min, max]. Default: [500, 2000]." /></Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={config.presence?.pauseDurationMs?.[0] ?? ''}
                  onChange={(e) => {
                    const cur = config.presence?.pauseDurationMs ?? [0, 0]
                    updateConfig('presence.pauseDurationMs', [Number(e.target.value), cur[1]])
                  }}
                  placeholder="min"
                />
                <Input
                  type="number"
                  value={config.presence?.pauseDurationMs?.[1] ?? ''}
                  onChange={(e) => {
                    const cur = config.presence?.pauseDurationMs ?? [0, 0]
                    updateConfig('presence.pauseDurationMs', [cur[0], Number(e.target.value)])
                  }}
                  placeholder="max"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Pause Interval (ms)<Tip text="How often pauses can occur [min, max interval]. Default: [2000, 5000]." /></Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={config.presence?.pauseIntervalMs?.[0] ?? ''}
                  onChange={(e) => {
                    const cur = config.presence?.pauseIntervalMs ?? [0, 0]
                    updateConfig('presence.pauseIntervalMs', [Number(e.target.value), cur[1]])
                  }}
                  placeholder="min"
                />
                <Input
                  type="number"
                  value={config.presence?.pauseIntervalMs?.[1] ?? ''}
                  onChange={(e) => {
                    const cur = config.presence?.pauseIntervalMs ?? [0, 0]
                    updateConfig('presence.pauseIntervalMs', [cur[0], Number(e.target.value)])
                  }}
                  placeholder="max"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Jitter<Tip text="Random timing multiplier range. 1.0 = no jitter. Default: [0.7, 1.3] = ±30% variation." /></Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={config.presence?.jitter?.[0] ?? ''}
                  onChange={(e) => {
                    const cur = config.presence?.jitter ?? [0, 0]
                    updateConfig('presence.jitter', [Number(e.target.value), cur[1]])
                  }}
                  placeholder="min"
                />
                <Input
                  type="number"
                  value={config.presence?.jitter?.[1] ?? ''}
                  onChange={(e) => {
                    const cur = config.presence?.jitter ?? [0, 0]
                    updateConfig('presence.jitter', [cur[0], Number(e.target.value)])
                  }}
                  placeholder="max"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 6: Pairing Mode */}
        <Card>
          <CardHeader>
            <CardTitle>Pairing Mode</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                id="pairingMode.enabled"
                checked={config.pairingMode?.enabled ?? false}
                onCheckedChange={(v) => updateConfig('pairingMode.enabled', v)}
              />
              <Label htmlFor="pairingMode.enabled">Enable Pairing Mode<Tip text="When enabled, unknown DM senders can enter a passcode to get added to the allow list automatically." /></Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pairingMode.passcode">Passcode<Tip text="The 6-digit code contacts must enter to get DM access. Click Generate to create a random one." /></Label>
              <Input
                id="pairingMode.passcode"
                value={config.pairingMode?.passcode ?? ''}
                onChange={(e) => updateConfig('pairingMode.passcode', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pairingMode.grantTtlMinutes">Grant TTL<Tip text="How long pairing-granted access lasts. After this period, access is automatically revoked." /></Label>
              <Input
                id="pairingMode.grantTtlMinutes"
                type="number"
                value={config.pairingMode?.grantTtlMinutes ?? ''}
                onChange={(e) => updateConfig('pairingMode.grantTtlMinutes', Number(e.target.value))}
                className="w-40"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pairingMode.challengeMessage">Challenge Message<Tip text="The message sent to unknown DMs asking them to enter the passcode." /></Label>
              <textarea
                id="pairingMode.challengeMessage"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={config.pairingMode?.challengeMessage ?? ''}
                onChange={(e) => updateConfig('pairingMode.challengeMessage', e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Section 7: Auto Reply */}
        <Card>
          <CardHeader>
            <CardTitle>Auto Reply</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                id="autoReply.enabled"
                checked={config.autoReply?.enabled ?? false}
                onCheckedChange={(v) => updateConfig('autoReply.enabled', v)}
              />
              <Label htmlFor="autoReply.enabled">Send rejection message<Tip text="When enabled, contacts whose DMs are blocked will receive an automatic reply explaining they are not authorized." /></Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="autoReply.message">Rejection Message<Tip text="Message sent to blocked DMs. Use {admin_name} to insert the bot owner's name." /></Label>
              <textarea
                id="autoReply.message"
                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={config.autoReply?.message ?? ''}
                onChange={(e) => updateConfig('autoReply.message', e.target.value)}
                placeholder="Auto-reply message text..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="autoReply.intervalMinutes">Rate Limit<Tip text="Minimum minutes between auto-replies to the same contact to prevent spam." /></Label>
              <Input
                id="autoReply.intervalMinutes"
                type="number"
                value={config.autoReply?.intervalMinutes ?? ''}
                onChange={(e) => updateConfig('autoReply.intervalMinutes', Number(e.target.value))}
                className="w-40"
              />
            </div>
          </CardContent>
        </Card>

        {/* Section 8: Media Preprocessing */}
        <Card>
          <CardHeader>
            <CardTitle>Media Preprocessing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                id="mediaPreprocessing.enabled"
                checked={config.mediaPreprocessing?.enabled ?? false}
                onCheckedChange={(v) => updateConfig('mediaPreprocessing.enabled', v)}
              />
              <Label htmlFor="mediaPreprocessing.enabled">Enabled (master)<Tip text="Master toggle. When enabled, inbound media messages are preprocessed before being sent to the AI." /></Label>
            </div>

            <div className="space-y-3">
              {(
                [
                  ['audioTranscription', 'Transcribe Audio', 'Transcribe voice messages to text using Whisper before sending to AI.'],
                  ['imageAnalysis', 'Analyze Images', 'Analyze image content and generate descriptions before sending to AI.'],
                  ['videoAnalysis', 'Analyze Video', 'Analyze video content (extracts key frames) before sending to AI.'],
                  ['locationResolution', 'Resolve Locations', 'Resolve GPS coordinates to human-readable addresses via OpenStreetMap Nominatim.'],
                  ['vcardParsing', 'Parse vCards', 'Parse vCard contact attachments and extract contact info as structured text.'],
                  ['documentAnalysis', 'Extract Documents', 'Extract text content from PDF and document attachments before sending to AI.'],
                ] as [string, string, string][]
              ).map(([key, label, tip]) => (
                <div key={key} className="flex items-center gap-3">
                  <Checkbox
                    id={`mediaPreprocessing.${key}`}
                    checked={config.mediaPreprocessing?.[key as keyof NonNullable<WahaConfig['mediaPreprocessing']>] ?? false}
                    onCheckedChange={(checked) =>
                      updateConfig(`mediaPreprocessing.${key}`, checked === true)
                    }
                  />
                  <Label htmlFor={`mediaPreprocessing.${key}`}>{label}<Tip text={tip} /></Label>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Section 9: Markdown */}
        <Card>
          <CardHeader>
            <CardTitle>Markdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                id="markdown.enabled"
                checked={config.markdown?.enabled ?? false}
                onCheckedChange={(v) => updateConfig('markdown.enabled', v)}
              />
              <Label htmlFor="markdown.enabled">Process Markdown<Tip text="Process markdown in outbound messages (bold, italic, code). WhatsApp uses its own formatting syntax." /></Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="markdown.tables">Table Format<Tip text="How to render markdown tables. auto=detect client capability, markdown=always markdown, text=always plain text." /></Label>
              <Select
                value={config.markdown?.tables ?? ''}
                onValueChange={(v) => updateConfig('markdown.tables', v)}
              >
                <SelectTrigger id="markdown.tables">
                  <SelectValue placeholder="Select tables mode..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="enabled">enabled</SelectItem>
                  <SelectItem value="disabled">disabled</SelectItem>
                  <SelectItem value="fallback">fallback</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Section 10: Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                id="actions.reactions"
                checked={config.actions?.reactions ?? false}
                onCheckedChange={(v) => updateConfig('actions.reactions', v)}
              />
              <Label htmlFor="actions.reactions">Reactions<Tip text="Enable emoji reaction support. When on, the bot can receive and process message reactions." /></Label>
            </div>
          </CardContent>
        </Card>

        {/* Save / Save & Restart buttons */}
        <div className="flex items-center gap-3 pb-6">
          <Button
            onClick={handleSave}
            disabled={saving || !dirty}
            variant="outline"
          >
            {saving ? 'Saving...' : 'Save'}
          </Button>
          <Button
            onClick={handleSaveAndRestart}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save & Restart'}
          </Button>
          {dirty && (
            <span className="text-sm text-muted-foreground">Unsaved changes</span>
          )}
        </div>
      </div>
    </>
  )
}
