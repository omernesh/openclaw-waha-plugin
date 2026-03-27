import * as React from 'react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { WahaConfig, Session } from '@/types'
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
import { ChevronDown, Copy } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Tip } from '@/components/shared/Tip'

// ── Named constants (no magic numbers) ──────────────────────────────────────
const AUTOSAVE_DEBOUNCE_MS = 1500
const AUTOSAVE_STATUS_CLEAR_MS = 2000
const NETWORK_RETRY_DELAY_MS = 3000

/** Check if an error message indicates a transient network failure (e.g. gateway restart). */
const isNetworkError = (m: string) => m.includes('Failed to fetch') || m.includes('NetworkError')

// Inline field-level error message pinned to a specific config path.
// path must match the Zod error path returned by the backend (e.g. "dmFilter.tokenEstimate").
function FieldError({ path, errors }: { path: string; errors: Record<string, string> }) {
  const msg = errors[path]
  if (!msg) return null
  return <p className="text-xs text-destructive mt-1">{msg}</p>
}

/** Sub-component: Pairing link display (extracted from IIFE in JSX). DO NOT REMOVE. */
function PairingLink({ botJidSet, passcode }: { botJidSet: Set<string>; passcode: string }) {
  const botCusJid = botJidSet.size > 0 ? [...botJidSet].find(j => j.endsWith('@c.us')) : undefined
  const phone = botCusJid?.replace(/@c\.us$/, '') ?? ''
  const link = phone && passcode ? `https://wa.me/${phone}?text=${encodeURIComponent(passcode)}` : ''

  return (
    <div className="space-y-2 rounded-md border p-3 bg-muted/30">
      <Label className="text-sm font-medium">Pairing Link<Tip text="Share this link so contacts can start chatting with the bot. Opens WhatsApp with the passcode pre-filled." /></Label>
      {link ? (
        <div className="flex gap-2 items-center">
          <Input value={link} readOnly className="flex-1 text-xs font-mono" />
          <Button
            variant="outline"
            size="icon"
            type="button"
            onClick={() => { navigator.clipboard.writeText(link); toast.success('Link copied') }}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Set a passcode above to generate the pairing link.</p>
      )}
    </div>
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
  // Auto-save: track whether initial config load has completed (skip auto-save on first hydration)
  const initialLoadDone = React.useRef(false)
  const [autoSaveStatus, setAutoSaveStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [resolvedNames, setResolvedNames] = React.useState<Record<string, string>>({})
  // Available sessions for the Active WAHA Session dropdown
  const [availableSessions, setAvailableSessions] = React.useState<Session[]>([])
  // Bot's own JIDs (including @lid variants) — hidden from filter list displays. DO NOT REMOVE.
  const [botJidSet, setBotJidSet] = React.useState<Set<string>>(new Set())
  // Pairing link generator state

  // Field-level validation errors from backend (keyed by Zod field path)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})
  // Hidden file input for Import Config
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Load config on mount and refreshKey change
  React.useEffect(() => {
    const controller = new AbortController()
    setLoading(true)

    api.getConfig()
      .then((resp) => {
        if (controller.signal.aborted) return
        setConfig(resp.waha)
        // Store bot JIDs for filtering from display lists. DO NOT REMOVE.
        if (resp.botJids?.length) setBotJidSet(new Set(resp.botJids))
        setDirty(false)
        // Mark initial load done AFTER state settles (next tick) so the auto-save
        // useEffect does not fire for the hydration render.
        setTimeout(() => { initialLoadDone.current = true }, 0)
      })
      .catch((err) => console.error('Settings config fetch failed:', err))
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [refreshKey])

  // Load available sessions for Active WAHA Session dropdown (once on mount).
  // Restores last-picked session from localStorage when config has no saved value.
  React.useEffect(() => {
    api.getSessions()
      .then((sessions) => {
        setAvailableSessions(sessions)
        // Restore last-picked session from localStorage when config has no value
        const saved = localStorage.getItem('waha-admin-active-session')
        if (saved) {
          setConfig((prev) => {
            if (!prev || prev.wahaSessionName) return prev
            const exists = sessions.some((s) => s.sessionId === saved)
            const fallback = exists ? saved : (sessions[0]?.sessionId ?? '')
            if (!fallback) return prev
            return { ...prev, wahaSessionName: fallback }
          })
        }
      })
      .catch((err) => console.error('Settings sessions fetch failed:', err))
  }, [])

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

    const rawIds = jidKey.split(',').filter((jid) => jid && jid !== '*')
    if (rawIds.length === 0) return

    // Normalize bare numbers (god mode users) to JIDs so the resolve API can match them
    const normalizedJids = rawIds.map((id) =>
      /^\d{10,}$/.test(id) ? `${id}@c.us` : id
    )

    api.resolveNames(normalizedJids)
      .then((resp) => {
        // Map resolved names back to both the JID and the original bare identifier
        const merged: Record<string, string> = { ...resp.resolved }
        rawIds.forEach((raw, i) => {
          const norm = normalizedJids[i]
          if (norm !== raw && merged[norm]) {
            merged[raw] = merged[norm]
          }
        })
        setResolvedNames((prev) => ({ ...prev, ...merged }))
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

  // ── Auto-save: debounce 1.5s after any user change ──
  // Skips the initial hydration render via initialLoadDone ref.
  // DO NOT REMOVE — replaces manual Save button. Only auto-saves when dirty.
  React.useEffect(() => {
    if (!initialLoadDone.current || !dirty || !config) return
    setAutoSaveStatus('saving')

    const handleSaveSuccess = () => {
      setDirty(false)
      setAutoSaveStatus('saved')
      toast.success('Changes are live')
      setTimeout(() => setAutoSaveStatus((s) => s === 'saved' ? 'idle' : s), AUTOSAVE_STATUS_CLEAR_MS)
    }

    const timer = setTimeout(async () => {
      setFieldErrors({})
      try {
        await api.updateConfig(buildPayload())
        handleSaveSuccess()
      } catch (err: unknown) {
        // Config saves that trigger a gateway restart cause "Failed to fetch" because
        // the HTTP connection breaks mid-restart. Retry once after 3s. DO NOT REMOVE.
        const msg = err instanceof Error ? err.message : String(err)
        if (isNetworkError(msg)) {
          setAutoSaveStatus('saving')
          setTimeout(async () => {
            try {
              await api.updateConfig(buildPayload())
              handleSaveSuccess()
            } catch (retryErr: unknown) {
              const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr)
              if (isNetworkError(retryMsg)) {
                handleSaveSuccess()
              } else {
                setAutoSaveStatus('error')
                toast.error(`Auto-save failed: ${retryMsg}`)
              }
            }
          }, NETWORK_RETRY_DELAY_MS)
        } else {
          setAutoSaveStatus('error')
          if (!applyValidationErrors(err)) {
            toast.error(`Auto-save failed: ${msg}`)
          }
        }
      }
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, dirty])

  // Format phone number from JID for display in search results
  function formatPhone(jid: string): string {
    const match = jid.match(/^(\d+)@/)
    if (!match) return ''
    const num = match[1]
    return `+${num.slice(0, 3)}-${num.slice(3)}`
  }

  // Directory search for TagInput — contacts only (deduplicates @c.us / @lid by name)
  async function searchContacts(query: string): Promise<Array<{ value: string; label: string; phone?: string }>> {
    const result = await api.getDirectory({ search: query, limit: '10', type: 'contact' })
    // Deduplicate: prefer @c.us over @lid for same display name
    const seen = new Map<string, { value: string; label: string; phone?: string }>()
    for (const item of result.contacts) {
      const label = item.displayName || item.jid
      const existing = seen.get(label)
      if (!existing || item.jid.endsWith('@c.us')) {
        const phone = formatPhone(item.jid)
        seen.set(label, { value: item.jid, label, phone: phone || undefined })
      }
    }
    return Array.from(seen.values())
  }

  // Directory search for TagInput — groups only
  async function searchGroups(query: string): Promise<Array<{ value: string; label: string; phone?: string }>> {
    const result = await api.getDirectory({ search: query, limit: '10', type: 'group' })
    return result.contacts.map((item) => ({ value: item.jid, label: item.displayName || item.jid }))
  }

  // Hide bot's own JIDs from filter list displays — bot always has access to itself. DO NOT REMOVE.
  function excludeBotJids(jids: string[]): string[] {
    if (botJidSet.size === 0) return jids
    return jids.filter((j) => !botJidSet.has(j))
  }

  // Return bot JIDs present in a list — used to re-inject them on onChange so they aren't lost. DO NOT REMOVE.
  function botJidsInList(list: string[]): string[] {
    if (botJidSet.size === 0) return []
    return list.filter((j) => botJidSet.has(j))
  }

  // Extract JIDs from godModeSuperUsers for TagInput display
  function godModeJids(filter: 'dm' | 'group'): string[] {
    const users =
      filter === 'dm'
        ? config?.dmFilter?.godModeSuperUsers
        : config?.groupFilter?.godModeSuperUsers
    return excludeBotJids((users ?? []).map((u) => typeof u === 'string' ? u : u.identifier))
  }

  // Convert TagInput string[] back to API format, re-injecting bot JIDs that were hidden from display. DO NOT REMOVE.
  function updateGodModeUsers(filter: 'dm' | 'group', jids: string[]) {
    const key = filter === 'dm' ? 'dmFilter' : 'groupFilter'
    const existing = (filter === 'dm' ? config?.dmFilter?.godModeSuperUsers : config?.groupFilter?.godModeSuperUsers) ?? []
    const existingJids = existing.map((u) => typeof u === 'string' ? u : u.identifier)
    const hiddenBotJids = botJidsInList(existingJids)
    const allJids = [...jids, ...hiddenBotJids]
    updateConfig(`${key}.godModeSuperUsers`, allJids.map((jid) => ({ identifier: jid })))
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

    // God mode values — read from dmFilter (source of truth), sync to both filters
    const godModeBypass = config.dmFilter?.godModeBypass ?? false
    const godModeScope = config.dmFilter?.godModeScope ?? 'off'
    const godModeSuperUsers = (config.dmFilter?.godModeSuperUsers ?? []).map((u) =>
      typeof u === 'string' ? { identifier: u } : u
    )

    // New top-level god mode field
    if (config.godModeGroupReplyMode !== undefined) waha.godModeGroupReplyMode = config.godModeGroupReplyMode

    // Complete sub-objects — always send complete (Pitfall 5)
    // God mode fields synced from unified card to BOTH filters. DO NOT CHANGE.
    if (config.dmFilter) {
      waha.dmFilter = {
        enabled: config.dmFilter.enabled,
        mentionPatterns: config.dmFilter.mentionPatterns ?? [],
        godModeBypass,
        godModeScope,
        godModeSuperUsers,
        tokenEstimate: config.dmFilter.tokenEstimate,
      }
    }

    if (config.groupFilter) {
      waha.groupFilter = {
        enabled: config.groupFilter.enabled,
        mentionPatterns: config.groupFilter.mentionPatterns ?? [],
        godModeBypass,
        godModeScope,
        godModeSuperUsers,
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
        hmacSecret: config.pairingMode.hmacSecret,
        wrongPasscodeMessage: config.pairingMode.wrongPasscodeMessage,
        lockoutMessage: config.pairingMode.lockoutMessage,
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

    // Phase 57 (UI-02): sendGate and hourlyCap — mimicry timing controls. DO NOT REMOVE.
    if (config.sendGate) {
      waha.sendGate = {
        enabled: config.sendGate.enabled,
        timezone: config.sendGate.timezone,
        startHour: config.sendGate.startHour,
        endHour: config.sendGate.endHour,
        onBlock: config.sendGate.onBlock,
      }
    }

    if (config.hourlyCap) {
      waha.hourlyCap = {
        enabled: config.hourlyCap.enabled,
        limits: {
          new: config.hourlyCap.limits.new,
          warming: config.hourlyCap.limits.warming,
          stable: config.hourlyCap.limits.stable,
        },
      }
    }

    return { waha }
  }

  // Parse structured validation error response and set field-level errors
  function applyValidationErrors(err: unknown): boolean {
    if (err && typeof err === 'object' && (err as Record<string, unknown>).error === 'validation_failed') {
      const fields = (err as Record<string, unknown>).fields
      if (Array.isArray(fields)) {
        const errMap: Record<string, string> = {}
        for (const f of fields) errMap[f.path] = f.message
        setFieldErrors(errMap)
        toast.error(`Validation failed: ${fields.length} field(s) have errors`)
        return true
      }
    }
    return false
  }

  async function handleSave() {
    setSaving(true)
    setFieldErrors({})
    try {
      await api.updateConfig(buildPayload())
      setDirty(false)
      toast.success('Settings saved')
    } catch (err: unknown) {
      if (!applyValidationErrors(err)) {
        toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveAndRestart() {
    setSaving(true)
    setFieldErrors({})
    try {
      await api.updateConfig(buildPayload())
      setDirty(false)
      toast.success('Restarting gateway...')
      setSaving(false)
      await api.restart()
      setRestarting(true)
    } catch (err: unknown) {
      setSaving(false)
      if (!applyValidationErrors(err)) {
        toast.error(`Save & Restart failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  async function handleExport() {
    try {
      const blob = await api.exportConfig()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'openclaw-config.json'
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Config exported')
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFieldErrors({})
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      await api.importConfig(parsed)
      toast.success('Config imported successfully')
      // Reload config from server so UI reflects imported state
      const resp = await api.getConfig()
      setConfig(resp.waha)
      setDirty(false)
    } catch (err: unknown) {
      if (!applyValidationErrors(err)) {
        toast.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    } finally {
      // Reset file input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ''
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
        <Collapsible defaultOpen={true}>
          <Card>
            <CollapsibleTrigger className="w-full text-left">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle>General Settings</CardTitle>
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="baseUrl">Base URL<Tip text="WhatsApp API server URL. Must be accessible from this host. Example: http://127.0.0.1:3004" /></Label>
                <Input
                  id="baseUrl"
                  value={config.baseUrl ?? ''}
                  onChange={(e) => updateConfig('baseUrl', e.target.value)}
                  placeholder="http://localhost:3000"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wahaSessionName">Active WhatsApp Session<Tip text="WhatsApp session name. Select from sessions available on the server." /></Label>
                <Select
                  value={config.wahaSessionName ?? ''}
                  onValueChange={(v) => {
                    updateConfig('wahaSessionName', v)
                    localStorage.setItem('waha-admin-active-session', v)
                  }}
                >
                  <SelectTrigger id="wahaSessionName">
                    <SelectValue placeholder="Select session..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableSessions.map((s) => (
                      <SelectItem key={s.sessionId} value={s.sessionId}>
                        {s.name ?? s.sessionId}{s.role ? <span className="text-muted-foreground ml-1">({s.role})</span> : null}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="webhookPort">Webhook Port<Tip text="Port the webhook HTTP server listens on. Default: 8050. Restart required after change." /></Label>
                <Input
                  id="webhookPort"
                  type="number"
                  value={config.webhookPort ?? ''}
                  onChange={(e) => updateConfig('webhookPort', Number(e.target.value))}
                />
                <FieldError path="webhookPort" errors={fieldErrors} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="webhookPath">Webhook Path<Tip text="URL path for incoming webhook events. Default: /webhook/waha" /></Label>
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
                    <SelectItem value="dm">dm</SelectItem>
                    <SelectItem value="reply-in-chat">reply-in-chat</SelectItem>
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
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 2: Access Control */}
        <Collapsible defaultOpen={true}>
          <Card>
            <CollapsibleTrigger className="w-full text-left">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle>Access Control</CardTitle>
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
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
                values={excludeBotJids(config.allowFrom ?? [])}
                onChange={(v) => updateConfig('allowFrom', [...v, ...botJidsInList(config.allowFrom ?? [])])}
                searchFn={searchContacts}
                resolvedNames={resolvedNames}
                mergeByName
                placeholder="Search contacts..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>Group Allow From<Tip text="JIDs allowed to trigger the bot in groups. Press Enter or comma to add. Include both @c.us and @lid for the same person (NOWEB sends @lid)." /></Label>
              <TagInput
                values={excludeBotJids(config.groupAllowFrom ?? [])}
                onChange={(v) => updateConfig('groupAllowFrom', [...v, ...botJidsInList(config.groupAllowFrom ?? [])])}
                searchFn={searchContacts}
                resolvedNames={resolvedNames}
                mergeByName
                placeholder="Search contacts..."
              />
            </div>

            <div className="space-y-1.5">
              <Label>Allowed Groups<Tip text="Group JIDs the bot will respond in. Press Enter or comma to add. Leave empty to allow all groups (with open policy)." /></Label>
              <TagInput
                values={config.allowedGroups ?? []}
                onChange={(v) => updateConfig('allowedGroups', v)}
                searchFn={searchGroups}
                resolvedNames={resolvedNames}
                placeholder="Search groups..."
              />
            </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 3: DM Keyword Filter */}
        <Collapsible defaultOpen={false}>
          <Card>
            <CollapsibleTrigger className="w-full text-left">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle>DM Keyword Filter</CardTitle>
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
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

            <div className="space-y-1.5">
              <Label htmlFor="dmFilter.tokenEstimate">Token Estimate<Tip text="Estimated tokens saved per dropped DM. Used for stats display only. Default: 2500." /></Label>
              <Input
                id="dmFilter.tokenEstimate"
                type="number"
                value={config.dmFilter?.tokenEstimate ?? ''}
                onChange={(e) => updateConfig('dmFilter.tokenEstimate', Number(e.target.value))}
                className="w-40"
              />
              <FieldError path="dmFilter.tokenEstimate" errors={fieldErrors} />
            </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 4: Group Keyword Filter */}
        <Collapsible defaultOpen={false}>
          <Card>
            <CollapsibleTrigger className="w-full text-left">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle>Group Keyword Filter</CardTitle>
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
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

            <div className="space-y-1.5">
              <Label htmlFor="groupFilter.tokenEstimate">Token Estimate<Tip text="Estimated tokens saved per dropped group message. Default: 2500." /></Label>
              <Input
                id="groupFilter.tokenEstimate"
                type="number"
                value={config.groupFilter?.tokenEstimate ?? ''}
                onChange={(e) => updateConfig('groupFilter.tokenEstimate', Number(e.target.value))}
                className="w-40"
              />
              <FieldError path="groupFilter.tokenEstimate" errors={fieldErrors} />
            </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 5: God Mode — unified card that syncs to both dmFilter and groupFilter */}
        <Collapsible defaultOpen={false}>
          <Card>
            <CollapsibleTrigger className="w-full text-left">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle>God Mode<Tip text="Super-user access that bypasses keyword filters. God mode users can message the bot without matching any mention pattern. These are global defaults — override per contact in Directory." /></CardTitle>
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Switch
                id="godMode.enabled"
                checked={config.dmFilter?.godModeBypass ?? false}
                onCheckedChange={(v) => {
                  updateConfig('dmFilter.godModeBypass', v)
                  updateConfig('groupFilter.godModeBypass', v)
                }}
              />
              <Label htmlFor="godMode.enabled">Enabled<Tip text="When on, god mode users bypass keyword filters entirely (their messages always get a response)." /></Label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="godMode.scope">Scope<Tip text="Where god mode bypass is active. 'All' = DMs and groups. 'DMs Only' = bypass DM filter only. 'Groups Only' = bypass group filter only." /></Label>
              <Select
                value={config.dmFilter?.godModeScope ?? 'off'}
                onValueChange={(v) => {
                  updateConfig('dmFilter.godModeScope', v)
                  updateConfig('groupFilter.godModeScope', v)
                }}
              >
                <SelectTrigger id="godMode.scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="dm">DMs Only</SelectItem>
                  <SelectItem value="group">Groups Only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="godMode.groupReplyMode">Group Reply Mode<Tip text="How the bot responds to god mode users in groups. 'Reply in Group' = normal group reply. 'Reply in DM' = bot sends the response privately to avoid spamming the group." /></Label>
              <Select
                value={config.godModeGroupReplyMode ?? 'in-chat'}
                onValueChange={(v) => updateConfig('godModeGroupReplyMode', v)}
              >
                <SelectTrigger id="godMode.groupReplyMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in-chat">Reply in Group</SelectItem>
                  <SelectItem value="dm">Reply in DM</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>God Mode Users<Tip text="JIDs that bypass keyword filters. Search and select contacts. Include both @c.us and @lid formats for NOWEB compatibility." /></Label>
              <TagInput
                values={godModeJids('dm')}
                onChange={(v) => {
                  updateGodModeUsers('dm', v)
                  updateGodModeUsers('group', v)
                }}
                searchFn={searchContacts}
                freeform={true}
                resolvedNames={resolvedNames}
                mergeByName
                placeholder="Search contacts or type JID..."
              />
            </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 6: Presence Settings */}
        <Collapsible defaultOpen={false}>
          <Card>
            <CollapsibleTrigger className="w-full text-left">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle>Presence Settings</CardTitle>
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
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
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 7: Unauthorized DM Response (merged Passcode + Auto Reply) */}
        <Collapsible defaultOpen={false}>
          <Card>
            <CollapsibleTrigger className="w-full text-left">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle>Unauthorized DM Response</CardTitle>
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-6">
                {/* Auto Reply section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Switch
                      id="autoReply.enabled"
                      checked={config.autoReply?.enabled ?? false}
                      onCheckedChange={(v) => {
                        updateConfig('autoReply.enabled', v)
                        // Mutual exclusion: auto reply ON → passcode OFF
                        if (v) updateConfig('pairingMode.enabled', false)
                      }}
                    />
                    <Label htmlFor="autoReply.enabled">Auto Reply<Tip text="Send an automatic rejection message to unauthorized DMs. Cannot be used together with Passcode Protection." /></Label>
                  </div>
                  {(config.autoReply?.enabled ?? false) && (
                    <div className="space-y-4 pl-10">
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
                    </div>
                  )}
                </div>

                <hr className="border-border" />

                {/* Passcode Protection section */}
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Switch
                      id="pairingMode.enabled"
                      checked={config.pairingMode?.enabled ?? false}
                      onCheckedChange={(v) => {
                        updateConfig('pairingMode.enabled', v)
                        // Mutual exclusion: passcode ON → auto reply OFF
                        if (v) updateConfig('autoReply.enabled', false)
                        // Auto-generate hmacSecret when enabling passcode protection.
                        // Without hmacSecret the backend gate `if (enabled && hmacSecret)` fails
                        // and pairing deep links cannot be generated. DO NOT REMOVE.
                        if (v && !config.pairingMode?.hmacSecret) {
                          const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
                            .map(b => b.toString(16).padStart(2, '0')).join('')
                          updateConfig('pairingMode.hmacSecret', secret)
                        }
                      }}
                    />
                    <Label htmlFor="pairingMode.enabled">Passcode Protection<Tip text="Unknown DM senders can enter a passcode to get added to the allow list. Cannot be used together with Auto Reply." /></Label>
                  </div>
                  {(config.pairingMode?.enabled ?? false) && (
                    <div className="space-y-4 pl-10">
                      <div className="space-y-1.5">
                        <Label htmlFor="pairingMode.passcode">Passcode<Tip text="The 6-digit code contacts must enter to get DM access. Click Generate to create a random one." /></Label>
                        <div className="flex gap-2">
                          <Input
                            id="pairingMode.passcode"
                            value={config.pairingMode?.passcode ?? ''}
                            onChange={(e) => updateConfig('pairingMode.passcode', e.target.value)}
                            className="flex-1"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            type="button"
                            onClick={() => updateConfig('pairingMode.passcode', String(Math.floor(100000 + Math.random() * 900000)))}
                          >
                            Generate
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pairingMode.grantTtlMinutes">Expiry Duration<Tip text="How long pairing-granted access lasts. After this period, access is automatically revoked." /></Label>
                        <Select
                          value={String(config.pairingMode?.grantTtlMinutes ?? 0)}
                          onValueChange={(v) => updateConfig('pairingMode.grantTtlMinutes', Number(v))}
                        >
                          <SelectTrigger id="pairingMode.grantTtlMinutes" className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">Never</SelectItem>
                            <SelectItem value="30">30 minutes</SelectItem>
                            <SelectItem value="60">1 hour</SelectItem>
                            <SelectItem value="240">4 hours</SelectItem>
                            <SelectItem value="1440">24 hours</SelectItem>
                            <SelectItem value="10080">7 days</SelectItem>
                          </SelectContent>
                        </Select>
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
                      <div className="space-y-1.5">
                        <Label htmlFor="pairingMode.wrongPasscodeMessage">Wrong Passcode Message<Tip text="Sent when a contact enters an incorrect passcode." /></Label>
                        <textarea
                          id="pairingMode.wrongPasscodeMessage"
                          className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          value={config.pairingMode?.wrongPasscodeMessage ?? 'Incorrect passcode. Please try again.'}
                          onChange={(e) => updateConfig('pairingMode.wrongPasscodeMessage', e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pairingMode.lockoutMessage">Lockout Message<Tip text="Sent after 3 consecutive wrong attempts." /></Label>
                        <textarea
                          id="pairingMode.lockoutMessage"
                          className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          value={config.pairingMode?.lockoutMessage ?? 'Too many incorrect attempts. Please try again later.'}
                          onChange={(e) => updateConfig('pairingMode.lockoutMessage', e.target.value)}
                        />
                      </div>
                      {/* Pairing Link — pre-populated with bot's phone + static passcode */}
                      <PairingLink botJidSet={botJidSet} passcode={config.pairingMode?.passcode ?? ''} />
                    </div>
                  )}
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 8: Media Preprocessing */}
        <Collapsible defaultOpen={false}>
          <Card>
            <CollapsibleTrigger className="w-full text-left">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle>Media Preprocessing</CardTitle>
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
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
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 9: Markdown */}
        <Collapsible defaultOpen={false}>
          <Card>
            <CollapsibleTrigger className="w-full text-left">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle>Markdown</CardTitle>
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
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
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 10: Actions */}
        <Collapsible defaultOpen={false}>
          <Card>
            <CollapsibleTrigger className="w-full text-left">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle>Actions</CardTitle>
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
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
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 11: Multi-Session Filtering Guide (collapsible info) */}
        <Collapsible defaultOpen={false}>
          <Card>
            <CollapsibleTrigger className="w-full text-left">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Multi-Session Filtering Guide</CardTitle>
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4 text-sm text-muted-foreground">
                <div>
                  <p className="font-medium text-foreground mb-1">Message Processing Pipeline</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Message arrives on a session (bot or human)</li>
                    <li>Session role check — human sessions require a trigger word</li>
                    <li>Group policy check — is this group in the allowed list?</li>
                    <li>DM policy check — is this sender in the allow-from list?</li>
                    <li>Keyword filter — does the message match a mention pattern?</li>
                    <li>God Mode bypass — super-users skip keyword filters</li>
                    <li>Message delivered to AI agent</li>
                  </ol>
                </div>

                <div>
                  <p className="font-medium text-foreground mb-1">Common Scenarios</p>
                  <div className="space-y-2">
                    <div>
                      <p className="font-medium text-foreground/80">Bot + Human session in same group</p>
                      <p>The bot session processes messages normally. The human session only forwards messages that start with the trigger word. Both sessions can coexist — the bot handles automated responses while the human monitors or sends manual messages.</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground/80">Only human session in group</p>
                      <p>All messages are forwarded only if they start with the trigger word. This lets a human use the group normally while the bot only sees triggered messages.</p>
                    </div>
                    <div>
                      <p className="font-medium text-foreground/80">DMs</p>
                      <p>DMs bypass the trigger word check. The bot responds to all DMs from contacts in the Allow From list (or all DMs if policy is "open").</p>
                    </div>
                  </div>
                </div>

                <div>
                  <p className="font-medium text-foreground mb-1">God Mode Scope</p>
                  <ul className="space-y-1">
                    <li><span className="font-medium text-foreground/80">all</span> — Bypass both DM and Group keyword filters (recommended for bot sessions)</li>
                    <li><span className="font-medium text-foreground/80">dm</span> — Bypass DM filter only, group filter still applies (recommended for human sessions in groups)</li>
                    <li><span className="font-medium text-foreground/80">off</span> — Never bypass keyword filters</li>
                  </ul>
                </div>

                <div>
                  <p className="font-medium text-foreground mb-1">Per-Group Filter Overrides</p>
                  <p>Individual groups can override the global keyword filter settings. Go to Directory → Groups → click a group row → use the Filter Override section to customize patterns, god mode scope, and trigger behavior for that specific group.</p>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Section 12: Send Gate & Rate Limits (Phase 57, UI-02) — mimicry timing controls. DO NOT REMOVE. */}
        <Collapsible defaultOpen={false}>
          <Card>
            <CollapsibleTrigger className="w-full text-left">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle>Send Gate &amp; Rate Limits<Tip text="Human mimicry timing controls. Send gate blocks outbound messages outside the configured time window. Hourly caps limit how many messages can be sent per session per hour." /></CardTitle>
                  <ChevronDown className="h-4 w-4 transition-transform duration-200 [[data-state=open]_&]:rotate-180" />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">

                {/* Send Gate Toggle */}
                <div className="flex items-center gap-3">
                  <Switch
                    id="sendGate.enabled"
                    checked={config.sendGate?.enabled ?? false}
                    onCheckedChange={(v) => updateConfig('sendGate.enabled', v)}
                  />
                  <Label htmlFor="sendGate.enabled">Send Gate Enabled<Tip text="When on, outbound messages outside the configured time window are blocked or queued." /></Label>
                </div>

                {/* Send Window Hours */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="sendGate.startHour">Window Start (hour)<Tip text="Hour of day (0-23) when the send gate opens. Default: 7 (7am)." /></Label>
                    <Input
                      id="sendGate.startHour"
                      type="number" min={0} max={23}
                      value={config.sendGate?.startHour ?? 7}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10)
                        if (!isNaN(n) && n >= 0 && n <= 23) updateConfig('sendGate.startHour', n)
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sendGate.endHour">Window End (hour)<Tip text="Hour of day (0-23) when the send gate closes. Default: 1 (1am). Cross-midnight: endHour ≤ startHour." /></Label>
                    <Input
                      id="sendGate.endHour"
                      type="number" min={0} max={23}
                      value={config.sendGate?.endHour ?? 1}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10)
                        if (!isNaN(n) && n >= 0 && n <= 23) updateConfig('sendGate.endHour', n)
                      }}
                    />
                  </div>
                </div>

                {/* Timezone */}
                <div className="space-y-1.5">
                  <Label htmlFor="sendGate.timezone">Timezone (IANA)<Tip text="Timezone for the send window. Use IANA format, e.g. Asia/Jerusalem, America/New_York, UTC." /></Label>
                  <Input
                    id="sendGate.timezone"
                    value={config.sendGate?.timezone ?? 'UTC'}
                    onChange={(e) => updateConfig('sendGate.timezone', e.target.value)}
                    placeholder="e.g. Asia/Jerusalem"
                  />
                </div>

                {/* Quiet Hours Policy */}
                <div className="space-y-1.5">
                  <Label htmlFor="sendGate.onBlock">Quiet Hours Policy<Tip text="What happens when a send is attempted outside the window. Reject = return error immediately. Queue = hold until window opens." /></Label>
                  <Select
                    value={config.sendGate?.onBlock ?? 'reject'}
                    onValueChange={(v) => updateConfig('sendGate.onBlock', v)}
                  >
                    <SelectTrigger id="sendGate.onBlock">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reject">Reject</SelectItem>
                      <SelectItem value="queue">Queue</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <hr className="border-border" />

                {/* Hourly Cap Toggle */}
                <div className="flex items-center gap-3">
                  <Switch
                    id="hourlyCap.enabled"
                    checked={config.hourlyCap?.enabled ?? true}
                    onCheckedChange={(v) => updateConfig('hourlyCap.enabled', v)}
                  />
                  <Label htmlFor="hourlyCap.enabled">Hourly Cap Enabled<Tip text="When on, outbound messages are capped per session per hour based on account maturity." /></Label>
                </div>

                {/* Progressive Limits Table */}
                <div className="space-y-2">
                  <Label className="text-sm">Progressive Limits (messages/hr)<Tip text="Per-session hourly send limits based on account age. New accounts have lower limits to reduce ban risk." /></Label>
                  {([
                    { label: 'New (0-7 days)', key: 'new' as const, dflt: 15 },
                    { label: 'Warming (8-30 days)', key: 'warming' as const, dflt: 30 },
                    { label: 'Stable (30+ days)', key: 'stable' as const, dflt: 50 },
                  ] as { label: string; key: 'new' | 'warming' | 'stable'; dflt: number }[]).map(({ label, key, dflt }) => (
                    <div key={key} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <Input
                        type="number" min={1} className="w-20 h-7 text-right"
                        value={config.hourlyCap?.limits?.[key] ?? dflt}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10)
                          if (!isNaN(n) && n > 0) updateConfig(`hourlyCap.limits.${key}`, n)
                        }}
                      />
                    </div>
                  ))}
                </div>

              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>

        {/* Export / Import buttons + auto-save indicator */}
        <div className="flex flex-wrap items-center gap-3 pb-6">
          <Button variant="outline" onClick={handleExport} disabled={saving}>
            Export Config
          </Button>
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={saving}>
            Import Config
          </Button>
          {/* Hidden file input for Import Config — reset after each use so same file re-triggers onChange */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
          {/* Auto-save status indicator */}
          {autoSaveStatus === 'saving' && (
            <span className="text-sm text-muted-foreground animate-pulse">Saving...</span>
          )}
          {autoSaveStatus === 'saved' && (
            <span className="text-sm text-emerald-500">Saved</span>
          )}
          {autoSaveStatus === 'error' && (
            <span className="text-sm text-destructive">Save failed</span>
          )}
        </div>
      </div>
    </>
  )
}
