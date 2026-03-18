import { useEffect, useState, useRef, useCallback } from 'react'
import { X, ChevronsDown } from 'lucide-react'
import { api } from '@/lib/api'
import type { LogResponse } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

interface LogTabProps {
  selectedSession: string
  refreshKey: number
}

type LogLevel = 'all' | 'info' | 'warn' | 'error'

const LEVEL_LABELS: { value: LogLevel; label: string }[] = [
  { value: 'all', label: 'ALL' },
  { value: 'info', label: 'INFO' },
  { value: 'warn', label: 'WARN' },
  { value: 'error', label: 'ERROR' },
]

function getLineClass(line: string): string {
  if (/error|fail|crash|exception/i.test(line)) return 'text-destructive'
  if (/warn|drop |skip|reject|denied/i.test(line)) return 'text-yellow-500 dark:text-yellow-400'
  return 'text-muted-foreground'
}

export default function LogTab({ selectedSession: _selectedSession, refreshKey }: LogTabProps) {
  const [activeLevel, setActiveLevel] = useState<LogLevel>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [logData, setLogData] = useState<LogResponse | null>(null)
  const [loading, setLoading] = useState(true)

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
        lines: 300,
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
    }, 400)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  // Auto-scroll to bottom after data loads
  useEffect(() => {
    if (loading || !logData) return
    if (!userScrolledUpRef.current) {
      scrollToBottom()
    }
  }, [logData, loading])

  function scrollToBottom() {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    userScrolledUpRef.current = false
    setShowScrollToBottom(false)
  }

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50
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

  const lines = logData?.lines ?? []
  const total = logData?.total ?? 0
  const source = logData?.source ?? 'none'

  return (
    <div className="flex flex-1 flex-col gap-3 p-4">
      {/* Level filter chips */}
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

      {/* Log display area */}
      <div className="relative flex-1">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-[calc(100vh-280px)] overflow-y-auto rounded-md border bg-muted/30 p-3"
        >
          {loading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/6" />
              <Skeleton className="h-4 w-full" />
            </div>
          ) : lines.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No log entries found
              {activeLevel !== 'all' && ` for level: ${activeLevel.toUpperCase()}`}
              {searchQuery && ` matching: "${searchQuery}"`}
            </p>
          ) : (
            lines.map((line, idx) => (
              <div
                // eslint-disable-next-line react/no-array-index-key
                key={idx}
                className={cn('font-mono text-xs whitespace-pre-wrap break-all leading-5', getLineClass(line))}
              >
                {line}
              </div>
            ))
          )}
        </div>

        {/* Scroll to bottom button */}
        {showScrollToBottom && (
          <Button
            size="sm"
            variant="secondary"
            onClick={scrollToBottom}
            className="absolute bottom-3 right-3 h-7 gap-1 px-2 text-xs shadow-md"
          >
            <ChevronsDown className="h-3 w-3" />
            Scroll to bottom
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
