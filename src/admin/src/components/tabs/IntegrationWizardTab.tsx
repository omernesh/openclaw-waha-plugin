// Phase 63 (AUTH-06): Integration wizard — MCP config, REST curl examples, SKILL.md download.
//
// - Fetches user's first API key (masked) for snippet pre-fill
// - Three tabs: MCP config | REST API | SKILL.md
// - Copy-to-clipboard button on every code block (Copy → Check for 2s)
// - "No API keys" state links user to API Keys tab
// - "Send Test Message" button in REST tab calls POST /api/v1/send
//
// DO NOT CHANGE: window.location.origin is used for server URL (works in dev + prod)
// DO NOT CHANGE: authClient.apiKey.list() pattern — matches ApiKeysTab
// DO NOT CHANGE: SKILL.md download opens /SKILL.md (served by standalone server)

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { Copy, Check, Download, Plug, Send, AlertCircle } from 'lucide-react'
import { authClient } from '@/lib/auth-client'

interface ApiKey {
  id: string
  name: string | null
  start: string | null
}

interface IntegrationWizardTabProps {
  selectedSession: string
  refreshKey: number
  onLoadingChange: (loading: boolean) => void
}

// Masked display key — same pattern as ApiKeysTab
function maskedKeyDisplay(start: string | null): string {
  if (!start) return 'ctl_...????'
  return `${start}...????`
}

// CopyButton: shows Copy icon, switches to Check for 2s on click
function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Failed to copy — please copy manually')
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="h-7 gap-1.5 text-xs"
      title={label ?? 'Copy to clipboard'}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {copied ? 'Copied!' : 'Copy'}
    </Button>
  )
}

// CodeBlock: dark monospace block with copy button in top-right corner
function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <div className="relative rounded-lg bg-zinc-900 text-zinc-100 overflow-hidden">
      <div className="absolute top-2 right-2">
        <CopyButton value={code} label={label} />
      </div>
      <pre className="overflow-x-auto p-4 pr-24 text-xs leading-relaxed font-mono whitespace-pre">
        {code}
      </pre>
    </div>
  )
}

