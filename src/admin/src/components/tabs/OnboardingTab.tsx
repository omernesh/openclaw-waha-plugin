// Phase 63 (AUTH-03): OnboardingTab — QR code pairing flow for WhatsApp session setup.
//
// Three states:
//   "scanning"  — QR image shown, polling every 20s
//   "connected" — phone scanned the code, session is WORKING
//   "error"     — session FAILED or QR fetch error
//
// Polls GET /api/admin/qr?session=xxx every 20s.
// If status === "WORKING" → clears interval and shows success.
// "Start New Session" button → POST /api/admin/qr/start?session=<name>
//
// DO NOT CHANGE: setInterval period is 20000ms — less is too aggressive for WAHA
// DO NOT CHANGE: clearInterval in cleanup effect return — prevents memory leak

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { QrCode, Check, RefreshCw, AlertCircle } from 'lucide-react'

interface QrResponse {
  qrBase64: string | null
  mimetype: string
  status: string
  error?: string
}

interface OnboardingTabProps {
  selectedSession: string
  refreshKey: number
  onLoadingChange: (loading: boolean) => void
}

type QrState = 'scanning' | 'connected' | 'error'

export default function OnboardingTab({ selectedSession, onLoadingChange }: OnboardingTabProps) {
  const [qrState, setQrState] = useState<QrState>('scanning')
  const [qrBase64, setQrBase64] = useState<string | null>(null)
  const [mimetype, setMimetype] = useState('image/png')
  const [status, setStatus] = useState<string>('')
  const [newSessionName, setNewSessionName] = useState('')
  const [startingSession, setStartingSession] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)

  const sessionId = selectedSession === 'all' ? '' : selectedSession

  async function fetchQr() {
    const params = sessionId ? `?session=${encodeURIComponent(sessionId)}` : ''
    try {
      const res = await fetch(`/api/admin/qr${params}`)
      const data: QrResponse = await res.json()
      if (data.error === 'session_not_found') {
        setLastError('Session not found. Use "Start New Session" below.')
        setQrState('error')
        return
      }
      setStatus(data.status ?? '')
      if (data.status === 'WORKING') {
        setQrState('connected')
      } else if (data.status === 'FAILED') {
        setLastError('Session failed. Please start a new session.')
        setQrState('error')
      } else {
        setQrBase64(data.qrBase64)
        setMimetype(data.mimetype ?? 'image/png')
        setQrState('scanning')
      }
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Failed to fetch QR code')
      setQrState('error')
    }
  }

  useEffect(() => {
    onLoadingChange(true)
    fetchQr().finally(() => onLoadingChange(false))

    if (qrState === 'connected') return

    const interval = setInterval(() => {
      fetchQr()
    }, 20_000)

    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  async function handleStartSession() {
    const name = newSessionName.trim()
    if (!name) {
      toast.error('Please enter a session name')
      return
    }
    setStartingSession(true)
    try {
      const res = await fetch(`/api/admin/qr/start?session=${encodeURIComponent(name)}`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        toast.error(data.error ?? 'Failed to start session')
        return
      }
      toast.success(`Session "${name}" started — scan the QR code`)
      setQrState('scanning')
      setLastError(null)
      setNewSessionName('')
      fetchQr()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start session')
    } finally {
      setStartingSession(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold">WhatsApp Pairing</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Scan the QR code with WhatsApp on your phone to connect your session.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" />
            QR Code
            {status && (
              <Badge variant={qrState === 'connected' ? 'default' : qrState === 'error' ? 'destructive' : 'secondary'}>
                {status}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {qrState === 'connected' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
                <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-lg font-medium text-green-700 dark:text-green-400">Connected!</p>
              <p className="text-sm text-muted-foreground">Your WhatsApp session is active.</p>
            </div>
          )}

          {qrState === 'error' && (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900">
                <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
              </div>
              <p className="text-sm text-muted-foreground">{lastError ?? 'An error occurred'}</p>
              <Button variant="outline" size="sm" onClick={() => { setQrState('scanning'); fetchQr() }}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Retry
              </Button>
            </div>
          )}

          {qrState === 'scanning' && (
            <>
              {qrBase64 ? (
                <img
                  src={`data:${mimetype};base64,${qrBase64}`}
                  alt="WhatsApp QR code"
                  className="w-64 h-64 object-contain border rounded-lg"
                />
              ) : (
                <div className="w-64 h-64 flex items-center justify-center border rounded-lg text-muted-foreground text-sm">
                  Loading QR code...
                </div>
              )}
              <p className="text-xs text-muted-foreground">Refreshes every 20 seconds</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Start New Session</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="session-name" className="sr-only">Session name</Label>
              <Input
                id="session-name"
                placeholder="e.g. my-session"
                value={newSessionName}
                onChange={(e) => setNewSessionName(e.target.value)}
                disabled={startingSession}
                onKeyDown={(e) => e.key === 'Enter' && handleStartSession()}
              />
            </div>
            <Button onClick={handleStartSession} disabled={startingSession}>
              {startingSession ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                'Start'
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Creates a new WAHA session with the given name. The QR code will appear above.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
