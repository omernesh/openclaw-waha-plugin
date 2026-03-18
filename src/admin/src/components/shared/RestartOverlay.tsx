import * as React from 'react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const RESTART_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

interface RestartOverlayProps {
  active: boolean  // When true, shows full-screen blocking overlay
  onComplete: () => void  // Called when gateway responds to poll
  onTimeout: () => void   // Called after timeout with no response
}

// DO NOT CHANGE: Restart overlay polls api.getStats() every 2s using recursive
// setTimeout (NOT setInterval). This avoids stacking requests when server is slow.
// Pattern confirmed from monitor.ts lines 2832-2895.
export function RestartOverlay({ active, onComplete, onTimeout }: RestartOverlayProps) {
  const [elapsed, setElapsed] = React.useState(0)
  const [timedOut, setTimedOut] = React.useState(false)
  const abortRef = React.useRef<AbortController | null>(null)
  const startTimeRef = React.useRef<number>(0)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const elapsedTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)

  // Shared poll logic — recursively calls api.getStats() until success or timeout.
  // Uses recursive setTimeout (not setInterval) to avoid stacking requests.
  function pollUntilReady() {
    if (abortRef.current?.signal.aborted) return

    const ms = Date.now() - startTimeRef.current
    if (ms >= RESTART_TIMEOUT_MS) {
      setTimedOut(true)
      onTimeout()
      return
    }

    api.getStats()
      .then(() => {
        if (!abortRef.current?.signal.aborted) {
          cleanup()
          onComplete()
        }
      })
      .catch(() => {
        // Gateway not up yet — schedule next attempt
        if (!abortRef.current?.signal.aborted) {
          timerRef.current = setTimeout(pollUntilReady, POLL_INTERVAL_MS)
        }
      })
  }

  React.useEffect(() => {
    if (!active) {
      cleanup()
      setElapsed(0)
      setTimedOut(false)
      return
    }

    startTimeRef.current = Date.now()
    abortRef.current = new AbortController()
    setElapsed(0)
    setTimedOut(false)

    // Elapsed seconds counter
    elapsedTimerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)

    // Initial poll after POLL_INTERVAL_MS (give the gateway time to start shutting down)
    timerRef.current = setTimeout(pollUntilReady, POLL_INTERVAL_MS)

    return cleanup
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  function cleanup() {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
  }

  function retry() {
    setTimedOut(false)
    setElapsed(0)
    startTimeRef.current = Date.now()
    abortRef.current = new AbortController()

    elapsedTimerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)

    timerRef.current = setTimeout(pollUntilReady, POLL_INTERVAL_MS)
  }

  if (!active) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-background/80">
      <Card className="w-80">
        <CardHeader>
          <CardTitle className="text-center">
            {timedOut ? 'Restart Timed Out' : 'Restarting Gateway...'}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {timedOut ? (
            <>
              <p className="text-sm text-muted-foreground">
                The gateway did not respond within {RESTART_TIMEOUT_MS / 1000} seconds.
              </p>
              <Button onClick={retry} variant="outline" className="w-full">
                Retry
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Waiting for gateway to come back online... ({elapsed}s)
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
