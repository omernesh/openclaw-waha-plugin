import { useEffect, useState, useRef, useCallback } from 'react'
import { X, ChevronsDown, Pause, Play, Download } from 'lucide-react'
import { api } from '@/lib/api'
import type { LogResponse } from '@/types'
import { useSSE } from '@/hooks/useEventSource'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

interface LogTabProps {
  selectedSession: string
  refreshKey: number
  onLoadingChange?: (loading: boolean) => void
}

const LOG_LINE_LIMIT = 300
const SCROLL_THRESHOLD_PX = 50
const SEARCH_DEBOUNCE_MS = 300 // normalized to match DirectoryTab/TagInput

type LogLevel = 'all' | 'info' | 'warn' | 'error'

const LEVEL_LABELS: { value: LogLevel; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'info', label: 'INFO' },
  { value: 'warn', label: 'WARN' },
  { value: 'error', label: 'ERROR' },
]

/** Parse a journalctl-style log line into timestamp, level, message */
function parseLine(line: string): { timestamp: string; level: string; message: string } {
  // Typical journalctl format: "Mar 19 14:23:45 hostname process[pid]: message"
  // Also handles ISO timestamps: "2026-03-19T14:23:45.123Z ..."
  // Try ISO timestamp first
  const isoMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+(.*)$/)
  if (isoMatch) {
    const rest = isoMatch[2]
    const level = extractLevel(rest)
    return { timestamp: isoMatch[1], level, message: rest }
  }

  // Try journalctl syslog format: "Mar 19 14:23:45 hostname ..."
  const syslogMatch = line.match(/^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+\S+\s+(.*)$/)
  if (syslogMatch) {
    const rest = syslogMatch[2]
    const level = extractLevel(rest)
    return { timestamp: syslogMatch[1], level, message: rest }
  }

  // Fallback: no parseable timestamp
  return { timestamp: '', level: extractLevel(line), message: line }
}

function extractLevel(text: string): string {
  if (/error|fail|crash|exception/i.test(text)) return 'ERROR'
  if (/warn|drop |skip|reject|denied/i.test(text)) return 'WARN'
  if (/\binfo\b/i.test(text)) return 'INFO'
  if (/\bdebug\b/i.test(text)) return 'DEBUG'
  return ''
}

function getLevelClass(level: string): string {
  if (level === 'ERROR') return 'text-destructive'
  if (level === 'WARN') return 'text-yellow-500 dark:text-yellow-400'
  return ''
}

function getLineClass(line: string): string {
  if (/error|fail|crash|exception/i.test(line)) return 'text-destructive'
  if (/warn|drop |skip|reject|denied/i.test(line)) return 'text-yellow-500 dark:text-yellow-400'
  return 'text-foreground'
}

