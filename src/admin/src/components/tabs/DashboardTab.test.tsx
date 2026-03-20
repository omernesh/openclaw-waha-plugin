import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import DashboardTab from './DashboardTab'

// Minimal StatsResponse for tests
const mockStats = {
  dmFilter: {
    enabled: false,
    patterns: [],
    godModeBypass: false,
    godModeScope: 'all' as const,
    godModeSuperUsers: [],
    tokenEstimate: 0,
    stats: { allowed: 5, dropped: 2, tokensEstimatedSaved: 100 },
    recentEvents: [],
  },
  groupFilter: {
    enabled: false,
    patterns: [],
    godModeBypass: false,
    godModeScope: 'all' as const,
    godModeSuperUsers: [],
    tokenEstimate: 0,
    stats: { allowed: 3, dropped: 1, tokensEstimatedSaved: 50 },
    recentEvents: [],
  },
  presence: { enabled: true, wpm: 42 },
  access: {
    allowFrom: [],
    groupAllowFrom: [],
    allowedGroups: [],
    dmPolicy: 'allow-all',
    groupPolicy: 'allow-all',
  },
  session: 'test-session',
  baseUrl: 'http://localhost:3004',
  webhookPort: 3005,
  serverTime: '2026-03-20T00:00:00Z',
  sessions: [
    {
      sessionId: 'test-session',
      name: 'Test Session',
      healthStatus: 'healthy',
      consecutiveFailures: 0,
      lastCheck: null,
      recoveryAttemptCount: 0,
      recoveryLastAttemptAt: null,
      recoveryLastOutcome: null,
      recoveryInCooldown: false,
    },
  ],
}

const mockConfig = { waha: {} }

vi.mock('@/lib/api', () => ({
  api: {
    getStats: vi.fn(),
    getConfig: vi.fn(),
    resolveNames: vi.fn(),
  },
}))

vi.mock('@/hooks/useEventSource', () => ({
  useSSE: () => ({
    status: 'connected',
    subscribe: vi.fn(() => () => {}),
  }),
}))

describe('DashboardTab', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { api } = await import('@/lib/api')
    vi.mocked(api.getStats).mockResolvedValue(mockStats)
    vi.mocked(api.getConfig).mockResolvedValue(mockConfig)
    vi.mocked(api.resolveNames).mockResolvedValue({ resolved: {} })
  })

  it('renders without crash', () => {
    const { container } = render(
      <DashboardTab selectedSession="all" refreshKey={0} />
    )
    expect(container).toBeTruthy()
  })

  it('shows loading skeleton initially', () => {
    const { container } = render(
      <DashboardTab selectedSession="all" refreshKey={0} />
    )
    // Container renders something during loading
    expect(container.firstChild).toBeTruthy()
  })

  it('displays session health card after data loads', async () => {
    render(<DashboardTab selectedSession="all" refreshKey={0} />)

    await waitFor(() => {
      // Multiple elements can match (card title + tooltip) — check at least one exists
      const els = screen.getAllByText(/Session Health/)
      expect(els.length).toBeGreaterThan(0)
    })
  })

  it('shows session name after data loads', async () => {
    render(<DashboardTab selectedSession="all" refreshKey={0} />)

    await waitFor(() => {
      const els = screen.getAllByText(/Test Session/)
      expect(els.length).toBeGreaterThan(0)
    })
  })

  it('calls onLoadingChange when loading state changes', async () => {
    const onLoadingChange = vi.fn()
    render(<DashboardTab selectedSession="all" refreshKey={0} onLoadingChange={onLoadingChange} />)

    await waitFor(() => {
      expect(onLoadingChange).toHaveBeenCalledWith(false)
    })
  })
})
