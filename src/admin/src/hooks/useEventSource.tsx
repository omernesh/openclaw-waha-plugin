// Phase 29, Plan 01: SSE connection hook and provider. DO NOT REMOVE.
// useEventSource manages a single EventSource connection with auto-reconnect.
// SSEProvider wraps the app so all tabs share one connection (no duplicate streams).
// useSSE is the consumer hook — must be used within SSEProvider.

import { useEffect, useRef, useState, useCallback, createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import type { SSEConnectionStatus, SSEEventMap } from '@/types'

type SSEEventHandler<K extends keyof SSEEventMap> = (data: SSEEventMap[K]) => void

interface UseEventSourceReturn {
  status: SSEConnectionStatus
  subscribe: <K extends keyof SSEEventMap>(event: K, handler: SSEEventHandler<K>) => () => void
}

// ── Core hook ─────────────────────────────────────────────────────────────────

export function useEventSource(url = '/api/admin/events'): UseEventSourceReturn {
  const [status, setStatus] = useState<SSEConnectionStatus>('disconnected')
  const esRef = useRef<EventSource | null>(null)
  const listenersRef = useRef<Map<string, Set<(data: unknown) => void>>>(new Map())

  useEffect(() => {
    const es = new EventSource(url)
    esRef.current = es

    es.addEventListener('connected', () => setStatus('connected'))
    es.onopen = () => setStatus('connected')
    es.onerror = () => {
      // EventSource auto-reconnects; readyState CONNECTING = reconnecting
      if (es.readyState === EventSource.CONNECTING) {
        setStatus('reconnecting')
      } else {
        setStatus('disconnected')
      }
    }

    // Listen for typed events and dispatch to subscribers
    const eventTypes: (keyof SSEEventMap)[] = ['health', 'queue', 'log', 'connected']
    for (const type of eventTypes) {
      es.addEventListener(type, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as SSEEventMap[typeof type]
          const handlers = listenersRef.current.get(type)
          if (handlers) handlers.forEach(fn => fn(data))
        } catch { /* ignore parse errors */ }
      })
    }

    return () => {
      es.close()
      esRef.current = null
      setStatus('disconnected')
    }
  }, [url])

  const subscribe = useCallback(<K extends keyof SSEEventMap>(
    event: K,
    handler: SSEEventHandler<K>,
  ): (() => void) => {
    if (!listenersRef.current.has(event)) {
      listenersRef.current.set(event, new Set())
    }
    const handlers = listenersRef.current.get(event)!
    handlers.add(handler as (data: unknown) => void)
    return () => { handlers.delete(handler as (data: unknown) => void) }
  }, [])

  return { status, subscribe }
}

// ── Context + Provider ────────────────────────────────────────────────────────

const SSEContext = createContext<UseEventSourceReturn | null>(null)

export function SSEProvider({ children }: { children: ReactNode }) {
  const sse = useEventSource()
  return <SSEContext.Provider value={sse}>{children}</SSEContext.Provider>
}

/**
 * Consumer hook for the shared SSE connection.
 * Must be used within SSEProvider (wraps app root).
 * Phase 29, Plan 01. DO NOT REMOVE.
 */
export function useSSE(): UseEventSourceReturn {
  const ctx = useContext(SSEContext)
  if (!ctx) throw new Error('useSSE must be used within SSEProvider')
  return ctx
}