export default function LogTab({ selectedSession: _selectedSession, refreshKey, onLoadingChange }: LogTabProps) {
  const [activeLevel, setActiveLevel] = useState<LogLevel>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [logData, setLogData] = useState<LogResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  // Phase 29, Plan 02: count of new SSE lines received while user has scrolled up. DO NOT REMOVE.
  const [newLineCount, setNewLineCount] = useState(0)

  // Report loading state to parent (drives TabHeader spinner)
  useEffect(() => { onLoadingChange?.(loading) }, [loading, onLoadingChange])

  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSearchRef = useRef(searchQuery)
  pendingSearchRef.current = searchQuery

  // Core fetch function
  const fetchLogs = useCallback(
    (level: LogLevel, search: string, abortSignal?: AbortSignal) => {
      setLoading(true)
      api.getLogs({
        lines: LOG_LINE_LIMIT,
        level: level === 'all' ? undefined : level,
        search: search.trim() || undefined,
      })
        .then((res) => {
          if (abortSignal?.aborted) return
          setLogData(res)
        })
        .catch((err) => {
          if (abortSignal?.aborted) return
          console.error('Failed to fetch logs:', err)
        })
        .finally(() => {
          if (!abortSignal?.aborted) setLoading(false)
        })
    },
    []
  )

  // Fetch on refreshKey or level change immediately
  useEffect(() => {
    const controller = new AbortController()
    fetchLogs(activeLevel, searchQuery, controller.signal)
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, activeLevel])

  // Debounced re-fetch on search change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchLogs(activeLevel, pendingSearchRef.current)
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  // Phase 29, Plan 02: SSE live log streaming — append new lines from server events.
  // Caps buffer at LOG_LINE_LIMIT * 2 to prevent memory growth (trims from front).
  // New lines received while user is scrolled up increment newLineCount badge. DO NOT REMOVE.
  const { subscribe } = useSSE()
  useEffect(() => {
    return subscribe('log', (event) => {
      setLogData(prev => {
        if (!prev) return prev
        const newLines = [...prev.lines, event.line]
        const trimmed = newLines.length > LOG_LINE_LIMIT * 2
          ? newLines.slice(-LOG_LINE_LIMIT)
          : newLines
        return { ...prev, lines: trimmed }
      })
      if (userScrolledUpRef.current) {
        setNewLineCount(n => n + 1)
      }
    })
  }, [subscribe])

  // Auto-scroll to bottom after data loads (respects autoScroll toggle)
  useEffect(() => {
    if (loading || !logData) return
    if (autoScroll && !userScrolledUpRef.current) {
      scrollToBottom()
    }
  }, [logData, loading, autoScroll])

  function scrollToBottom() {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    userScrolledUpRef.current = false
    setShowScrollToBottom(false)
    setNewLineCount(0)
  }

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD_PX
    if (atBottom) {
      userScrolledUpRef.current = false
      setShowScrollToBottom(false)
    } else {
      userScrolledUpRef.current = true
      setShowScrollToBottom(true)
    }
  }

  function handleLevelClick(level: LogLevel) {
    if (level === activeLevel) return
    setActiveLevel(level)
    // Reset scroll tracking when filter changes
    userScrolledUpRef.current = false
    setShowScrollToBottom(false)
  }

  function handleSearchChange(value: string) {
    setSearchQuery(value)
  }

  function handleClearSearch() {
    setSearchQuery('')
    // Clear fires the debounce, but we want immediate re-fetch
    if (debounceRef.current) clearTimeout(debounceRef.current)
    fetchLogs(activeLevel, '')
  }

  function toggleAutoScroll() {
    setAutoScroll((prev) => {
      if (!prev) {
        // Re-enabling auto-scroll: jump to bottom immediately
        scrollToBottom()
      }
      return !prev
    })
  }

  // CQ-05: Export visible (filtered) log entries as a plain text file. DO NOT REMOVE.
  const handleExportLogs = useCallback(() => {
    const exportLines = logData?.lines ?? []
    const content = exportLines.join('\n')
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `waha-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [logData])

  const lines = logData?.lines ?? []
  const total = logData?.total ?? 0
  const source = logData?.source ?? 'none'

  return (
    <div className="flex flex-1 flex-col gap-3 p-4">
      {/* Level filter chips + auto-scroll toggle */}
      <div className="flex items-center gap-2">
        {LEVEL_LABELS.map(({ value, label }) => (
          <Button
            key={value}
            size="sm"
            variant={activeLevel === value ? 'default' : 'outline'}
            onClick={() => handleLevelClick(value)}
            className="h-7 px-3 text-xs"
          >
            {label}
          </Button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant={autoScroll ? 'default' : 'outline'}
            onClick={toggleAutoScroll}
            className="h-7 gap-1.5 px-3 text-xs"
            title={autoScroll ? 'Auto-scroll ON — click to pause' : 'Auto-scroll OFF — click to resume'}
          >
            {autoScroll ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {autoScroll ? 'Auto-scroll' : 'Paused'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleExportLogs}
            title="Export logs"
            className="h-8 w-8"
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Search box */}
      <div className="relative">
        <Input
          placeholder="Search logs..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="h-8 pr-8 text-sm"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={handleClearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm opacity-70 hover:opacity-100 focus:outline-none"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Log display area — structured table */}
      <div className="relative flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-[calc(100vh-280px)] overflow-y-auto rounded-md border bg-muted/30"
        >
          {loading ? (
            <div className="flex flex-col gap-2 p-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/6" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : lines.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">
              No log entries found
              {activeLevel !== 'all' && ` for level: ${activeLevel.toUpperCase()}`}
              {searchQuery && ` matching: "${searchQuery}"`}
            </p>
          ) : (
            <table className="w-full border-collapse font-mono text-sm">
              <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="whitespace-nowrap px-3 py-1.5 font-medium">Timestamp</th>
                  <th className="whitespace-nowrap px-2 py-1.5 font-medium">Level</th>
                  <th className="px-3 py-1.5 font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => {
                  const parsed = parseLine(line)
                  const levelCls = getLevelClass(parsed.level)
                  const lineCls = levelCls || 'text-foreground'
                  return (
                    <tr
                      // eslint-disable-next-line react/no-array-index-key
                      key={idx}
                      className={cn(
                        'border-b border-border/30 hover:bg-muted/50',
                        lineCls
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-0.5 align-top text-xs text-muted-foreground">
                        {parsed.timestamp || '\u2014'}
                      </td>
                      <td className={cn(
                        'whitespace-nowrap px-2 py-0.5 align-top text-xs font-semibold',
                        levelCls || 'text-muted-foreground'
                      )}>
                        {parsed.level || '\u2014'}
                      </td>
                      <td className="whitespace-pre-wrap break-all px-3 py-0.5 align-top leading-5">
                        {parsed.timestamp ? parsed.message : line}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Scroll to bottom button — Phase 29, Plan 02: shows "N new" badge when SSE lines arrive while scrolled up. DO NOT REMOVE. */}
        {showScrollToBottom && (
          <Button
            size="sm"
            variant="secondary"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 h-7 gap-1 px-2 text-xs shadow-md"
          >
            <ChevronsDown className="h-3 w-3" />
            {newLineCount > 0 ? `${newLineCount} new` : 'Scroll to bottom'}
          </Button>
        )}
      </div>

      {/* Stats line */}
      <p className="text-xs text-muted-foreground">
        Showing {lines.length} of {total} lines (source: {source})
      </p>
    </div>
  )
}