export default function IntegrationWizardTab({ onLoadingChange }: IntegrationWizardTabProps) {
  const [apiKey, setApiKey] = useState<ApiKey | null>(null)
  const [loading, setLoading] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)

  const serverUrl = window.location.origin
  const keyDisplay = apiKey ? maskedKeyDisplay(apiKey.start) : '<YOUR_API_KEY>'
  const hasKey = apiKey !== null

  useEffect(() => {
    async function loadFirstKey() {
      setLoading(true)
      onLoadingChange(true)
      try {
        const result = await authClient.apiKey.list()
        if (result.error) {
          toast.error(result.error.message ?? 'Failed to load API keys')
          return
        }
        const keys = (result.data as ApiKey[] | null) ?? []
        setApiKey(keys.length > 0 ? keys[0] : null)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load API keys')
      } finally {
        setLoading(false)
        onLoadingChange(false)
      }
    }
    loadFirstKey()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // MCP config JSON
  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        chatlytics: {
          url: `${serverUrl}/mcp`,
          headers: {
            Authorization: `Bearer ${keyDisplay}`,
          },
        },
      },
    },
    null,
    2
  )

  // REST curl examples
  const curlSend = `curl -X POST ${serverUrl}/api/v1/send \\
  -H "Authorization: Bearer ${keyDisplay}" \\
  -H "Content-Type: application/json" \\
  -d '{"to": "John", "text": "Hello from Chatlytics!"}'`

  const curlSearch = `curl "${serverUrl}/api/v1/search?q=marketing" \\
  -H "Authorization: Bearer ${keyDisplay}"`

  async function handleSendTestMessage() {
    if (!hasKey) {
      toast.error('Create an API key first')
      return
    }
    setSendingTest(true)
    try {
      // We use the key via the session cookie auth that's already active in the admin panel.
      // The /api/v1/send endpoint validates via Authorization header; we pass the masked display key
      // here as a demonstration — the actual curl will use the real key.
      const resp = await fetch(`${serverUrl}/api/v1/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Use session auth (already authenticated via cookie in admin panel)
        },
        body: JSON.stringify({
          to: 'me',
          text: 'Test message from Chatlytics integration wizard',
        }),
      })
      if (resp.ok) {
        toast.success('Test message sent successfully')
      } else {
        const body = await resp.json().catch(() => ({}))
        toast.error((body as { error?: string }).error ?? `Request failed: ${resp.status}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send test message')
    } finally {
      setSendingTest(false)
    }
  }

  function handleDownloadSkill() {
    window.open(`${serverUrl}/SKILL.md`, '_blank', 'noreferrer')
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h2 className="text-xl font-semibold">Integration</h2>
          <p className="text-sm text-muted-foreground mt-1">Loading your API key...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold">Integration</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Copy-paste config snippets to connect your AI agent or application to Chatlytics.
        </p>
      </div>

      {/* No API key warning */}
      {!hasKey && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 pt-4">
            <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-muted-foreground">
              No API keys found. Go to the{' '}
              <span className="font-semibold text-foreground">API Keys</span> tab to create one,
              then return here for pre-filled snippets.
            </p>
          </CardContent>
        </Card>
      )}

      {/* API key in use */}
      {hasKey && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Plug className="h-4 w-4 flex-shrink-0" />
          Using key:{' '}
          <Badge variant="secondary" className="font-mono text-xs">
            {keyDisplay}
          </Badge>
          <span className="text-xs">(replace with full key value)</span>
        </div>
      )}

      {/* Integration options */}
      <Tabs defaultValue="mcp">
        <TabsList className="mb-4">
          <TabsTrigger value="mcp">MCP (Claude Code)</TabsTrigger>
          <TabsTrigger value="rest">REST API</TabsTrigger>
          <TabsTrigger value="skill">SKILL.md</TabsTrigger>
        </TabsList>

        {/* ── MCP Tab ─────────────────────────────────────────────────── */}
        <TabsContent value="mcp" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Claude Code / MCP Client Config</CardTitle>
              <CardDescription>
                Add this to your <code className="text-xs bg-muted px-1 py-0.5 rounded">claude_desktop_config.json</code> or{' '}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">.claude/mcp.json</code> to connect Claude to Chatlytics.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <CodeBlock code={mcpConfig} label="Copy MCP config" />
              <p className="text-xs text-muted-foreground">
                Replace <code className="bg-muted px-1 rounded">{keyDisplay}</code> with the full
                plaintext API key from the{' '}
                <span className="font-medium text-foreground">API Keys</span> tab.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── REST Tab ────────────────────────────────────────────────── */}
        <TabsContent value="rest" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Send a Message</CardTitle>
              <CardDescription>
                POST to <code className="text-xs bg-muted px-1 py-0.5 rounded">/api/v1/send</code> with a recipient and text.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <CodeBlock code={curlSend} label="Copy send command" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Search Contacts</CardTitle>
              <CardDescription>
                GET <code className="text-xs bg-muted px-1 py-0.5 rounded">/api/v1/search</code> to find contacts by name.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <CodeBlock code={curlSearch} label="Copy search command" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Send Test Message</CardTitle>
              <CardDescription>
                Verify your connection by sending a test message to yourself.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={handleSendTestMessage}
                disabled={sendingTest || !hasKey}
                className="gap-2"
              >
                {sendingTest ? (
                  <Send className="h-4 w-4 animate-pulse" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {sendingTest ? 'Sending...' : 'Send Test Message'}
              </Button>
              {!hasKey && (
                <p className="text-xs text-muted-foreground mt-2">
                  Create an API key first to enable this button.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── SKILL.md Tab ─────────────────────────────────────────────── */}
        <TabsContent value="skill" className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">SKILL.md — Agent Documentation</CardTitle>
              <CardDescription>
                Give this file to your AI agent so it knows all available WhatsApp actions.
                SKILL.md is the agent-facing documentation — it describes every action, parameter,
                and usage example in a format optimised for LLMs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-muted/40 p-4 text-sm space-y-2">
                <p className="font-medium">What's inside SKILL.md:</p>
                <ul className="list-disc list-inside text-muted-foreground space-y-1 text-xs">
                  <li>All available WhatsApp actions (send, poll, react, edit, group management, etc.)</li>
                  <li>Parameter names, types, and descriptions for every action</li>
                  <li>Target resolution rules (names, JIDs, groups)</li>
                  <li>Usage examples and edge cases</li>
                </ul>
              </div>
              <Button onClick={handleDownloadSkill} className="gap-2">
                <Download className="h-4 w-4" />
                Download SKILL.md
              </Button>
              <p className="text-xs text-muted-foreground">
                Opens <code className="bg-muted px-1 rounded">{serverUrl}/SKILL.md</code> in a new tab.
                Right-click → Save As to download.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
